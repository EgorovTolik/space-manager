"""Unit-тесты солвера (docs/05): эталонные примеры, жёсткие условия,
диагностика невозможности и воспроизводимость по seed.

Все тесты детерминированы (фиксированные спекации и seed) и быстрые.
"""

from spaec_manager.models import CellState
from spaec_manager.rules import clusters_touch, is_circle, is_connected, is_rectangle
from spaec_manager.spec_io import parse_spec
from spaec_manager.solver import solve, solve_grid


def _spec(yaml_text: str) -> "object":
    return parse_spec(yaml_text)


BASE_SPEC = """
grid: {width: 10, height: 10}
types:
  ROOM: {symbol: "R", name: "Комната"}
  CORRIDOR: {symbol: "C", name: "Коридор"}
  WALL: {symbol: "#", name: "Стена"}
rules:
  connectivity: 8
  adjacency:
    forbidden: [[ROOM, WALL]]
clusters:
  - {id: room1, type: ROOM, areaPercent: 30, shape: free}
  - {id: room2, type: ROOM, areaPercent: 30, shape: free}
  - {id: corridor1, type: CORRIDOR, areaPercent: 40, shape: circle}
"""


def _grid_map(result) -> "dict":
    """{(x, y): instance_id or '*'/None} для сравнения карт между запусками."""
    out = {}
    for y in range(result.grid.height):
        for x in range(result.grid.width):
            cell = result.grid.cell(x, y)
            if cell.state is CellState.BLOCKED:
                out[(x, y)] = "*"
            elif cell.state is CellState.PLACED:
                out[(x, y)] = cell.instance_id
            else:
                out[(x, y)] = None
    return out


# ---------------------------------------------------------------------------
# Базовый пример (docs/03 §1): размещается, жёсткие условия соблюдены
# ---------------------------------------------------------------------------

def test_basic_spec_feasible_and_hard_constraints():
    result = solve(_spec(BASE_SPEC))
    assert result.feasible, result.infeasible_reason
    assert result.infeasible_reason is None

    placed = [i for i in result.instances.values() if not i.is_preset]
    by_id = {i.id: i for i in placed}
    assert set(by_id) == {"room1", "room2", "corridor1"}

    # Связность каждого кластера (8-окрестность).
    for inst in placed:
        assert len(inst.actual_cells) > 0
        assert is_connected(inst.actual_cells, 8), inst.id

    # Форма circle у коридора.
    corridor = by_id["corridor1"]
    assert is_circle(corridor.actual_cells, tol=3)
    assert 20 <= len(corridor.actual_cells) <= 60

    # Комнаты близки к цели (мягкое условие: 30 клеток из F=100).
    for rid in ("room1", "room2"):
        assert abs(len(by_id[rid].actual_cells) - 30) <= 15, by_id[rid]

    # Ячейки на сетке согласованы с actual_cells и не пересекаются.
    seen = set()
    for inst in placed:
        for (x, y) in inst.actual_cells:
            assert (x, y) not in seen, "пересечение кластеров"
            seen.add((x, y))
            cell = result.grid.cell(x, y)
            assert cell.state is CellState.PLACED
            assert cell.instance_id == inst.id


def test_basic_spec_forbidden_pair_respected():
    """forbidden [ROOM, WALL]: кластеров WALL нет, но правило не должно ломать поиск."""
    result = solve(_spec(BASE_SPEC))
    assert result.feasible, result.infeasible_reason


# ---------------------------------------------------------------------------
# fillAll: вся доступная площадь распределена пропорционально долям
# ---------------------------------------------------------------------------

def test_fill_all_uses_entire_area():
    spec = _spec("""
grid: {width: 8, height: 5}
types:
  A: {symbol: "A"}
  B: {symbol: "B"}
rules:
  fillAll: true
clusters:
  - {id: a1, type: A, areaPercent: 30}
  - {id: b1, type: B, areaPercent: 70}
""")
    result = solve(spec)
    assert result.feasible, result.infeasible_reason
    a = result.instances["a1"]
    b = result.instances["b1"]
    total = len(a.actual_cells) + len(b.actual_cells)
    # 40 клеток сетки: всё должно быть заполнено.
    assert total == 40, (total, len(a.actual_cells), len(b.actual_cells))
    # Пропорционально долям: 30% → ~12, 70% → ~28.
    assert abs(len(a.actual_cells) - 12) <= 3
    assert abs(len(b.actual_cells) - 28) <= 3
    assert not any("fillAll" in w for w in result.warnings), result.warnings


# ---------------------------------------------------------------------------
# Запрещённое соседство: кластеры forbidden-пары не касаются
# ---------------------------------------------------------------------------

def test_forbidden_adjacency_not_touched():
    spec = _spec("""
grid: {width: 10, height: 6}
types:
  A: {symbol: "A"}
  B: {symbol: "B"}
rules:
  adjacency:
    forbidden: [[A, B]]
clusters:
  - {id: a1, type: A, areaPercent: 50}
  - {id: b1, type: B, areaPercent: 50}
""")
    result = solve(spec)
    assert result.feasible, result.infeasible_reason
    a_cells = result.instances["a1"].actual_cells
    b_cells = result.instances["b1"].actual_cells
    assert not clusters_touch(a_cells, b_cells), "A и B не должны соприкасаться"
    # И наоборот — симметрия.
    assert not clusters_touch(b_cells, a_cells)


# ---------------------------------------------------------------------------
# Формы: rectangle — сплошной прямоугольник
# ---------------------------------------------------------------------------

def test_rectangle_shape_is_solid():
    spec = _spec("""
grid: {width: 8, height: 6}
types:
  R: {symbol: "R"}
rules: {}
clusters:
  - {id: r1, type: R, areaPercent: 25, shape: rectangle}
""")
    result = solve(spec)
    assert result.feasible, result.infeasible_reason
    cells = result.instances["r1"].actual_cells
    assert is_rectangle(cells), "кластер должен быть сплошным прямоугольником"
    # Цель 25% от 48 = 12; допустимо близкое значение.
    assert abs(len(cells) - 12) <= 6


# ---------------------------------------------------------------------------
# Preset: неподвижен, участвует в проверках adjacency
# ---------------------------------------------------------------------------

def test_preset_immovable_and_adjacency_respected(tmp_path):
    preset = tmp_path / "preset.txt"
    preset.write_text("AA...\n.....\n.....\n.....\n.....\n")
    spec = _spec("""
grid: {width: 5, height: 5}
presetFile: %s
types:
  A: {symbol: "A"}
  B: {symbol: "B"}
rules:
  adjacency:
    forbidden: [[A, B]]
clusters:
  - {id: b1, type: B, areaPercent: 40}
""" % preset)
    result = solve(spec)
    assert result.feasible, result.infeasible_reason

    # Preset-кластер на месте.
    assert "preset_A_1" in result.instances
    preset_cells = set(result.instances["preset_A_1"].actual_cells)
    assert preset_cells == {(0, 0), (1, 0)}
    for (x, y) in preset_cells:
        cell = result.grid.cell(x, y)
        assert cell.state is CellState.PLACED
        assert cell.instance_id == "preset_A_1"

    # B не перекрывает preset и не касается его (forbidden).
    b_cells = set(result.instances["b1"].actual_cells)
    assert not (b_cells & preset_cells)
    for (bx, by) in b_cells:
        for (px, py) in preset_cells:
            assert max(abs(bx - px), abs(by - py)) > 1, "B касается preset-A"


# ---------------------------------------------------------------------------
# Невозможность: не хватает свободной площади (жёсткие size.min)
# ---------------------------------------------------------------------------

def test_infeasible_area_too_small():
    spec = _spec("""
grid: {width: 4, height: 4}
types:
  A: {symbol: "A"}
  B: {symbol: "B"}
rules:
  size:
    min: 9
clusters:
  - {id: a1, type: A, areaPercent: 50}
  - {id: b1, type: B, areaPercent: 50}
""")
    result = solve(spec)
    assert not result.feasible
    assert result.infeasible_reason is not None
    assert "площади" in result.infeasible_reason, result.infeasible_reason
    # Ничего не размещено кроме блокировок/preset.
    for inst in result.instances.values():
        assert not inst.actual_cells


# ---------------------------------------------------------------------------
# Невозможность: forbidden-пара не развести (2×2 — любые два кластера касаются)
# ---------------------------------------------------------------------------

def test_infeasible_forbidden_pair_cannot_separate():
    spec = _spec("""
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
""")
    result = solve(spec)
    assert not result.feasible
    assert result.infeasible_reason is not None
    assert "соседства" in result.infeasible_reason, result.infeasible_reason


# ---------------------------------------------------------------------------
# Невозможность: форма rectangle не вписывается (крест из 9 клеток)
# ---------------------------------------------------------------------------

def test_infeasible_shape_no_fit(tmp_path):
    blocked = tmp_path / "blocked.txt"
    blocked.write_text("**.**\n**.**\n.....\n**.**\n**.**\n")
    spec = _spec("""
grid: {width: 5, height: 5}
blockedFile: %s
types:
  R: {symbol: "R"}
rules:
  size:
    min: 6
clusters:
  - {id: r1, type: R, areaPercent: 67, shape: rectangle}
""" % blocked)
    result = solve(spec)
    assert not result.feasible
    assert result.infeasible_reason is not None
    assert "rectangle" in result.infeasible_reason, result.infeasible_reason


# ---------------------------------------------------------------------------
# Воспроизводимость: одинаковый seed → идентичная карта (docs/07 §4)
# ---------------------------------------------------------------------------

def test_seed_idempotence():
    map_a = _grid_map(solve(_spec(BASE_SPEC), seed=7))
    map_b = _grid_map(solve(_spec(BASE_SPEC), seed=7))
    assert map_a == map_b, "один seed должен давать идентичный результат"

    # Другой seed тоже воспроизводим сам с собой.
    map_c1 = _grid_map(solve(_spec(BASE_SPEC), seed=99))
    map_c2 = _grid_map(solve(_spec(BASE_SPEC), seed=99))
    assert map_c1 == map_c2

    # И по умолчанию (seed не задан) — детерминированно.
    map_d1 = _grid_map(solve(_spec(BASE_SPEC)))
    map_d2 = _grid_map(solve(_spec(BASE_SPEC)))
    assert map_d1 == map_d2


# ---------------------------------------------------------------------------
# solve_grid: прямой вызов поверх готовой сетки (API из docs/05 §1)
# ---------------------------------------------------------------------------

def test_solve_grid_direct_api():
    spec = _spec("""
grid: {width: 6, height: 4}
types:
  A: {symbol: "A"}
rules: {}
clusters:
  - {id: a1, type: A, areaPercent: 50}
""")
    from spaec_manager.spec_io import prepare_placement

    grid, instances = prepare_placement(spec)
    result = solve_grid(grid, instances, spec.rules)
    assert result.feasible, result.infeasible_reason
    inst = result.instances["a1"]
    assert abs(len(inst.actual_cells) - 12) <= 4
    assert is_connected(inst.actual_cells, 8)
