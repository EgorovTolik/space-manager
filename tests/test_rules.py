"""Unit-тесты space_manager/rules.py (docs/04, docs/05 §2/§4).

Позитивные и негативные кейсы для каждого валидатора/оценщика:
8-связность vs 4, диагональный контакт adjacency, circle с допуском,
fill_ratio на вырожденных формах.
"""

import pytest

from space_manager.models import Ruleset
from space_manager.rules import (
    adjacency_ok,
    adjacency_violation,
    all_clusters_touch,
    allocate_proportional,
    circle_deviation,
    clusters_touch,
    convexity_penalty,
    fill_ratio,
    is_circle,
    is_connected,
    is_rectangle,
    size_ok,
    soft_cost,
)


# ---------------------------------------------------------------------------
# is_connected (docs/04 §1)
# ---------------------------------------------------------------------------

class TestIsConnected:
    def test_single_cell(self):
        assert is_connected([(3, 2)]) is True

    def test_empty_is_connected(self):
        assert is_connected([]) is True

    def test_diagonal_chain_8_connected(self):
        # Диагональная цепочка — связна в 8-окрестности.
        assert is_connected([(0, 0), (1, 1), (2, 2)], connectivity=8) is True

    def test_diagonal_chain_not_4_connected(self):
        # Те же клетки не связаны ортогонально.
        assert is_connected([(0, 0), (1, 1), (2, 2)], connectivity=4) is False

    def test_l_shape_8_and_4(self):
        cells = [(0, 0), (1, 0), (1, 1)]
        assert is_connected(cells, connectivity=8) is True
        assert is_connected(cells, connectivity=4) is True

    def test_two_separate_components(self):
        cells = [(0, 0), (1, 0), (5, 5)]
        assert is_connected(cells) is False

    def test_rectangle_block_connected(self):
        cells = [(x, y) for x in range(3) for y in range(2)]
        assert is_connected(cells, connectivity=8) is True
        assert is_connected(cells, connectivity=4) is True

    def test_duplicates_do_not_break_connectivity(self):
        assert is_connected([(0, 0), (1, 1), (0, 0)]) is True

    def test_invalid_connectivity_raises(self):
        with pytest.raises(ValueError):
            is_connected([(0, 0)], connectivity=6)


# ---------------------------------------------------------------------------
# is_rectangle (docs/04 §4)
# ---------------------------------------------------------------------------

class TestIsRectangle:
    def test_full_2x3_block(self):
        cells = [(x, y) for x in range(3) for y in range(2)]
        assert is_rectangle(cells) is True

    def test_single_cell_is_1x1_rectangle(self):
        assert is_rectangle([(7, 7)]) is True

    def test_missing_corner(self):
        cells = set((x, y) for x in range(3) for y in range(2)) - {(0, 0)}
        assert is_rectangle(cells) is False

    def test_plus_shape_same_bbox_not_full(self):
        # Крест из 5 клеток в bbox 3×3: не весь bbox.
        cells = [(1, 0), (0, 1), (1, 1), (2, 1), (1, 2)]
        assert is_rectangle(cells) is False

    def test_hollow_ring(self):
        # Кольцо 3×3 без центра: bbox не заполнен.
        cells = set((x, y) for x in range(3) for y in range(3)) - {(1, 1)}
        assert is_rectangle(cells) is False

    def test_empty_not_rectangle(self):
        assert is_rectangle([]) is False

    def test_duplicates_not_rectangle(self):
        # Две одинаковые клетки + одна рядом: set'ом это 2 клетки в bbox 1×2,
        # но исходный набор с дублем — не сплошной прямоугольник.
        assert is_rectangle([(0, 0), (0, 0), (0, 1)]) is False

    def test_diagonal_pair_not_rectangle(self):
        assert is_rectangle([(0, 0), (1, 1)]) is False


# ---------------------------------------------------------------------------
# circle: метрика Чебышёва, допуск tol (docs/04 §4, решение docs/07 §6)
# ---------------------------------------------------------------------------

CHEB_DISK_R1 = set((x, y) for x in range(-1, 2) for y in range(-1, 2))  # 3×3 вокруг (0,0)


class TestCircle:
    def test_exact_chebyshev_disk_r1(self):
        assert circle_deviation(CHEB_DISK_R1) == 0
        assert is_circle(CHEB_DISK_R1) is True

    def test_single_cell_is_disk_r0(self):
        assert circle_deviation([(2, 5)]) == 0
        assert is_circle([(2, 5)]) is True

    def test_disk_with_one_missing_corner_within_tol(self):
        cells = CHEB_DISK_R1 - {(-1, -1)}
        assert circle_deviation(cells) == 1
        assert is_circle(cells, tol=3) is True
        assert is_circle(cells, tol=0) is False

    def test_plus_shape_exceeds_default_tol(self):
        # Крест (5 клеток в 3×3): отклонение 4 > по умолчанию 3.
        cells = [(1, 0), (0, 1), (1, 1), (2, 1), (1, 2)]
        assert circle_deviation(cells) == 4
        assert is_circle(cells) is False
        assert is_circle(cells, tol=4) is True

    def test_straight_line_not_circle(self):
        # Пять клеток в ряд: лучший диск — R=0 в центре ряда, отклонение 4 > tol.
        cells = [(x, 0) for x in range(5)]
        assert circle_deviation(cells) == 4
        assert is_circle(cells) is False

    def test_rect_2x3_not_circle(self):
        cells = [(x, y) for x in range(3) for y in range(2)]
        # Лучший диск: R=1 (9 клеток), не хватает 3 — в допуске по умолчанию.
        assert circle_deviation(cells) == 3
        assert is_circle(cells, tol=3) is True
        assert is_circle(cells, tol=2) is False

    def test_extra_stray_cell_counts_in_deviation(self):
        cells = CHEB_DISK_R1 | {(4, 0)}
        # Лишняя клетка на расстоянии 4: при R=4 не хватает 55 — лучше остаться
        # с отклонением 1 (лишняя клетка вне диска).
        assert circle_deviation(cells) == 1

    def test_negative_tol_raises(self):
        with pytest.raises(ValueError):
            is_circle(CHEB_DISK_R1, tol=-1)


# ---------------------------------------------------------------------------
# fill_ratio / convexity_penalty (docs/04 §5)
# ---------------------------------------------------------------------------

class TestFillRatio:
    def test_rectangle_is_one(self):
        cells = [(x, y) for x in range(3) for y in range(2)]
        assert fill_ratio(cells) == pytest.approx(1.0)

    def test_single_cell_is_one(self):
        assert fill_ratio([(0, 0)]) == pytest.approx(1.0)

    def test_l_shape_in_2x2(self):
        cells = [(0, 0), (1, 0), (1, 1)]
        assert fill_ratio(cells) == pytest.approx(3 / 4)

    def test_plus_shape_in_3x3(self):
        cells = [(1, 0), (0, 1), (1, 1), (2, 1), (1, 2)]
        assert fill_ratio(cells) == pytest.approx(5 / 9)

    def test_empty_degenerate_is_zero(self):
        assert fill_ratio([]) == 0.0

    def test_diagonal_pair_in_2x2(self):
        assert fill_ratio([(0, 0), (1, 1)]) == pytest.approx(0.5)


class TestConvexityPenalty:
    def test_soft_penalty_is_one_minus_fill(self):
        rules = Ruleset()  # по умолчанию convexity_weight="soft"
        cells = [(0, 0), (1, 0), (1, 1)]
        assert convexity_penalty(cells, rules) == pytest.approx(1.0 - 3 / 4)

    def test_soft_rectangle_zero_penalty(self):
        rules = Ruleset(convexity_weight="soft")
        cells = [(x, y) for x in range(2) for y in range(2)]
        assert convexity_penalty(cells, rules) == pytest.approx(0.0)

    def test_hard_reserved_returns_zero(self):
        # "hard" зарезервирован в текущем срезе — штраф не применяется.
        rules = Ruleset(convexity_weight="hard")
        cells = [(1, 0), (0, 1), (1, 1), (2, 1), (1, 2)]
        assert convexity_penalty(cells, rules) == 0.0


# ---------------------------------------------------------------------------
# adjacency_ok / clusters_touch / adjacency_violation (docs/04 §1–2)
# ---------------------------------------------------------------------------

FORBIDDEN_RW = Ruleset(adjacency_forbidden={frozenset({"ROOM", "WALL"})})
ALLOW_RC = Ruleset(
    adjacency_allow=frozenset({frozenset({"ROOM", "CORRIDOR"})}),
    adjacency_forbidden={frozenset({"ROOM", "WALL"})},
)


class TestAdjacencyOk:
    def test_same_type_always_allowed(self):
        # Однотипные кластеры могут касаться — даже при default-open и blacklist.
        assert adjacency_ok("ROOM", "ROOM", Ruleset()) is True
        assert adjacency_ok("WALL", "WALL", FORBIDDEN_RW) is True

    def test_default_open_forbidden_pair(self):
        assert adjacency_ok("ROOM", "WALL", FORBIDDEN_RW) is False
        assert adjacency_ok("WALL", "ROOM", FORBIDDEN_RW) is False  # симметрия
        assert adjacency_ok("ROOM", "CORRIDOR", FORBIDDEN_RW) is True

    def test_default_open_no_forbidden(self):
        assert adjacency_ok("A", "B", Ruleset()) is True

    def test_whitelist_only_listed_pairs(self):
        assert adjacency_ok("ROOM", "CORRIDOR", ALLOW_RC) is True
        assert adjacency_ok("CORRIDOR", "WALL", ALLOW_RC) is False

    def test_forbidden_wins_over_allow(self):
        # Пара в обоих списках — всё равно запрещена (docs/04 §2, п. 2).
        rules = Ruleset(
            adjacency_allow=frozenset({frozenset({"ROOM", "WALL"})}),
            adjacency_forbidden={frozenset({"ROOM", "WALL"})},
        )
        assert adjacency_ok("ROOM", "WALL", rules) is False


class TestClustersTouch:
    def test_orthogonal_contact(self):
        assert clusters_touch([(0, 0)], [(1, 0)]) is True

    def test_diagonal_contact(self):
        # Диагональ — тоже «соприкосновение» по 8-окрестности.
        assert clusters_touch([(0, 0)], [(1, 1)]) is True

    def test_gap_of_one_no_contact(self):
        assert clusters_touch([(0, 0)], [(2, 0)]) is False
        assert clusters_touch([(0, 0)], [(2, 2)]) is False

    def test_disjoint_blocks_no_contact(self):
        a = [(x, y) for x in range(2) for y in range(2)]
        b = [(x + 3, y) for x in range(2) for y in range(2)]
        assert clusters_touch(a, b) is False

    def test_empty_sets_do_not_touch(self):
        assert clusters_touch([], [(0, 0)]) is False
        assert clusters_touch([], []) is False


class TestAdjacencyViolation:
    def test_forbidden_pair_in_contact_is_violation(self):
        a = [(0, 0), (1, 0)]
        b = [(2, 0)]
        assert adjacency_violation(a, "ROOM", b, "WALL", FORBIDDEN_RW) is True

    def test_forbidden_pair_not_touching_no_violation(self):
        a = [(0, 0)]
        b = [(5, 5)]
        assert adjacency_violation(a, "ROOM", b, "WALL", FORBIDDEN_RW) is False

    def test_allowed_pair_in_contact_no_violation(self):
        a = [(0, 0)]
        b = [(1, 1)]  # диагональный контакт
        assert adjacency_violation(a, "ROOM", b, "CORRIDOR", FORBIDDEN_RW) is False

    def test_same_type_in_contact_no_violation(self):
        a = [(0, 0), (1, 0)]
        b = [(2, 0)]
        assert adjacency_violation(a, "ROOM", b, "ROOM", Ruleset()) is False

    def test_whitelist_pair_not_allowed_in_contact_is_violation(self):
        a = [(0, 0)]
        b = [(1, 0)]
        assert adjacency_violation(a, "CORRIDOR", b, "WALL", ALLOW_RC) is True


# ---------------------------------------------------------------------------
# size_ok (docs/04 §3)
# ---------------------------------------------------------------------------

class TestSizeOk:
    def test_no_limits_always_ok(self):
        assert size_ok(0, Ruleset()) is True
        assert size_ok(12345, Ruleset()) is True

    def test_within_inclusive_bounds(self):
        rules = Ruleset(size_min=3, size_max=7)
        assert size_ok(3, rules) is True
        assert size_ok(5, rules) is True
        assert size_ok(7, rules) is True

    def test_below_min_fails(self):
        assert size_ok(2, Ruleset(size_min=3)) is False

    def test_above_max_fails(self):
        assert size_ok(8, Ruleset(size_max=7)) is False

    def test_negative_size_raises(self):
        with pytest.raises(ValueError):
            size_ok(-1, Ruleset())


# ---------------------------------------------------------------------------
# allocate_proportional (fillAll, docs/04 §6) и soft_cost (docs/05 §2)
# ---------------------------------------------------------------------------

class TestAllocateProportional:
    def test_exact_split(self):
        assert allocate_proportional(100, [60.0, 40.0]) == [60, 40]

    def test_sum_is_exactly_total_with_remainders(self):
        out = allocate_proportional(10, [33.0, 33.0, 34.0])
        assert sum(out) == 10
        assert sorted(out) == [3, 3, 4]

    def test_surplus_not_piled_into_one_cluster(self):
        # «Лишнее» распределяется пропорционально, а не сваливается в один кластер.
        out = allocate_proportional(21, [50.0, 50.0])
        assert sum(out) == 21
        assert max(out) - min(out) <= 1

    def test_zero_total(self):
        assert allocate_proportional(0, [30.0, 70.0]) == [0, 0]

    def test_all_zero_weights(self):
        assert allocate_proportional(5, [0.0, 0.0]) == [0, 0]

    def test_single_weight_takes_all(self):
        assert allocate_proportional(42, [10.0]) == [42]

    def test_invalid_inputs_raise(self):
        with pytest.raises(ValueError):
            allocate_proportional(-1, [1.0])
        with pytest.raises(ValueError):
            allocate_proportional(5, [1.0, -2.0])


class TestSoftCost:
    def test_exact_targets_only_convexity(self):
        # Отклонений нет → cost = λ * Σ(1 − fill_ratio).
        assert soft_cost([10, 10], [10, 10], [1.0, 0.5], lambda_=1.0) == pytest.approx(0.5)

    def test_l1_plus_convexity(self):
        # |8−10| + |12−10| = 4; (1−0.9)+(1−1.0)=0.1 → 4.1 при λ=1.
        assert soft_cost([8, 12], [10, 10], [0.9, 1.0], lambda_=1.0) == pytest.approx(4.1)

    def test_lambda_scales_convexity(self):
        assert soft_cost([10], [10], [0.5], lambda_=2.0) == pytest.approx(1.0)

    def test_empty_sequences_zero(self):
        assert soft_cost([], [], []) == 0.0

    def test_mismatched_lengths_raise(self):
        with pytest.raises(ValueError):
            soft_cost([1, 2], [1], [1.0, 1.0])


# ---------------------------------------------------------------------------
# all_clusters_touch (docs/04 §9, touchAll)
# ---------------------------------------------------------------------------

class TestAllClustersTouch:
    @staticmethod
    def _inst(cells):
        from space_manager.models import ClusterInstance

        return ClusterInstance(id="x", type_id="T", area_percent=10.0, actual_cells=list(cells))

    def test_empty_list_is_true(self):
        assert all_clusters_touch([]) is True

    def test_single_instance_is_true(self):
        assert all_clusters_touch([self._inst([(0, 0)])]) is True

    def test_connected_blob_is_true(self):
        # Три кластера в едином коме: A—B и B—C соприкасаются.
        a = self._inst([(0, 0), (1, 0)])
        b = self._inst([(2, 0), (3, 0)])
        c = self._inst([(3, 1)])
        assert all_clusters_touch([a, b, c]) is True

    def test_diagonal_contact_counts(self):
        # Диагональ — тоже примыкание (8-окрестность).
        a = self._inst([(0, 0)])
        b = self._inst([(1, 1)])
        assert all_clusters_touch([a, b]) is True

    def test_two_disjoint_pieces_is_false(self):
        a = self._inst([(0, 0), (1, 0)])
        b = self._inst([(5, 5), (6, 5)])
        assert all_clusters_touch([a, b]) is False

    def test_chain_of_three_with_gap_in_middle_is_false(self):
        # A—B соединены, C оторван.
        a = self._inst([(0, 0)])
        b = self._inst([(1, 0)])
        c = self._inst([(9, 9)])
        assert all_clusters_touch([a, b, c]) is False

    def test_instance_without_cells_is_false_when_others_exist(self):
        a = self._inst([(0, 0)])
        empty = self._inst([])
        assert all_clusters_touch([a, empty]) is False
