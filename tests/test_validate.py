"""Тесты подкоманды ``space_manager validate`` (docs-llm/04, docs-llm/07 §3).

Сквозные сценарии через subprocess (``python -m space_manager validate ...``):
валидный результат → exit 0; сломанный кейс каждого правила V-GRID / V-SYMBOL /
V-BLOCKED / V-PRESET / V-ADJACENCY / V-RECTANGLE / V-AREA → exit 3 + строка
«НАРУШЕНИЕ <код>»; ошибки входа (нет файла, невалидный YAML, нет секции
«== КАРТА ==») → exit 2. Фикстуры — мелкие маски 10×10 (паттерн существующих
тестов пакета). Плюс unit-тесты парсера ``parse_result_map``.
"""

import re
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
WORKSPACE_1 = ROOT / "workspace" / "1"


# ---------------------------------------------------------------------------
# Фикстуры: спеки и маски 10×10
# ---------------------------------------------------------------------------

DOTS_10 = ".........."

SPEC_BASE_YAML = """\
grid: {width: 10, height: 10}
blockedFile: null
presetFile: null
types:
  ROOM: {symbol: "R"}
  HALL: {symbol: "H"}
rules:
  connectivity: 8
  adjacency:
    forbidden: [[ROOM, HALL]]
clusters:
  - {id: r1, type: ROOM, areaPercent: 40, shape: rectangle}
  - {id: h1, type: HALL, areaPercent: 50}
"""

# Та же спека без forbidden-правил (для кейсов, где смежность не важна).
SPEC_NO_FORBIDDEN_YAML = """\
grid: {width: 10, height: 10}
blockedFile: null
presetFile: null
types:
  ROOM: {symbol: "R"}
  HALL: {symbol: "H"}
rules:
  connectivity: 8
clusters:
  - {id: r1, type: ROOM, areaPercent: 40, shape: rectangle}
  - {id: h1, type: HALL, areaPercent: 50}
"""

# Спеки с реальными масками blocked/preset (для кейсов правил 3 и комбинаций).
SPEC_BASE_BLOCKED_YAML = SPEC_BASE_YAML.replace("blockedFile: null", "blockedFile: ./blocked.txt")
SPEC_BASE_PRESET_YAML = SPEC_BASE_YAML.replace("presetFile: null", "presetFile: ./preset.txt")

# Специальная спека для диагонального кейса V-ADJACENCY (цели = фактам карты).
SPEC_DIAGONAL_YAML = """\
grid: {width: 10, height: 10}
blockedFile: null
presetFile: null
types:
  ROOM: {symbol: "R"}
  HALL: {symbol: "H"}
rules:
  connectivity: 8
  adjacency:
    forbidden: [[ROOM, HALL]]
clusters:
  - {id: r1, type: ROOM, areaPercent: 30, shape: rectangle}
  - {id: h1, type: HALL, areaPercent: 59}
"""

# Один тип, два кластера (отрицательный кейс «одинаковые типы — не нарушение»).
SPEC_TWO_ROOMS_YAML = """\
grid: {width: 10, height: 10}
blockedFile: null
presetFile: null
types:
  ROOM: {symbol: "R"}
rules:
  connectivity: 8
clusters:
  - {id: r1, type: ROOM, areaPercent: 40}
  - {id: r2, type: ROOM, areaPercent: 30}
"""

# Валидная карта: R = полный прямоугольник 10×4 (40), зазор-ряд, H = 50.
MAP_VALID = [
    "RRRRRRRRRR", "RRRRRRRRRR", "RRRRRRRRRR", "RRRRRRRRRR",
    DOTS_10,
    "HHHHHHHHHH", "HHHHHHHHHH", "HHHHHHHHHH", "HHHHHHHHHH", "HHHHHHHHHH",
]

# V-ADJACENCY (ортогонально): H сдвинут на зазор вверх — касается R по 8-окрестности.
MAP_ADJ_TOUCH = [
    "RRRRRRRRRR", "RRRRRRRRRR", "RRRRRRRRRR", "RRRRRRRRRR",
    "HHHHHHHHHH", "HHHHHHHHHH", "HHHHHHHHHH", "HHHHHHHHHH", "HHHHHHHHHH",
    DOTS_10,
]

# V-ADJACENCY (диагональ): единственная точка касания — (5,6) ↔ R(4,5), по диагонали.
MAP_ADJ_DIAGONAL = [
    "RRRRR.HHHH", "RRRRR.HHHH", "RRRRR.HHHH", "RRRRR.HHHH", "RRRRR.HHHH", "RRRRR.HHHH",
    ".....HHHHH",
    "HHHHHHHHHH", "HHHHHHHHHH", "HHHHHHHHHH",
]

# V-RECTANGLE: из R-блока убрали (9,1) и добавили R в зазорной строке — bbox не заполнен.
MAP_RECT_BROKEN = [
    "RRRRRRRRRR",
    "RRRRRRRRR.",
    "RRRRRRRRRR",
    "RRRRRRRRRR",
    "........R.",
    "HHHHHHHHHH", "HHHHHHHHHH", "HHHHHHHHHH", "HHHHHHHHHH", "HHHHHHHHHH",
]

# V-AREA: R только 2 ряда (20 против цели 40, -50%) — остальные правила в порядке.
MAP_AREA_BROKEN = [
    "RRRRRRRRRR", "RRRRRRRRRR",
    DOTS_10, DOTS_10, DOTS_10,
    "HHHHHHHHHH", "HHHHHHHHHH", "HHHHHHHHHH", "HHHHHHHHHH", "HHHHHHHHHH",
]

# Граница допуска: R = полный прямоугольник 6×6 = 36 против цели 40 → ровно -10 %
# (внутри допуска — НЕ нарушение, docs-llm/07 §3).
MAP_AREA_AT_LIMIT = [
    "RRRRRRHHHH", "RRRRRRHHHH", "RRRRRRHH..", "RRRRRR....", "RRRRRR....", "RRRRRR....",
    "HHHHHHHHHH", "HHHHHHHHHH", "HHHHHHHHHH", "HHHHHHHHHH",
]

# Два кластера одного типа: одна неразличимая область 70 клеток (40+30) — валидно.
MAP_TWO_ROOMS = ["RRRRRRRRRR"] * 7 + [DOTS_10] * 3


def _result_text(rows) -> str:
    """Минимальный result-файл: секция «== КАРТА ==» в формате report.build_report."""
    return "== КАРТА ==\n\n" + "\n".join(rows) + "\n"


def _write_project(tmp_path: Path, yaml_text: str, rows, extra_files=None) -> dict:
    """Писает спеку (+ маски) и result-файл в tmp_path; возвращает пути."""
    spec = tmp_path / "spec.yaml"
    spec.write_text(yaml_text, encoding="utf-8")
    for name, content in (extra_files or {}).items():
        (tmp_path / name).write_text(content, encoding="utf-8")
    result = tmp_path / "result.txt"
    result.write_text(_result_text(rows), encoding="utf-8")
    return {"spec": spec, "result": result}


def _run_cli(*cli_args: str, cwd: Path) -> "subprocess.CompletedProcess[str]":
    """Запуск CLI в subprocess тем же интерпретатором (паттерн test_integration)."""
    return subprocess.run(
        [sys.executable, "-m", "space_manager", *cli_args],
        capture_output=True, text=True, cwd=str(cwd), timeout=120,
    )


def _validate(tmp_path: Path, yaml_text, rows, *extra_args: str, extra_files=None):
    paths = _write_project(tmp_path, yaml_text, rows, extra_files)
    return _run_cli(
        "validate", str(paths["result"]), "--spec", str(paths["spec"]), *extra_args,
        cwd=tmp_path,
    )


# ---------------------------------------------------------------------------
# Unit-тесты парсера секции «== КАРТА ==»
# ---------------------------------------------------------------------------

def test_parse_result_map_full_report():
    from space_manager.validate_map import parse_result_map
    text = (
        "== КАРТА ==\n\n"
        "RR..HH\n"
        "RR..HH\n\n"
        "== ТАБЛИЦА: запрошено / фактически / отклонение ==\n\n"
        "id | type\n"
    )
    assert parse_result_map(text) == [["R", "R", ".", ".", "H", "H"], ["R", "R", ".", ".", "H", "H"]]


def test_parse_result_map_missing_section():
    from space_manager.validate_map import ResultParseError, parse_result_map
    with pytest.raises(ResultParseError):
        parse_result_map("== ТАБЛИЦА ==\n\nчто-то там\n")


# ---------------------------------------------------------------------------
# Валидные случаи → exit 0
# ---------------------------------------------------------------------------

def test_valid_mask_exit_0(tmp_path):
    proc = _validate(tmp_path, SPEC_BASE_YAML, MAP_VALID)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "ОК: нарушений нет" in proc.stdout


def test_valid_mask_same_type_touching_is_ok(tmp_path):
    """Отрицательный кейс V-ADJACENCY: одинаковые типы соприкасаются — не нарушение."""
    proc = _validate(tmp_path, SPEC_TWO_ROOMS_YAML, MAP_TWO_ROOMS)
    assert proc.returncode == 0, proc.stdout + proc.stderr


def test_valid_mask_area_exactly_at_10_percent_is_ok(tmp_path):
    """Граница допуска V-AREA (ровно -10 %) — не нарушение."""
    proc = _validate(tmp_path, SPEC_NO_FORBIDDEN_YAML, MAP_AREA_AT_LIMIT)
    assert proc.returncode == 0, proc.stdout + proc.stderr


# ---------------------------------------------------------------------------
# Сломанные кейсы: каждое правило → exit 3 + «НАРУШЕНИЕ <код>»
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("rows", [
    pytest.param(MAP_VALID[:-1], id="короче-на-ряд"),
    pytest.param(MAP_VALID + [DOTS_10], id="длиннее-на-ряд"),
    pytest.param([MAP_VALID[0][:8]] + MAP_VALID[1:], id="строка-неверной-длины"),
])
def test_broken_grid(tmp_path, rows):
    proc = _validate(tmp_path, SPEC_BASE_YAML, rows)
    assert proc.returncode == 3, proc.stdout + proc.stderr
    assert "НАРУШЕНИЕ V-GRID" in proc.stdout


@pytest.mark.parametrize("char", ["X", "?"])
def test_broken_symbol(tmp_path, char):
    rows = [row if y != 4 else row[:5] + char + row[6:] for y, row in enumerate(MAP_VALID)]
    proc = _validate(tmp_path, SPEC_BASE_YAML, rows)
    assert proc.returncode == 3, proc.stdout + proc.stderr
    assert "НАРУШЕНИЕ V-SYMBOL" in proc.stdout
    assert "(5, 4)" in proc.stdout


def test_broken_blocked(tmp_path):
    blocked = (DOTS_10 + "\n") * 5 + "*.........\n" + (DOTS_10 + "\n") * 4  # '*' в (0, 5) — там H
    proc = _validate(tmp_path, SPEC_BASE_BLOCKED_YAML, MAP_VALID, extra_files={"blocked.txt": blocked})
    assert proc.returncode == 3, proc.stdout + proc.stderr
    assert "НАРУШЕНИЕ V-BLOCKED" in proc.stdout
    assert "(0, 5)" in proc.stdout


def test_broken_preset(tmp_path):
    preset = (DOTS_10 + "\n") * 4 + ".....H....\n" + (DOTS_10 + "\n") * 5  # 'H' в (5, 4) — там '.'
    proc = _validate(tmp_path, SPEC_BASE_PRESET_YAML, MAP_VALID, extra_files={"preset.txt": preset})
    assert proc.returncode == 3, proc.stdout + proc.stderr
    assert "НАРУШЕНИЕ V-PRESET" in proc.stdout
    assert "(5, 4)" in proc.stdout


def test_broken_adjacency_orthogonal(tmp_path):
    proc = _validate(tmp_path, SPEC_BASE_YAML, MAP_ADJ_TOUCH)
    assert proc.returncode == 3, proc.stdout + proc.stderr
    assert "НАРУШЕНИЕ V-ADJACENCY" in proc.stdout
    assert "ROOM" in proc.stdout and "HALL" in proc.stdout


def test_broken_adjacency_diagonal(tmp_path):
    """8-окрестность: касание строго по диагонали тоже нарушение."""
    proc = _validate(tmp_path, SPEC_DIAGONAL_YAML, MAP_ADJ_DIAGONAL)
    assert proc.returncode == 3, proc.stdout + proc.stderr
    assert "НАРУШЕНИЕ V-ADJACENCY" in proc.stdout


def test_broken_rectangle(tmp_path):
    proc = _validate(tmp_path, SPEC_NO_FORBIDDEN_YAML, MAP_RECT_BROKEN)
    assert proc.returncode == 3, proc.stdout + proc.stderr
    assert "НАРУШЕНИЕ V-RECTANGLE" in proc.stdout


def test_broken_area_out_of_tolerance(tmp_path):
    proc = _validate(tmp_path, SPEC_BASE_YAML, MAP_AREA_BROKEN)
    assert proc.returncode == 3, proc.stdout + proc.stderr
    assert "НАРУШЕНИЕ V-AREA" in proc.stdout
    assert "20 клеток против суммы целей 40" in proc.stdout


def test_area_tolerance_flag_overrides_threshold(tmp_path):
    """--tolerance переопределяет порог: -50 % валидно при допуске 60 %."""
    proc = _validate(tmp_path, SPEC_BASE_YAML, MAP_AREA_BROKEN, "--tolerance", "60")
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "ОК: нарушений нет" in proc.stdout


def test_multiple_violations_all_listed_with_total(tmp_path):
    """Комбинация нескольких нарушений: все в stdout + «ИТОГО нарушений: N»."""
    rows = [row if y != 4 else row[:5] + "X" + row[6:] for y, row in enumerate(MAP_VALID)]
    blocked = (DOTS_10 + "\n") * 4 + "*.........\n" + (DOTS_10 + "\n") * 5  # '*' в (0, 4) — там '.'
    proc = _validate(tmp_path, SPEC_BASE_BLOCKED_YAML, rows, extra_files={"blocked.txt": blocked})
    assert proc.returncode == 3, proc.stdout + proc.stderr
    assert "НАРУШЕНИЕ V-SYMBOL" in proc.stdout
    assert "НАРУШЕНИЕ V-BLOCKED" in proc.stdout
    total = re.search(r"ИТОГО нарушений: (\d+)", proc.stdout)
    assert total is not None and int(total.group(1)) >= 2


# ---------------------------------------------------------------------------
# Реальный result-файл проекта (workspace/1): маска нарушает forbidden-смежность
# ROOM↔holl → exit 3 (задокументированное поведение, docs-llm/04 §5 правило 4)
# ---------------------------------------------------------------------------

def test_real_workspace_result_reports_adjacency(tmp_path):
    result = WORKSPACE_1 / "result-20260913-200232.txt"
    if not result.is_file():
        pytest.skip("реальный result-файл отсутствует")
    proc = _run_cli(
        "validate", str(result), "--spec", str(WORKSPACE_1 / "spec.yaml"), cwd=tmp_path,
    )
    assert proc.returncode == 3, proc.stdout + proc.stderr
    assert "НАРУШЕНИЕ V-ADJACENCY" in proc.stdout
    total = re.search(r"ИТОГО нарушений: (\d+)", proc.stdout)
    assert total is not None and int(total.group(1)) >= 1


# ---------------------------------------------------------------------------
# Ошибки входных данных → exit 2, «ОШИБКА ВХОДНЫХ ДАННЫХ» в stderr
# ---------------------------------------------------------------------------

def test_input_error_missing_result_file(tmp_path):
    spec = tmp_path / "spec.yaml"
    spec.write_text(SPEC_BASE_YAML, encoding="utf-8")
    proc = _run_cli(
        "validate", str(tmp_path / "нет.txt"), "--spec", str(spec), cwd=tmp_path,
    )
    assert proc.returncode == 2, proc.stdout + proc.stderr
    assert "ОШИБКА ВХОДНЫХ ДАННЫХ" in proc.stderr


def test_input_error_invalid_yaml_spec(tmp_path):
    spec = tmp_path / "spec.yaml"
    spec.write_text("grid: [unclosed\n", encoding="utf-8")
    result = tmp_path / "result.txt"
    result.write_text(_result_text(MAP_VALID), encoding="utf-8")
    proc = _run_cli("validate", str(result), "--spec", str(spec), cwd=tmp_path)
    assert proc.returncode == 2, proc.stdout + proc.stderr
    assert "ОШИБКА ВХОДНЫХ ДАННЫХ" in proc.stderr


def test_input_error_no_map_section(tmp_path):
    spec = tmp_path / "spec.yaml"
    spec.write_text(SPEC_BASE_YAML, encoding="utf-8")
    result = tmp_path / "result.txt"
    result.write_text("НЕ УДАЛОСЬ РАЗМЕСТИТЬ ВСЕ КЛАСТЕРЫ.\nПричина: ...\n", encoding="utf-8")
    proc = _run_cli("validate", str(result), "--spec", str(spec), cwd=tmp_path)
    assert proc.returncode == 2, proc.stdout + proc.stderr
    assert "ОШИБКА ВХОДНЫХ ДАННЫХ" in proc.stderr
    assert "КАРТА" in proc.stderr
