"""Тесты парсинга и валидации спекации (docs/03, подзадача 2).

Позитивные: полный пример docs/03 §1, дефолты, блокировки (F = 96 для 2×2 угла
на 10×10), preset-группы, whitelist/fillAll/size.
Отрицательные: каждый тип ошибки из docs/03 §5 (+ некорректный YAML, отсутствующий файл).
"""

import pytest

from spaec_manager.models import CellState, Shape
from spaec_manager.spec_io import (
    SpecValidationError,
    area_base,
    load_spec,
    parse_spec,
    prepare_placement,
    read_blocked_file,
    read_preset_file,
)

FULL_EXAMPLE = """
grid:
  width: 10
  height: 10
types:
  ROOM:     { symbol: "R", name: "Комната" }
  CORRIDOR: { symbol: "C", name: "Коридор" }
  WALL:     { symbol: "#", name: "Стена" }
rules:
  connectivity: 8
  adjacency:
    forbidden:
      - [ROOM, WALL]
    allow: null
  size:
    min: null
    max: null
  convexity:
    weight: soft
  fillAll: false
clusters:
  - id: room1
    type: ROOM
    areaPercent: 30
    shape: free
  - id: room2
    type: ROOM
    areaPercent: 30
    shape: free
  - id: corridor1
    type: CORRIDOR
    areaPercent: 40
    shape: circle
"""


def minimal_spec(width=6, height=6, cluster_block="    areaPercent: 50\n", extra_top=""):
    """Минимальная спекация в block-style (удобно для insert-ов)."""
    return (
        "grid:\n"
        "  width: {w}\n"
        "  height: {h}\n"
        "{extra}"
        "types:\n"
        '  ROOM: {{symbol: "R"}}\n'
        "clusters:\n"
        "  - id: room1\n"
        "    type: ROOM\n"
        "{cluster_block}"
    ).format(w=width, h=height, extra=extra_top, cluster_block=cluster_block)


# ---------------------------------------------------------------------------
# Позитивные сценарии
# ---------------------------------------------------------------------------

def test_full_example_from_docs():
    spec = parse_spec(FULL_EXAMPLE)
    assert spec.grid_dims == (10, 10)
    assert set(spec.types) == {"ROOM", "CORRIDOR", "WALL"}
    assert spec.types["ROOM"].symbol == "R"
    assert spec.types["ROOM"].name == "Комната"
    assert spec.types["CORRIDOR"].name == "Коридор"

    rules = spec.rules
    assert rules.connectivity == 8
    assert frozenset({"ROOM", "WALL"}) in rules.adjacency_forbidden
    assert rules.adjacency_allow is None
    assert rules.size_min is None and rules.size_max is None
    assert rules.convexity_weight == "soft"
    assert rules.fill_all is False

    assert [c.id for c in spec.clusters] == ["room1", "room2", "corridor1"]
    assert [c.shape for c in spec.clusters] == [Shape.FREE, Shape.FREE, Shape.CIRCLE]
    assert [c.area_percent for c in spec.clusters] == [30.0, 30.0, 40.0]


def test_defaults_when_rules_and_shape_missing():
    spec = parse_spec(minimal_spec())
    rules = spec.rules
    assert rules.connectivity == 8
    assert rules.adjacency_forbidden == set()
    assert rules.adjacency_allow is None
    assert rules.size_min is None and rules.size_max is None
    assert rules.convexity_weight == "soft"
    assert rules.fill_all is False
    assert spec.clusters[0].shape is Shape.FREE


def test_allow_whitelist_fillall_and_size():
    text = """
grid: {{width: 4, height: 4}}
types:
  ROOM: {{symbol: "R"}}
  WALL: {{symbol: "#"}}
rules:
  adjacency:
    allow:
      - [ROOM, WALL]
  size: {{min: 3, max: 10}}
  fillAll: true
clusters:
  - id: room1
    type: ROOM
    areaPercent: 50
""".format()
    spec = parse_spec(text)
    assert spec.rules.adjacency_allow == frozenset({frozenset({"ROOM", "WALL"})})
    assert spec.rules.size_min == 3 and spec.rules.size_max == 10
    assert spec.rules.fill_all is True


def test_blocked_corner_f96(tmp_path):
    # 10×10 с заблокированным левым верхним углом 2×2 → F = 96 (docs/03 §2).
    blocked_lines = ["**........", "**........"] + [".........."] * 8
    blocked_path = tmp_path / "blocked.txt"
    blocked_path.write_text("\n".join(blocked_lines) + "\n", encoding="utf-8")

    spec_path = tmp_path / "spec.yaml"
    spec_path.write_text(
        minimal_spec(10, 10, extra_top="blockedFile: ./blocked.txt\n"), encoding="utf-8"
    )
    spec = load_spec(str(spec_path))
    assert spec.blocked_file == str(blocked_path)  # абсолютный путь

    grid, instances = prepare_placement(spec)
    assert area_base(grid) == 96
    for x, y in ((0, 0), (1, 0), (0, 1), (1, 1)):
        assert grid.cell(x, y).state is CellState.BLOCKED
    assert grid.cell(2, 0).state is CellState.FREE
    # room1: round(96 * 50 / 100) = 48
    assert instances[0].target_cells == 48


def test_read_blocked_file_returns_set(tmp_path):
    path = tmp_path / "b.txt"
    path.write_text("********\n........", encoding="utf-8")
    blocked = read_blocked_file(str(path), 8, 2)
    assert blocked == {(x, 0) for x in range(8)}


def test_preset_groups_and_targets(tmp_path):
    # 5×5: два связных (8-окрестность) кластера A + одиночка B.
    preset_lines = [
        "AA.B.",
        "A....",
        ".....",
        "AA...",
        ".....",
    ]
    preset_path = tmp_path / "preset.txt"
    preset_path.write_text("\n".join(preset_lines) + "\n", encoding="utf-8")

    text = (
        "grid:\n  width: 5\n  height: 5\n"
        "presetFile: ./preset.txt\n"
        'types:\n  A: {symbol: "A"}\n  B: {symbol: "B"}\n'
        "clusters:\n  - id: a_extra\n    type: A\n    areaPercent: 40\n"
    )
    spec_path = tmp_path / "spec.yaml"
    spec_path.write_text(text, encoding="utf-8")
    spec = load_spec(str(spec_path))

    grid, instances = prepare_placement(spec)

    # F считает только «не блокировки»: preset не уменьшает базу → F = 25.
    assert area_base(grid) == 25
    a_instances = [i for i in instances if i.type_id == "A" and i.is_preset]
    b_instances = [i for i in instances if i.type_id == "B" and i.is_preset]
    assert len(a_instances) == 2  # две связные группы A
    assert sorted(len(i.actual_cells) for i in a_instances) == [2, 3]
    assert len(b_instances) == 1 and b_instances[0].target_cells == 1
    assert all(i.is_preset for i in instances[:3])

    # preset-клетки помечены PLACED со своим id экземпляра.
    placed_ids = {c.instance_id for row in grid.cells for c in row if c.state is CellState.PLACED}
    assert placed_ids == {"preset_A_1", "preset_A_2", "preset_B_1"}

    # запрошенный кластер: round(25 * 40 / 100) = 10.
    extra = [i for i in instances if not i.is_preset][0]
    assert extra.id == "a_extra" and extra.target_cells == 10


def test_read_preset_file_free_symbols_ignored(tmp_path):
    preset_path = tmp_path / "p.txt"
    preset_path.write_text("A.B\n...\n", encoding="utf-8")
    groups = read_preset_file(str(preset_path), 3, 2, {"A": "T1", "B": "T2"})
    assert groups == [("T1", [(0, 0)]), ("T2", [(2, 0)])]


def test_no_files_trivial_spec():
    spec = parse_spec(minimal_spec(3, 3))
    assert spec.blocked_file is None and spec.preset_file is None
    grid, instances = prepare_placement(spec)
    assert area_base(grid) == 9
    assert instances[0].target_cells == round(9 * 50 / 100)


# ---------------------------------------------------------------------------
# docs/03 §5 — каждый тип ошибки входа
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("bad", [0, -2, "ten", 2.5])
def test_error_grid_dims_not_positive_int(bad):
    text = minimal_spec().replace(
        "width: 6", "width: {}".format(bad if isinstance(bad, str) else bad), 1
    )
    # строковые/дробные значения без кавычек — валидный YAML с неверным типом
    with pytest.raises(SpecValidationError, match="grid.width"):
        parse_spec(text)


def test_error_grid_missing():
    text = 'types:\n  ROOM: {symbol: "R"}\nclusters: []\n'
    with pytest.raises(SpecValidationError, match="'grid'"):
        parse_spec(text)


@pytest.mark.parametrize("rows,cols", [
    (3, 8),  # неверное число строк
    (4, 5),  # неверная длина строк
])
def test_error_blocked_file_size_mismatch(tmp_path, rows, cols):
    blocked = tmp_path / "blocked.txt"
    blocked.write_text("\n".join("........"[:cols] for _ in range(rows)) + "\n", encoding="utf-8")
    spec_path = tmp_path / "spec.yaml"
    spec_path.write_text(
        minimal_spec(8, 4, extra_top="blockedFile: ./blocked.txt\n"), encoding="utf-8"
    )
    with pytest.raises(SpecValidationError, match="размеру"):
        load_spec(str(spec_path))


def test_error_preset_file_size_mismatch(tmp_path):
    preset = tmp_path / "preset.txt"
    preset.write_text("A.\n", encoding="utf-8")  # 1 строка вместо 4
    spec_path = tmp_path / "spec.yaml"
    spec_path.write_text(
        minimal_spec(2, 4, extra_top="presetFile: ./preset.txt\n"), encoding="utf-8"
    )
    with pytest.raises(SpecValidationError, match="preset"):
        load_spec(str(spec_path))


def test_error_blocked_file_missing(tmp_path):
    spec_path = tmp_path / "spec.yaml"
    spec_path.write_text(
        minimal_spec(4, 4, extra_top="blockedFile: ./nope.txt\n"), encoding="utf-8"
    )
    with pytest.raises(SpecValidationError, match="не найден"):
        load_spec(str(spec_path))


def test_error_cluster_unknown_type():
    text = minimal_spec().replace("type: ROOM", "type: GHOST")
    with pytest.raises(SpecValidationError, match="неизвестный тип 'GHOST'"):
        parse_spec(text)


def test_error_duplicate_cluster_id():
    text = minimal_spec() + """  - id: room1
    type: ROOM
    areaPercent: 10
"""
    with pytest.raises(SpecValidationError, match="дублируется id экземпляра 'room1'"):
        parse_spec(text)


def test_error_sum_area_percent_over_100():
    text = minimal_spec(cluster_block="    areaPercent: 60\n") + """  - id: room2
    type: ROOM
    areaPercent: 50
"""
    with pytest.raises(SpecValidationError, match="превышает 100"):
        parse_spec(text)


def test_error_adjacency_unknown_type_forbidden():
    text = minimal_spec() + """
rules:
  adjacency:
    forbidden:
      - [ROOM, GHOST]
"""
    with pytest.raises(SpecValidationError, match="adjacency.forbidden.*GHOST"):
        parse_spec(text)


def test_error_adjacency_unknown_type_allow():
    text = minimal_spec() + """
rules:
  adjacency:
    allow:
      - [ROOM, GHOST]
"""
    with pytest.raises(SpecValidationError, match="adjacency.allow.*GHOST"):
        parse_spec(text)


def test_error_bad_shape():
    text = minimal_spec(cluster_block="    areaPercent: 50\n    shape: sphere\n")
    with pytest.raises(SpecValidationError, match="shape.*sphere"):
        parse_spec(text)


def test_error_invalid_yaml_syntax():
    with pytest.raises(SpecValidationError, match="YAML"):
        parse_spec("grid: [width: 10")


def test_error_area_percent_out_of_range():
    text = minimal_spec(cluster_block="    areaPercent: 0\n")
    with pytest.raises(SpecValidationError, match="areaPercent"):
        parse_spec(text)
