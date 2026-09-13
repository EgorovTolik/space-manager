"""Интеграционные тесты (M4, docs/06 §2/§7, docs/07 §1).

Сквозные сценарии: YAML → load_spec → solve → build_report; CLI через
subprocess (``python -m space_manager place ...``) с проверкой exit-codes.
"""

import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
EXAMPLES = ROOT / "examples"

BASIC_SPEC_YAML = """\
grid: {width: 10, height: 10}
blockedFile: ./blocked.txt
presetFile: null
types:
  ROOM: {symbol: "R"}
  CORRIDOR: {symbol: "C"}
rules:
  connectivity: 8
  fillAll: false
clusters:
  - {id: room1, type: ROOM, areaPercent: 30}
  - {id: room2, type: ROOM, areaPercent: 30}
  - {id: corridor1, type: CORRIDOR, areaPercent: 40, shape: circle}
"""

BLOCKED_10X10 = "\n".join(["**........", "**........"] + [".........."] * 8) + "\n"


def _run_cli(*cli_args: str, cwd: Path = ROOT) -> "subprocess.CompletedProcess[str]":
    """Запуск CLI в subprocess тем же интерпретатором, под которым работает pytest.

    :param cwd: каталог запуска (по умолчанию корень проекта; для тестов
        файла по умолчанию передают ``tmp_path``, чтобы не засорять репозиторий).
    """
    return subprocess.run(
        [sys.executable, "-m", "space_manager", *cli_args],
        capture_output=True, text=True, cwd=str(cwd), timeout=120,
    )


def _write_spec(tmp_path: Path, yaml_text: str, extra_files=None) -> Path:
    for name, content in (extra_files or {}).items():
        (tmp_path / name).write_text(content, encoding="utf-8")
    spec_path = tmp_path / "spec.yaml"
    spec_path.write_text(yaml_text, encoding="utf-8")
    return spec_path


# ---------------------------------------------------------------------------
# 1. End-to-end: YAML-строка → load_spec → solve → build_report
# ---------------------------------------------------------------------------

def test_end_to_end_spec_solve_report(tmp_path):
    from space_manager.report import build_report
    from space_manager.spec_io import load_spec
    from space_manager.solver import solve

    spec_path = _write_spec(
        tmp_path, BASIC_SPEC_YAML, {"blocked.txt": BLOCKED_10X10},
    )
    spec = load_spec(str(spec_path))
    assert spec.grid_dims == (10, 10)

    result = solve(spec)
    assert result.feasible, result.infeasible_reason
    assert result.infeasible_reason is None

    report_text = build_report(result, spec.types)
    # Карта и таблица присутствуют (docs/06 §3, §4).
    assert "== КАРТА ==" in report_text
    assert "== ТАБЛИЦА: запрошено / фактически / отклонение ==" in report_text
    assert "== ПРЕДУПРЕЖДЕНИЯ ==" in report_text
    # Карта рендерит символы типов и блокировки.
    assert "R" in report_text and "C" in report_text and "**" in report_text
    # Таблица покрывает все запрошенные экземпляры.
    for cluster_id in ("room1", "room2", "corridor1"):
        assert cluster_id in report_text


# ---------------------------------------------------------------------------
# 2. CLI: успешный прогон на examples/spec_basic.yaml → exit 0
# ---------------------------------------------------------------------------

def test_cli_place_examples_success(tmp_path):
    proc = _run_cli("place", str(EXAMPLES / "spec_basic.yaml"), cwd=tmp_path)
    assert proc.returncode == 0, (proc.stdout, proc.stderr)
    out = proc.stdout
    assert "== КАРТА ==" in out
    assert "== ТАБЛИЦА: запрошено / фактически / отклонение ==" in out
    assert "room1" in out and "room2" in out and "corridor1" in out
    # Карта: строки по 50 символов (сетка 50×50 в examples/spec_basic.yaml).
    import re as _re

    map_lines = [
        line for line in out.splitlines()
        if _re.fullmatch(r"[RWC.*]{50}", line) is not None
    ]
    assert len(map_lines) >= 40, "на карте почти нет заполненных строк?"


# ---------------------------------------------------------------------------
# 2b. CLI: examples/spec_touchall.yaml (docs/04 §9) → exit 0, кластеры примыкают
# ---------------------------------------------------------------------------

def test_cli_place_examples_touchall(tmp_path):
    from space_manager.report import build_report
    from space_manager.rules import all_clusters_touch
    from space_manager.spec_io import load_spec
    from space_manager.solver import solve

    proc = _run_cli("place", str(EXAMPLES / "spec_touchall.yaml"), cwd=tmp_path)
    assert proc.returncode == 0, (proc.stdout, proc.stderr)
    out = proc.stdout
    assert "== КАРТА ==" in out
    assert "room1" in out and "corridor1" in out and "garden1" in out
    # Карта 12 строк по 12 символов (сетка 12×12).
    map_lines = [
        line for line in out.splitlines()
        if len(line) == 12 and set(line) <= set("RCG.*")
    ]
    assert len(map_lines) == 12, "карта touchAll-примера должна быть 12 строк"

    # Сквозная проверка семантики: все кластеры образуют единый примыкающий ком.
    spec = load_spec(str(EXAMPLES / "spec_touchall.yaml"))
    assert spec.rules.touch_all is True
    result = solve(spec)
    assert result.feasible, result.infeasible_reason
    assert all_clusters_touch(result.instances.values()) is True
    # Отчёт собирается без ошибок и содержит карту.
    assert "== КАРТА ==" in build_report(result, spec.types)


# ---------------------------------------------------------------------------
# 3. CLI: валидная, но невозможная спекация → exit 1 + текст причины
# ---------------------------------------------------------------------------

INFEASIBLE_YAML = """\
grid: {width: 2, height: 2}
types:
  A: {symbol: "A"}
  B: {symbol: "B"}
rules:
  adjacency:
    forbidden: [[A, B]]
clusters:
  - {id: a1, type: A, areaPercent: 50}
  - {id: b1, type: B, areaPercent: 50}
"""


def test_cli_place_infeasible_exit_1(tmp_path):
    spec_path = _write_spec(tmp_path, INFEASIBLE_YAML)
    proc = _run_cli("place", str(spec_path), cwd=tmp_path)
    assert proc.returncode == 1, (proc.stdout, proc.stderr)
    assert "НЕ УДАЛОСЬ РАЗМЕСТИТЬ ВСЕ КЛАСТЕРЫ" in proc.stdout
    assert "Причина:" in proc.stdout


# ---------------------------------------------------------------------------
# 4. CLI: битая спекация → exit 2 + сообщение в stderr
# ---------------------------------------------------------------------------

BROKEN_YAML_UNKNOWN_TYPE = """\
grid: {width: 4, height: 4}
types:
  A: {symbol: "A"}
clusters:
  - {id: x1, type: GHOST, areaPercent: 50}
"""


@pytest.mark.parametrize("yaml_text", [
    BROKEN_YAML_UNKNOWN_TYPE,              # тип не в реестре (docs/03 §5)
    "grid: {width: 4, height: 4}\n"        # нет types/clusters
    "clusters: [{id: a1, type: A, areaPercent: 50}]\n",
    "::: не-YAML {{{",                      # синтаксическая ошибка YAML
])
def test_cli_place_input_error_exit_2(tmp_path, yaml_text):
    spec_path = _write_spec(tmp_path, yaml_text)
    proc = _run_cli("place", str(spec_path))
    assert proc.returncode == 2, (proc.stdout, proc.stderr)
    assert "ОШИБКА ВХОДНЫХ ДАННЫХ" in proc.stderr


def test_cli_place_missing_file_exit_2(tmp_path):
    proc = _run_cli("place", str(tmp_path / "no_such_spec.yaml"))
    assert proc.returncode == 2, (proc.stdout, proc.stderr)
    assert "ОШИБКА ВХОДНЫХ ДАННЫХ" in proc.stderr


# ---------------------------------------------------------------------------
# 5. CLI: сохранение отчёта в файл (docs/06 §2 — результат ВЕГДА в txt)
# ---------------------------------------------------------------------------

def test_cli_default_result_file(tmp_path):
    """Без --out: создаётся result-<timestamp>.txt в cwd с полным отчётом,
    stdout содержит карту и строку «Сохранено: <путь>»."""
    proc = _run_cli("place", str(EXAMPLES / "spec_basic.yaml"), cwd=tmp_path)
    assert proc.returncode == 0, (proc.stdout, proc.stderr)
    files = sorted(tmp_path.glob("result-*.txt"))
    assert len(files) == 1, "ожидался ровно один файл result-<timestamp>.txt: {}".format(
        [p.name for p in tmp_path.iterdir()])
    # Имя соответствует формату YYYYmmdd-HHMMSS.
    assert re.fullmatch(r"result-\d{8}-\d{6}\.txt", files[0].name)
    text = files[0].read_text(encoding="utf-8")
    assert "== КАРТА ==" in text
    assert "== ТАБЛИЦА: запрошено / фактически / отклонение ==" in text
    assert "room1" in text and "corridor1" in text
    # Отчёт виден и в stdout, вместе с путём к файлу.
    assert "== КАРТА ==" in proc.stdout
    assert "Сохранено: {}".format(files[0].name) in proc.stdout


def test_cli_out_file(tmp_path):
    """С --out FILE: отчёт в указанный файл; stdout содержит отчёт + «Сохранено»."""
    out_file = tmp_path / "my_result.txt"
    proc = _run_cli("place", str(EXAMPLES / "spec_basic.yaml"),
                    "--out", str(out_file), cwd=tmp_path)
    assert proc.returncode == 0, (proc.stdout, proc.stderr)
    text = out_file.read_text(encoding="utf-8")
    assert "== КАРТА ==" in text
    assert "room1" in text
    # Файл по умолчанию НЕ создаётся при явном --out.
    assert not list(tmp_path.glob("result-*.txt"))
    # Отчёт дублируется в stdout вместе с путём к файлу.
    assert "== КАРТА ==" in proc.stdout
    assert "Сохранено: {}".format(out_file) in proc.stdout


def test_cli_infeasible_still_saves_report(tmp_path):
    """Exit 1 (невозможность) — отчёт всё равно сохраняется в файл."""
    spec_path = _write_spec(tmp_path, INFEASIBLE_YAML)
    out_file = tmp_path / "infeasible.txt"
    proc = _run_cli("place", str(spec_path), "--out", str(out_file), cwd=tmp_path)
    assert proc.returncode == 1, (proc.stdout, proc.stderr)
    text = out_file.read_text(encoding="utf-8")
    assert "НЕ УДАЛОСЬ РАЗМЕСТИТЬ ВСЕ КЛАСТЕРЫ" in text
    assert "Сохранено: {}".format(out_file) in proc.stdout


def test_cli_input_error_creates_no_files(tmp_path):
    """Exit 2 (ошибка входа) — файлы-результаты не создаются."""
    spec_path = _write_spec(tmp_path, BROKEN_YAML_UNKNOWN_TYPE)
    proc = _run_cli("place", str(spec_path), cwd=tmp_path)
    assert proc.returncode == 2, (proc.stdout, proc.stderr)
    assert not list(tmp_path.glob("result-*.txt"))
    assert "ОШИБКА ВХОДНЫХ ДАННЫХ" in proc.stderr


def test_default_result_name_helper():
    """Генерация имени по умолчанию — чистая и детерминированная."""
    from space_manager.cli import default_result_name

    assert (
        default_result_name(datetime(2026, 1, 5, 9, 7, 3))
        == "result-20260105-090703.txt"
    )
    name = default_result_name()
    assert re.fullmatch(r"result-\d{8}-\d{6}\.txt", name)
