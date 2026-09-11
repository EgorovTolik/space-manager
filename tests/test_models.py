"""Unit-тесты доменной модели (docs/02)."""

from spaec_manager.models import (
    Cell,
    CellState,
    ClusterInstance,
    ClusterType,
    Grid,
    PlacementResult,
    PlacementSpec,
    Ruleset,
    Shape,
)


# ---------------------------------------------------------------------------
# Cell
# ---------------------------------------------------------------------------

def test_cell_default_is_free():
    c = Cell()
    assert c.state is CellState.FREE
    assert c.instance_id is None


def test_cell_blocked():
    c = Cell(state=CellState.BLOCKED)
    assert c.state is CellState.BLOCKED
    assert c.instance_id is None


def test_cell_placed_stores_instance_id_not_symbol():
    c = Cell(state=CellState.PLACED, instance_id="room1")
    assert c.state is CellState.PLACED
    assert c.instance_id == "room1"


# ---------------------------------------------------------------------------
# ClusterType
# ---------------------------------------------------------------------------

def test_cluster_type():
    t = ClusterType(type_id="ROOM", symbol="R", name="Комната")
    assert t.type_id == "ROOM"
    assert t.symbol == "R"
    assert t.name == "Комната"


def test_cluster_type_name_optional():
    t = ClusterType(type_id="WALL", symbol="W")
    assert t.name is None


def test_cluster_type_is_frozen():
    t = ClusterType(type_id="ROOM", symbol="R")
    try:
        t.symbol = "X"  # type: ignore[misc]
        raise AssertionError("ClusterType должен быть неизменяемым (frozen)")
    except Exception as e:
        assert isinstance(e, AttributeError)


# ---------------------------------------------------------------------------
# Shape / ClusterInstance
# ---------------------------------------------------------------------------

def test_shape_values():
    assert {s.value for s in Shape} == {"free", "rectangle", "circle"}


def test_cluster_instance_defaults():
    ci = ClusterInstance(id="room1", type_id="ROOM", area_percent=25.0)
    assert ci.shape is Shape.FREE
    assert ci.target_cells == 0
    assert ci.actual_cells == []
    assert ci.is_preset is False


def test_cluster_instance_full():
    ci = ClusterInstance(
        id="wall1",
        type_id="WALL",
        area_percent=10.0,
        shape=Shape.RECTANGLE,
        target_cells=9,
        actual_cells=[(0, 0), (1, 0)],
        is_preset=True,
    )
    assert ci.shape is Shape.RECTANGLE
    assert ci.target_cells == 9
    assert ci.actual_cells == [(0, 0), (1, 0)]
    assert ci.is_preset is True


def test_cluster_instance_actual_cells_independent_per_instance():
    a = ClusterInstance(id="a", type_id="ROOM", area_percent=5.0)
    b = ClusterInstance(id="b", type_id="ROOM", area_percent=5.0)
    a.actual_cells.append((1, 1))
    assert b.actual_cells == []


# ---------------------------------------------------------------------------
# Grid
# ---------------------------------------------------------------------------

def make_grid(w: int, h: int):
    return Grid(width=w, height=h)


def test_grid_empty_default_all_free():
    g = make_grid(4, 3)
    assert g.width == 4 and g.height == 3
    assert len(g.cells) == 3 and all(len(row) == 4 for row in g.cells)
    assert all(c.state is CellState.FREE for row in g.cells for c in row)


def test_grid_size_validation():
    for args in ((0, 5), (5, 0)):
        try:
            Grid(width=args[0], height=args[1])
            raise AssertionError("ожидается ValueError для некорректного размера")
        except ValueError:
            pass


def test_grid_cells_dimension_mismatch():
    cells = [[Cell() for _ in range(2)] for _ in range(2)]
    try:
        Grid(width=3, height=2, cells=cells)
        raise AssertionError("ожидается ValueError при несоответствии размеров")
    except ValueError:
        pass


def test_grid_custom_cells():
    cells = [[Cell() for _ in range(2)] for _ in range(2)]
    cells[0][1].state = CellState.BLOCKED
    g = Grid(width=2, height=2, cells=cells)
    assert g.is_free(0, 0) is True
    assert g.is_free(1, 0) is False


def test_grid_is_free_out_of_bounds():
    g = make_grid(3, 3)
    for x, y in ((-1, 0), (0, -1), (3, 0), (0, 3), (9, 9)):
        assert g.is_free(x, y) is False


def test_grid_cell_out_of_bounds():
    g = make_grid(2, 2)
    try:
        g.cell(5, 0)
        raise AssertionError("ожидается IndexError вне сетки")
    except IndexError:
        pass


def test_grid_in_bounds():
    g = make_grid(2, 3)
    assert g.in_bounds(1, 2) is True
    assert g.in_bounds(2, 0) is False


def test_grid_available_area_excludes_blocked_and_placed():
    cells = [[Cell() for _ in range(4)] for _ in range(4)]
    # заблокированный угол 2×2 (пример из docs/02 §8: 10x10 → F=96)
    cells[0][0].state = CellState.BLOCKED
    cells[0][1].state = CellState.BLOCKED
    cells[1][0].state = CellState.BLOCKED
    cells[1][1].state = CellState.BLOCKED
    # один placed-кластер из 2 клеток
    cells[3][0].state = CellState.PLACED
    cells[3][1] = Cell(state=CellState.PLACED, instance_id="room1")
    g = Grid(width=4, height=4, cells=cells)
    # 16 - 4 blocked - 2 placed = 10
    assert g.available_area() == 10


def test_grid_available_area_full_free():
    g = make_grid(10, 10)
    assert g.available_area() == 100


# ---------------------------------------------------------------------------
# Ruleset
# ---------------------------------------------------------------------------

def test_ruleset_defaults():
    r = Ruleset()
    assert r.connectivity == 8
    assert r.adjacency_forbidden == set()
    assert r.adjacency_allow is None  # default-open
    assert r.size_min is None
    assert r.size_max is None
    assert r.convexity_weight == "soft"
    assert r.fill_all is False


def test_ruleset_forbidden_pairs():
    r = Ruleset(adjacency_forbidden={frozenset({"ROOM", "WALL"})})
    # пары неупорядоченные (docs/04 §2)
    assert frozenset({"WALL", "ROOM"}) in r.adjacency_forbidden


def test_ruleset_allow_whitelist():
    allow = frozenset({frozenset({"ROOM", "CORRIDOR"})})
    r = Ruleset(adjacency_allow=allow, size_min=4, size_max=50, fill_all=True)
    assert r.adjacency_allow == allow
    assert r.size_min == 4 and r.size_max == 50
    assert r.fill_all is True


def test_ruleset_is_frozen():
    r = Ruleset()
    try:
        r.connectivity = 4  # type: ignore[misc]
        raise AssertionError("Ruleset должен быть неизменяемым (frozen)")
    except Exception as e:
        assert isinstance(e, AttributeError)


def test_ruleset_forbidden_set_independent_per_instance():
    a = Ruleset()
    b = Ruleset()
    a.adjacency_forbidden.add(frozenset({"A", "B"}))  # type: ignore[misc]
    assert b.adjacency_forbidden == set()


# ---------------------------------------------------------------------------
# PlacementSpec / PlacementResult
# ---------------------------------------------------------------------------

def test_placement_spec():
    types = {
        "ROOM": ClusterType(type_id="ROOM", symbol="R", name="Комната"),
        "WALL": ClusterType(type_id="WALL", symbol="W"),
    }
    clusters = [
        ClusterInstance(id="room1", type_id="ROOM", area_percent=60.0),
        ClusterInstance(id="wall1", type_id="WALL", area_percent=20.0, shape=Shape.RECTANGLE),
    ]
    spec = PlacementSpec(
        grid_dims=(10, 10),
        blocked_file="examples/blocked_basic.txt",
        preset_file=None,
        types=types,
        rules=Ruleset(),
        clusters=clusters,
    )
    assert spec.grid_dims == (10, 10)
    assert spec.blocked_file == "examples/blocked_basic.txt"
    assert spec.preset_file is None
    assert set(spec.types) == {"ROOM", "WALL"}
    assert len(spec.clusters) == 2


def test_placement_spec_no_files():
    spec = PlacementSpec(
        grid_dims=(5, 5),
        blocked_file=None,
        preset_file=None,
        types={},
        rules=Ruleset(),
        clusters=[],
    )
    assert spec.blocked_file is None and spec.preset_file is None


def test_placement_result_defaults():
    g = make_grid(3, 3)
    res = PlacementResult(feasible=True, grid=g, instances={})
    assert res.warnings == []
    assert res.infeasible_reason is None


def test_placement_result_infeasible():
    g = make_grid(3, 3)
    ci = ClusterInstance(id="room1", type_id="ROOM", area_percent=90.0)
    res = PlacementResult(
        feasible=False,
        grid=g,
        instances={"room1": ci},
        warnings=["room1 получился меньше запрошенного"],
        infeasible_reason="недостаточно доступной площади",
    )
    assert res.feasible is False
    assert len(res.warnings) == 1
    assert "площади" in res.infeasible_reason
    assert res.instances["room1"] is ci
