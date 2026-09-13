"""Unit-тесты space_manager/report.py (docs/06)."""

from typing import Dict, List, Optional, Tuple

import pytest

from space_manager.models import (
    Cell,
    CellState,
    ClusterInstance,
    ClusterType,
    Grid,
    PlacementResult,
)
from space_manager import report


# ---------------------------------------------------------------------------
# Вспомогательные
# ---------------------------------------------------------------------------

TYPES: Dict[str, ClusterType] = {
    "ROOM": ClusterType(type_id="ROOM", symbol="R", name="Комната"),
    "CORRIDOR": ClusterType(type_id="CORRIDOR", symbol="C", name="Коридор"),
}


def make_grid(width: int, height: int) -> Grid:
    return Grid(width=width, height=height)


def place(grid: Grid, cells: List[Tuple[int, int]], instance_id: str) -> None:
    for x, y in cells:
        c = grid.cell(x, y)
        c.state = CellState.PLACED
        c.instance_id = instance_id


def block(grid: Grid, cells: List[Tuple[int, int]]) -> None:
    for x, y in cells:
        grid.cell(x, y).state = CellState.BLOCKED


def inst(id_: str, type_id: str, percent: float, target: int,
         actual: Optional[List[Tuple[int, int]]] = None, preset: bool = False) -> ClusterInstance:
    return ClusterInstance(
        id=id_, type_id=type_id, area_percent=percent,
        target_cells=target, actual_cells=list(actual or []), is_preset=preset,
    )


# ---------------------------------------------------------------------------
# §3. render_grid
# ---------------------------------------------------------------------------

class TestRenderGrid:
    def test_all_free(self):
        grid = make_grid(3, 2)
        assert report.render_grid(grid, [], TYPES) == "\n".join(["...", "..."])

    def test_blocked_and_free_symbols(self):
        grid = make_grid(4, 1)
        block(grid, [(0, 0), (3, 0)])
        assert report.render_grid(grid, [], TYPES) == "*..*"

    def test_docs_example_10x10(self):
        """Точный фрагмент из docs/06 §3: 10×10, угол 2×2 заблокирован."""
        grid = make_grid(10, 10)
        block(grid, [(0, 0), (1, 0), (0, 1), (1, 1)])
        room_cells = [(2, 0), (3, 0), (4, 0), (2, 1), (3, 1), (4, 1), (1, 2), (2, 2), (3, 2)]
        corr_cells = [(5, 0), (6, 0), (7, 0), (5, 1), (6, 1), (7, 1), (4, 2), (5, 2), (6, 2), (7, 2), (8, 2)]
        place(grid, room_cells, "room1")
        place(grid, corr_cells, "corridor1")
        instances = [inst("room1", "ROOM", 30.0, 9, room_cells),
                     inst("corridor1", "CORRIDOR", 40.0, 11, corr_cells)]
        empty = ".........."
        expected = "\n".join(["**RRRCCC..", "**RRRCCC..", ".RRRCCCCC."] + [empty] * 7)
        assert report.render_grid(grid, instances, TYPES) == expected

    def test_two_touching_clusters_same_type_render_identically(self):
        """docs/06 §3: соприкасающиеся кластеры одного типа — одинаковый символ."""
        grid = make_grid(4, 1)
        place(grid, [(0, 0), (1, 0)], "room1")
        place(grid, [(2, 0), (3, 0)], "room2")
        instances = [inst("room1", "ROOM", 25.0, 2, [(0, 0), (1, 0)]),
                     inst("room2", "ROOM", 25.0, 2, [(2, 0), (3, 0)])]
        assert report.render_grid(grid, instances, TYPES) == "RRRR"

    def test_preset_renders_with_type_symbol(self):
        grid = make_grid(3, 1)
        place(grid, [(0, 0), (1, 0)], "preset_ROOM_1")
        preset = inst("preset_ROOM_1", "ROOM", 0.0, 2, [(0, 0), (1, 0)], preset=True)
        assert report.render_grid(grid, [preset], TYPES) == "RR."

    def test_unknown_instance_id_fallback_question_mark(self):
        grid = make_grid(2, 1)
        place(grid, [(0, 0)], "missing_id")
        assert report.render_grid(grid, [], TYPES) == "?."


# ---------------------------------------------------------------------------
# §4. format_table / _deviation_text
# ---------------------------------------------------------------------------

class TestTable:
    def test_docs_example_rows(self):
        """Числа из таблицы docs/06 §4."""
        room1 = inst("room1", "ROOM", 30.0, 29, list(range(30)))   # type: ignore[arg-type]
        room2 = inst("room2", "ROOM", 30.0, 29, list(range(25)))   # type: ignore[arg-type]
        corr = inst("corridor1", "CORRIDOR", 40.0, 38, list(range(38)))  # type: ignore[arg-type]
        table = report.format_table([room1, room2, corr], TYPES)
        lines = table.split("\n")
        for header in ("id", "type", "доля (%)", "цель (клеток)", "факт (клеток)", "отклонение", "статус"):
            assert header in lines[0]
        row1, row2, row3 = lines[2:5]
        assert "room1" in row1 and "ROOM" in row1 and "30" in row1
        assert "+1 (+3%)" in row1 and "ок" in row1
        assert "-4 (-14%)" in row2 and "недостача" in row2
        assert " 0 " in row3 and "ок" in row3

    def test_excess_status(self):
        big = inst("big", "ROOM", 50.0, 10, list(range(15)))       # type: ignore[arg-type]
        table = report.format_table([big], TYPES)
        assert "+5 (+50%)" in table and "превышение" in table

    def test_preset_row_share_dash(self):
        preset = inst("preset_ROOM_1", "ROOM", 0.0, 2, [(0, 0), (1, 0)], preset=True)
        table = report.format_table([preset], TYPES)
        row = table.split("\n")[2]
        assert "preset_ROOM_1" in row and "—" in row and "ок" in row

    def test_unknown_type_id_shown_as_is(self):
        weird = inst("w", "GHOST", 10.0, 1, [(0, 0)])
        table = report.format_table([weird], TYPES)
        assert "GHOST" in table

    def test_deviation_text_helper(self):
        assert report._deviation_text(29, 29) == "0"
        assert report._deviation_text(30, 29) == "+1 (+3%)"
        assert report._deviation_text(25, 29) == "-4 (-14%)"
        assert report._deviation_text(3, 0) == "+3"

    def test_empty_instances(self):
        table = report.format_table([], TYPES)
        lines = table.split("\n")
        assert len(lines) == 2  # только заголовок + разделитель


# ---------------------------------------------------------------------------
# §5. area_warnings
# ---------------------------------------------------------------------------

class TestAreaWarnings:
    def test_significant_shortfall(self):
        room2 = inst("room2", "ROOM", 30.0, 29, list(range(25)))   # type: ignore[arg-type]
        warnings = report.area_warnings([room2])
        assert len(warnings) == 1
        text = warnings[0]
        assert text.startswith(
            "WARNING: room2 (ROOM) получился меньше запрошенного: 25 клеток вместо цели 29 (-14%).")
        assert "\n         Полностью вписать кластер в заданную долю не удалось." in text

    def test_small_deviation_no_warning(self):
        # отклонение -1 из 29 ≈ 3.4% < порога 10%
        room = inst("room", "ROOM", 30.0, 29, list(range(28)))     # type: ignore[arg-type]
        assert report.area_warnings([room]) == []

    def test_exact_target_no_warning(self):
        room = inst("room", "ROOM", 30.0, 29, list(range(29)))     # type: ignore[arg-type]
        assert report.area_warnings([room]) == []

    def test_significant_excess_warns(self):
        big = inst("big", "ROOM", 30.0, 29, list(range(35)))       # type: ignore[arg-type]
        warnings = report.area_warnings([big])
        assert len(warnings) == 1
        assert "получился больше запрошенного: 35 клеток вместо цели 29 (+21%)" in warnings[0]

    def test_preset_ignored(self):
        preset = inst("preset_ROOM_1", "ROOM", 0.0, 5, list(range(2)), preset=True)
        assert report.area_warnings([preset]) == []

    def test_zero_target_ignored(self):
        empty = inst("empty", "ROOM", 0.0, 0, [])
        assert report.area_warnings([empty]) == []

    def test_custom_threshold(self):
        room = inst("room", "ROOM", 30.0, 100, list(range(95)))    # type: ignore[arg-type]
        assert report.area_warnings([room], threshold_percent=4.0) != []
        assert report.area_warnings([room], threshold_percent=5.0) == []


# ---------------------------------------------------------------------------
# §6. infeasible_block
# ---------------------------------------------------------------------------

class TestInfeasibleBlock:
    def test_with_reason(self):
        block = report.infeasible_block(
            "кластер corridor1 (shape=circle, цель=38 клеток) не помещается: "
            "свободная область не содержит связного фрагмента достаточного размера/формы.")
        lines = block.split("\n")
        assert lines[0] == "НЕ УДАЛОСЬ РАЗМЕСТИТЬ ВСЕ КЛАСТЕРЫ."
        assert lines[1].startswith("Причина: кластер corridor1 (shape=circle, цель=38 клеток) не помещается:")
        assert lines[2] == "Рассмотрите: уменьшение доли, смену shape на free, или расширение области."

    def test_without_reason(self):
        block = report.infeasible_block(None)
        assert "Причина: конкретная причина не указана" in block


# ---------------------------------------------------------------------------
# §7. exit codes
# ---------------------------------------------------------------------------

class TestExitCodes:
    def test_constants(self):
        assert (report.EXIT_SUCCESS, report.EXIT_INFEASIBLE, report.EXIT_INPUT_ERROR) == (0, 1, 2)

    def test_exit_code_for(self):
        ok = PlacementResult(feasible=True, grid=make_grid(1, 1), instances={})
        bad = PlacementResult(feasible=False, grid=make_grid(1, 1), instances={}, infeasible_reason="x")
        assert report.exit_code_for(ok) == 0
        assert report.exit_code_for(bad) == 1


# ---------------------------------------------------------------------------
# build_report
# ---------------------------------------------------------------------------

class TestBuildReport:
    def _result(self, feasible: bool = True, reason: Optional[str] = None,
                warnings: Optional[List[str]] = None) -> PlacementResult:
        grid = make_grid(4, 2)
        block(grid, [(0, 0)])
        room_cells = [(1, 0), (2, 0), (3, 0)]
        place(grid, room_cells, "room1")
        instances = {
            "preset_ROOM_1": inst("preset_ROOM_1", "ROOM", 0.0, 1, [(1, 1)], preset=True),
            "room1": inst("room1", "ROOM", 25.0, 3, room_cells),
        }
        for x, y in [(1, 1)]:
            grid.cell(x, y).state = CellState.PLACED
            grid.cell(x, y).instance_id = "preset_ROOM_1"
        return PlacementResult(feasible=feasible, grid=grid, instances=instances,
                               warnings=list(warnings or []), infeasible_reason=reason)

    def test_feasible_full_report(self):
        text = report.build_report(self._result(), TYPES)
        assert "== КАРТА ==" in text
        # карта: *RRR / .R..
        assert "*RRR\n.R.." in text
        assert "== ТАБЛИЦА: запрошено / фактически / отклонение ==" in text
        assert "room1" in text and "ок" in text
        assert "== ПРЕДУПРЕЖДЕНИЯ ==" in text
        assert text.rstrip().endswith("нет")

    def test_feasible_with_warning(self):
        grid = make_grid(4, 2)
        room_cells = [(0, 0), (1, 0)]
        place(grid, room_cells, "room1")
        result = PlacementResult(
            feasible=True, grid=grid,
            instances={"room1": inst("room1", "ROOM", 50.0, 4, room_cells)})
        text = report.build_report(result, TYPES)
        assert "WARNING: room1 (ROOM) получился меньше запрошенного: 2 клеток вместо цели 4 (-50%)." in text

    def test_external_warnings_passthrough(self):
        result = self._result(warnings=["custom warning from solver"])
        text = report.build_report(result, TYPES)
        assert "custom warning from solver" in text

    def test_infeasible_report(self):
        reason = ("кластер corridor1 (shape=circle, цель=38 клеток) не помещается: "
                  "свободная область не содержит связного фрагмента достаточного размера/формы.")
        result = self._result(feasible=False, reason=reason)
        text = report.build_report(result, TYPES)
        assert text.startswith("НЕ УДАЛОСЬ РАЗМЕСТИТЬ ВСЕ КЛАСТЕРЫ.\n")
        assert "Причина: {0}".format(reason) in text
        assert "Рассмотрите: уменьшение доли, смену shape на free, или расширение области." in text
        # карта и таблица тоже присутствуют (частичное размещение)
        assert "== КАРТА ==" in text
        assert "== ТАБЛИЦА:" in text

    def test_no_trailing_newline(self):
        assert not report.build_report(self._result(), TYPES).endswith("\n")
