"""Солвер размещения: backtracking + MRV + forward-checking (docs/05).

Алгоритм (docs/05 §5):
- Упорядочение кластеров (MRV): сначала с заданной формой (rectangle/circle —
  меньше вариантов), затем по убыванию целевой площади, затем по числу
  запрещённых пар в blacklist.
- Генерация кандидатов: связные области нужного размера на свободных клетках
  (`free` минус bad-by-type — клетки, где постановка нарушила бы forbidden/
  allow с уже поставленными кластерами):
  * free — жадный «компактный» рост от seed-клетки (расширение Чебышёвских
    колец от seed: компактные почти-квадратные области) + ограниченный
    перебор (bounded DFS) для малых размеров;
  * rectangle — полный перебор осевых прямоугольников w×h (w·h = размер),
    целиком лежащих в свободных клетках;
  * circle — точные пиксельные диски D(c, R) (расстояние Чебышёва, см. rules),
    целиком лежащие в свободных клетках: отклонение 0 ≤ CIRCLE_TOL, т.е. такие
    кандидаты гарантированно проходят is_circle.
  Кандидаты отсортированы по близости размера к цели и выпуклости (fill_ratio).
- touchAll (docs/04 §9): при включённом флаге каждый следующий кластер обязан
  соприкасаться с уже поставленными (preset учитывается как поставленный
  заранее) — кандидаты, не примыкающие к общему кому, отбрасываются; первый
  кластер без preset'ов ставится свободно. Финальная проверка связности
  графа кластеров (`all_clusters_touch`) страхует случай нескольких
  изолированных preset-групп.
- Постановка + forward-checking: остаток свободной площади ≥ сумме жёстких
  минимумов остальных; крупнейшая связная свободная компонента ≥ максимуму
  этих минимумов; branch-and-bound по частичному soft_cost.
- Бюджет поиска: ограничение по числу узлов и времени; удерживается лучшее
  найденное размещение по soft_cost (docs/05 §2). Один результат — не
  множество вариантов (docs/01 §7).

Закреплённые решения (docs/05 §6, docs/07 §6):
- Preset не уменьшает базу F процентов и участвует в проверках adjacency как
  неподвижный кластер (см. spec_io.area_base).
- fillAll: эффективные цели = allocate_proportional(свободные клетки после
  preset, weights=areaPercent) — «лишнее» распределяется пропорционально
  долям (docs/04 §6); без fillAll цель = target_cells (round(F·%/100)).
- Бюджет по умолчанию: DEFAULT_TIME_BUDGET_SECONDS / DEFAULT_NODE_BUDGET,
  настраивается аргументами solve()/solve_grid() (в CLI вынесется позже).
- Штраф выпуклости λ = DEFAULT_LAMBDA = 1.0; круг — rules.is_circle(tol=3).
- Детерминизм: все порядки перебора отсортированы; `seed` перемешивает
  порядок кандидатов (random.Random(seed)) — одинаковый seed даёт идентичный
  результат (idempotence, docs/07 §4); без seed-зависимых веток результат
  воспроизводим и при seed по умолчанию.

Диагностика невозможности (docs/05 §7): при обрыве веток запоминаются тип и
частота конфликтов; в infeasible_reason выводится наиболее частая причина с
конкретикой (площадь / связный фрагмент / форма / правило соседства).

PlacementResult.warnings содержит предупреждения уровня солвера, не
дублирующие report.area_warnings: незаполненный остаток при fillAll и
обрыв поиска бюджетом. Предупреждения о существенной недостаче долей
автогенерирует report.build_report (docs/06 §5).
"""

import heapq
import math
import random
import time
from typing import Dict, FrozenSet, List, Optional, Set, Tuple

from .models import (
    Cell,
    CellState,
    ClusterInstance,
    Grid,
    PlacementResult,
    PlacementSpec,
    Ruleset,
    Shape,
)
from .rules import (
    allocate_proportional,
    all_clusters_touch,
    fill_ratio,
    is_circle,
    is_connected,
    is_rectangle,
    size_ok,
)
from .spec_io import area_base, prepare_placement

Coord = Tuple[int, int]

__all__ = [
    "solve",
    "solve_grid",
    "DEFAULT_SEED",
    "DEFAULT_TIME_BUDGET_SECONDS",
    "DEFAULT_NODE_BUDGET",
    "DEFAULT_LAMBDA",
    "CIRCLE_TOL",
]

_NEIGHBOURS8: Tuple[Coord, ...] = (
    (-1, -1), (0, -1), (1, -1), (-1, 0), (1, 0), (-1, 1), (0, 1), (1, 1)
)

# --- дефолты бюджета и параметров поиска (docs/05 §6) -----------------------
DEFAULT_SEED = 0                  # детерминированный поиск по умолчанию
DEFAULT_TIME_BUDGET_SECONDS = 2.0 # ограничение времени на полный поиск
DEFAULT_NODE_BUDGET = 8000        # ограничение числа узлов DFS
DEFAULT_LAMBDA = 1.0              # вес штрафа выпуклости в soft_cost (docs/05 §2)
CIRCLE_TOL = 3                    # допуск is_circle (клетки по границе)

# --- внутренние константы генерации/поиска ----------------------------------
SEEDS_CAP = 12          # seed-клеток для компактного роста (free-формы)
DISK_CENTERS_CAP = 40   # центров для перебора дисков (circle-формы)
ENUM_SEEDS_CAP = 4      # seed для bounded-перебора
ENUM_MAX_SIZE = 8       # bounded-перебор только для маленьких размеров
ENUM_RESULT_CAP = 8     # кандидатов на seed из перебора
ENUM_NODE_CAP = 1200    # узлов перебора на seed
SIZE_TRIAL_CAP = 8      # сколько разных размеров пробовать (окно вокруг цели)
DISK_TARGET_RANGE = 30  # диски включаем, если |площадь диска − цель| ≤ этому
BRANCH_CAP = 60         # максимум кандидатов одного кластера в одном узле DFS
_EPS = 1e-9


# ---------------------------------------------------------------------------
# Вспомогательные функции
# ---------------------------------------------------------------------------

def _clone_grid(grid: Grid) -> Grid:
    """Глубокая копия сетки (новые Cell'ы)."""
    return Grid(
        width=grid.width,
        height=grid.height,
        cells=[[Cell(c.state, c.instance_id) for c in row] for row in grid.cells],
    )


def _neighbours8(cell: Coord, inside: Optional[Set[Coord]] = None) -> List[Coord]:
    x, y = cell
    out = []
    for dx, dy in _NEIGHBOURS8:
        n = (x + dx, y + dy)
        if inside is None or n in inside:
            out.append(n)
    return out


def _largest_component_size(cells: Set[Coord]) -> int:
    """Максимальный размер связной компоненты (8-окрестность) в наборе клеток."""
    remaining = set(cells)
    best = 0
    while remaining:
        start = min(remaining)
        seen = {start}
        stack = [start]
        while stack:
            cx, cy = stack.pop()
            for dx, dy in _NEIGHBOURS8:
                n = (cx + dx, cy + dy)
                if n in remaining and n not in seen:
                    seen.add(n)
                    stack.append(n)
        best = max(best, len(seen))
        remaining -= seen
    return best


def _grow_compact(free_avail: Set[Coord], seed: Coord, size: int) -> Optional[FrozenSet[Coord]]:
    """Жадный компактный рост связной области размера `size` от `seed`.

    На каждом шаге выбирается frontier-клетка с минимальным (расстояние
    Чебышёва до seed, координаты) — область растёт «кольцами», получая на
    открытой сетке компактные почти-квадратные формы. Открытая 8-компонента
    размера ≥ size гарантирует завершение: пустой frontier означает, что
    область уже вся компонента, что противоречит |компоненте| ≥ size > |регион|.

    Реализация: расстояние каждой клетки вычисляется один раз при добавлении
    в frontier и хранится в куче (heap) по ключу (dist, координаты) — выбор
    min-клетки за O(log n), а не перебор всего frontier на каждом шаге
    (O(frontier) × O(size) на большом росте). Результат побитово идентичен
    перебору: та же пара (минимальное расстояние, минимальные координаты).
    """
    if size < 1 or seed not in free_avail:
        return None
    return _grow_snapshots(free_avail, seed, [size]).get(size)


def _grow_snapshots(
    free_avail: Set[Coord],
    seed: Coord,
    sizes: List[int],
) -> Dict[int, FrozenSet[Coord]]:
    """Один жадный рост от `seed` с фиксацией срезов при каждом нужном размере.

    Жадное правило выбора следующей клетки не зависит от целевого размера, так
    что область размера s — точный префикс области большего размера s'. Поэтому
    вместо роста «с нуля» для каждого размера (O(размеров × клеток)) делается
    ОДИН рост до максимального размера, а при достижении каждого запрошенного
    размера снимается снапшот. Результат идентичен набору отдельных вызовов
    _grow_compact: {s: _grow_compact(free_avail, seed, s)} для достигнутых s.
    """
    targets = sorted({s for s in sizes if s >= 1})
    if not targets or seed not in free_avail:
        return {}
    sx, sy = seed
    region = {seed}
    frontier = set()
    heap: List[Tuple[int, Coord]] = []
    for n in _neighbours8(seed, free_avail):
        if n != seed:
            frontier.add(n)
            heapq.heappush(heap, (max(abs(n[0] - sx), abs(n[1] - sy)), n))
    out: Dict[int, FrozenSet[Coord]] = {}
    for need in targets:
        while len(region) < need:
            # Убираем устаревшие записи кучи (клетка уже в region / вне frontier).
            while heap:
                _d, c = heap[0]
                if c in frontier and c not in region:
                    break
                heapq.heappop(heap)
            if not heap:
                return out  # область упёрлась в компоненту — большие s недостижимы
            _d, best = heapq.heappop(heap)
            if best not in frontier or best in region:
                continue
            region.add(best)
            frontier.discard(best)
            for m in _neighbours8(best, free_avail):
                if m not in region and m not in frontier:
                    frontier.add(m)
                    heapq.heappush(heap, (max(abs(m[0] - sx), abs(m[1] - sy)), m))
        out[need] = frozenset(region)
    return out


def _enum_bounded(
    free_avail: Set[Coord],
    seed: Coord,
    size: int,
    result_cap: int = ENUM_RESULT_CAP,
    node_cap: int = ENUM_NODE_CAP,
) -> List[FrozenSet[Coord]]:
    """Ограниченный перебор связных наборов размера `size`, содержащих `seed`.

    Классический рост через frontier с дедупликацией по frozenset и лимитами
    на число результатов и узлов — только для разнообразия кандидатов.
    """
    out: List[FrozenSet[Coord]] = []
    seen: Set[FrozenSet[Coord]] = set()
    nodes = [0]

    def rec(region: FrozenSet[Coord], frontier: Tuple[Coord, ...]) -> None:
        if len(out) >= result_cap or nodes[0] >= node_cap:
            return
        nodes[0] += 1
        if len(region) == size:
            f = frozenset(region)
            if f not in seen:
                seen.add(f)
                out.append(f)
            return
        for c in frontier:  # уже отсортировано (детерминизм)
            new_region = region | {c}
            new_frontier = set(frontier)
            new_frontier.discard(c)
            for m in _neighbours8(c, free_avail):
                if m not in new_region:
                    new_frontier.add(m)
            rec(new_region, tuple(sorted(new_frontier)))
            if len(out) >= result_cap or nodes[0] >= node_cap:
                return

    if seed in free_avail and size >= 1:
        rec(frozenset({seed}), tuple(sorted(_neighbours8(seed, free_avail))))
    return out


def _sample_seeds(cells: Set[Coord], cap: int) -> List[Coord]:
    """Равномерная (детерминированная) выборка из отсортированных клеток."""
    ordered = sorted(cells)
    if len(ordered) <= cap:
        return ordered
    step = len(ordered) / cap
    return [ordered[int(i * step)] for i in range(cap)]


def _factor_pairs(size: int) -> List[Tuple[int, int]]:
    """Все (w, h), w·h = size, w ≤ h — детерминированно."""
    out = []
    for w in range(1, int(math.isqrt(size)) + 1):
        if size % w == 0:
            h = size // w
            out.append((w, h) if w <= h else (h, w))
    return out


def _rectangles_of(free_avail: Set[Coord], size: int) -> List[FrozenSet[Coord]]:
    """Все осевые прямоугольники размера `size`, целиком в `free_avail`."""
    out = []
    seen = set()
    for w, h in _factor_pairs(size):
        for (x0, y0) in sorted(free_avail):
            cells = frozenset((x0 + dx, y0 + dy) for dx in range(w) for dy in range(h))
            if cells in seen:
                continue
            seen.add(cells)
            if cells <= free_avail:
                out.append(cells)
    return out


def _disks_of(free_avail: Set[Coord], lo: int, hi: int, target: int) -> List[FrozenSet[Coord]]:
    """Все точные пиксельные диски D(c, R), целиком в `free_avail`.

    Радиусы ограничены [lo, hi] по площади и близостью к цели (DISK_TARGET_RANGE):
    если диск близко к цели не найден — оставшиеся радиусы всё равно дают
    варианты меньшей площади (мягкая цель + предупреждение).
    """
    out = []
    seen = set()
    max_r = int(math.isqrt(hi)) + 1
    centers = _sample_seeds(free_avail, DISK_CENTERS_CAP)
    for r in range(0, max_r + 1):
        area = (2 * r + 1) ** 2
        if area < lo or area > hi:
            continue
        if abs(area - target) > DISK_TARGET_RANGE:
            continue
        for c in centers:
            cx, cy = c
            disk = frozenset(
                (cx + dx, cy + dy)
                for dx in range(-r, r + 1)
                for dy in range(-r, r + 1)
            )
            if disk in seen or not (disk <= free_avail):
                continue
            seen.add(disk)
            out.append(disk)
    return out


def _sizes_to_try(target: int, lo: int, hi: int, rules: Ruleset) -> List[int]:
    """Размеры для free/rectangle-форм: окно вокруг цели, по близости к ней."""
    window_lo = max(lo, target - SIZE_TRIAL_CAP)
    window_hi = min(hi, target + SIZE_TRIAL_CAP)
    sizes = list(range(window_lo, window_hi + 1))
    if not sizes:
        sizes = [min(hi, max(lo, target))]
    sizes = [s for s in sizes if size_ok(s, rules)]
    return sorted(sizes, key=lambda s: (abs(s - target), s))


def _pair_ok(type_a: str, type_b: str, rules: Ruleset) -> bool:
    """Пара типов разрешена? (docs/04 §2: A==B — всегда; forbidden; whitelist)."""
    if type_a == type_b:
        return True
    pair = frozenset((type_a, type_b))
    if rules.adjacency_forbidden and pair in rules.adjacency_forbidden:
        return False
    if rules.adjacency_allow is not None:
        return pair in rules.adjacency_allow
    return True


# ---------------------------------------------------------------------------
# Основной класс поиска
# ---------------------------------------------------------------------------

class _BacktrackingSolver:
    """Один прогон backtracking-поиска с бюджетом и branch-and-bound."""

    def __init__(
        self,
        grid: Grid,
        instances: List[ClusterInstance],
        rules: Ruleset,
        seed: int,
        time_budget_seconds: float,
        node_budget: int,
    ) -> None:
        self.grid = _clone_grid(grid)
        self.rules = rules
        self.rng = random.Random(seed)
        self.time_budget = time_budget_seconds
        self.node_budget = node_budget

        # Разделяем неподвижные preset'ы и размещаемые кластеры.
        self.presets = [i for i in instances if i.is_preset]
        self.to_place = [i for i in instances if not i.is_preset]

        self.free: Set[Coord] = {
            (x, y) for y in range(grid.height) for x in range(grid.width)
            if grid.cell(x, y).state is CellState.FREE
        }
        self.free_initial = len(self.free)
        type_ids = {i.type_id for i in instances}
        self.bad_by_type: Dict[str, Set[Coord]] = {t: set() for t in type_ids}

        # Упорядочение MRV (docs/05 §5.1): форма → цель ↓ → ограниченность ↓.
        def mrv_key(inst: ClusterInstance) -> Tuple[int, int, int, str]:
            shape_rank = 0 if inst.shape is not Shape.FREE else 1
            constrained = len(
                {p for p in self.rules.adjacency_forbidden if inst.type_id in p}
            )
            return (shape_rank, -inst.target_cells, -constrained, inst.id)

        self.order: List[ClusterInstance] = sorted(self.to_place, key=mrv_key)

        # Эффективные цели (fillAll → пропорциональное распределение всего).
        if rules.fill_all and self.to_place:
            alloc = allocate_proportional(
                len(self.free), [c.area_percent for c in self.to_place]
            )
            self.targets = {c.id: max(alloc[k], 1) for k, c in enumerate(self.to_place)}
        else:
            base = area_base(grid)
            self.targets = {}
            for c in self.to_place:
                t = c.target_cells if c.target_cells > 0 else int(round(base * c.area_percent / 100.0))
                self.targets[c.id] = max(t, 1)

        # Жёсткие минимумы (для forward-checking): size_min или 1 клетка.
        self.lb: Dict[str, int] = {
            c.id: max(self.rules.size_min or 0, 1) for c in self.to_place
        }
        self.lb_suffix: List[int] = [0] * (len(self.order) + 1)
        for i in range(len(self.order) - 1, -1, -1):
            self.lb_suffix[i] = self.lb_suffix[i + 1] + self.lb[self.order[i].id]

        # Состояние поиска.
        self.placed_cells: List[Optional[FrozenSet[Coord]]] = [None] * len(self.order)
        self.cost_acc = 0.0
        self.best_cost: Optional[float] = None
        # Клетки лучшего размещения, выровнено по self.order (id — из order).
        self.best_placement: Optional[List[FrozenSet[Coord]]] = None
        self.nodes = 0
        self.start_time = time.monotonic()
        self.budget_exhausted = False
        self._bad_deltas: List[List[Tuple[str, Coord]]] = []
        # Диагностика (docs/05 §7): key -> [count, message, last_seq]
        self._reasons: Dict[str, List] = {}
        self._reason_seq = 0

        # Начальная bad-обстановка от preset'ов.
        for p in self.presets:
            cells = frozenset(p.actual_cells)
            for t2 in type_ids:
                if t2 != p.type_id and not _pair_ok(p.type_id, t2, rules):
                    for c in cells:
                        for n in _neighbours8(c, self.free):
                            self.bad_by_type[t2].add(n)

        # touchAll (docs/04 §9): объединение клеток всех уже поставленных
        # экземпляров — preset'ы считаются поставленными заранее.
        self.touch_all = bool(rules.touch_all)
        self.placed_union: Set[Coord] = set()
        for p in self.presets:
            self.placed_union.update(p.actual_cells)

    # -- служебное -----------------------------------------------------------

    def _budget_ok(self) -> bool:
        if self.nodes >= self.node_budget:
            return False
        if (self.nodes & 511) == 0 and time.monotonic() - self.start_time > self.time_budget:
            return False
        return True

    def _record_reason(self, key: str, message: str) -> None:
        entry = self._reasons.get(key)
        if entry is None:
            self._reasons[key] = [1, message, self._reason_seq]
        else:
            entry[0] += 1
            entry[1] = message
            entry[2] = self._reason_seq
        self._reason_seq += 1

    def _best_reason(self) -> str:
        if not self._reasons:
            return "исчерпан бюджет поиска без нахождения валидного размещения"
        key = max(self._reasons.items(), key=lambda kv: (kv[1][0], kv[1][2]))[0]
        return self._reasons[key][1]

    # -- применение / откат ---------------------------------------------------

    def _apply(self, idx: int, inst: ClusterInstance, cells: FrozenSet[Coord]) -> None:
        for x, y in cells:
            self.grid.cell(x, y).state = CellState.PLACED
            self.grid.cell(x, y).instance_id = inst.id
            self.free.discard((x, y))
        self.placed_cells[idx] = cells
        # Запрещаем клетки у границы для типов, несовместимых с этим кластером.
        delta: List[Tuple[str, Coord]] = []
        for t2 in sorted(self.bad_by_type):
            if t2 == inst.type_id or _pair_ok(inst.type_id, t2, self.rules):
                continue
            for c in cells:
                for n in _neighbours8(c, self.free):
                    if n not in self.bad_by_type[t2]:
                        delta.append((t2, n))
        for t2, n in delta:
            self.bad_by_type[t2].add(n)
        self.placed_union.update(cells)
        self._bad_deltas.append(delta)

    def _unapply(self, idx: int, inst: ClusterInstance) -> None:
        cells = self.placed_cells[idx]
        assert cells is not None
        for x, y in cells:
            c = self.grid.cell(x, y)
            c.state = CellState.FREE
            c.instance_id = None
            self.free.add((x, y))
        self.placed_cells[idx] = None
        delta = self._bad_deltas.pop()
        for t2, n in delta:
            if n in self.free:  # клетка всё ещё свободна — снимаем запрет
                self.bad_by_type[t2].discard(n)
        self.placed_union.difference_update(cells)

    # -- генерация кандидатов --------------------------------------------------

    def _candidates(
        self,
        free_avail: Set[Coord],
        inst: ClusterInstance,
        lo: int,
        hi: int,
    ) -> List[Tuple[FrozenSet[Coord], float]]:
        """Кандидаты для кластера: (клетки, fill_ratio).

        Сортировка: близость размера к цели, затем выпуклость (fill_ratio),
        затем координаты. Порядок перемешивается rng (детерминизм по seed).
        """
        t = self.targets[inst.id]
        found: Dict[FrozenSet[Coord], float] = {}

        def add(cells: FrozenSet[Coord]) -> None:
            # fill_ratio — только для новых регионов (setdefault с ленивым ключом)
            if cells not in found:
                found[cells] = fill_ratio(cells)

        if inst.shape is Shape.CIRCLE:
            for cells in _disks_of(free_avail, lo, hi, t):
                add(cells)
        else:
            # Seed-выборки и список размеров не зависят от шага — один раз на вызов.
            seeds = _sample_seeds(free_avail, SEEDS_CAP)
            enum_seeds = _sample_seeds(free_avail, ENUM_SEEDS_CAP)
            sizes_list = _sizes_to_try(t, lo, hi, self.rules)
            if inst.shape is Shape.FREE:
                # free-форма: рост на каждый размер — префикс одного роста до
                # максимального размера (см. _grow_snapshots). Снапшоты считаются
                # один раз на seed; в `found` регионы добавляются в исходном
                # порядке (размер → seed), как при поштучных вызовах.
                snapshots = [
                    _grow_snapshots(free_avail, seed, sizes_list) for seed in seeds
                ]
            else:
                snapshots = None
            for s in sizes_list:
                if inst.shape is Shape.RECTANGLE:
                    for cells in _rectangles_of(free_avail, s):
                        add(cells)
                else:
                    for snaps in snapshots:
                        region = snaps.get(s)
                        if region is not None:
                            add(region)
                    if s <= ENUM_MAX_SIZE:
                        for seed in enum_seeds:
                            for region in _enum_bounded(free_avail, seed, s):
                                add(region)

        # Жёсткий фильтр связности (актуален при connectivity=4).
        ok: List[Tuple[FrozenSet[Coord], float]] = [
            (cells, fr)
            for cells, fr in found.items()
            if self.rules.connectivity == 8 or is_connected(cells, self.rules.connectivity)
        ]
        ok.sort(key=lambda cf: (abs(len(cf[0]) - t), -cf[1], min(cf[0])))
        self.rng.shuffle(ok)
        return ok[:BRANCH_CAP]

    def _touches_placed(self, cells: FrozenSet[Coord]) -> bool:
        """Примыкает ли кандидат к общему кому уже поставленных (touchAll)."""
        return any(_neighbours8(c, self.placed_union) for c in cells)

    def _candidate_reason(self, idx: int, inst: ClusterInstance, free_avail: Set[Coord]) -> None:
        """Причина отсутствия кандидатов (docs/05 §7)."""
        t = self.targets[inst.id]
        if len(self.free) < t:
            self._record_reason(
                "area",
                "не хватает свободной площади под сумму целей кластеров: "
                "кластеру '{}' нужно ~{} клеток, а свободно только {}".format(inst.id, t, len(self.free)),
            )
        elif len(free_avail) < t:
            self._record_reason(
                "adjacency",
                "правило соседства (forbidden/allow) делает размещение невозможным для "
                "кластера '{}' (тип {}): все подходящие по площади клетки запрещены к "
                "касанию уже поставленными кластерами".format(inst.id, inst.type_id),
            )
        elif inst.shape is Shape.CIRCLE:
            self._record_reason(
                "shape",
                "заданная форма 'circle' не вписывается для кластера '{}' (тип {}): "
                "свободная область не содержит пиксельного диска нужного размера".format(inst.id, inst.type_id),
            )
        elif inst.shape is Shape.RECTANGLE:
            self._record_reason(
                "shape",
                "заданная форма 'rectangle' не вписывается для кластера '{}' (тип {}): "
                "свободная область не содержит сплошного прямоугольника нужного размера".format(inst.id, inst.type_id),
            )
        else:
            self._record_reason(
                "fragment",
                "нет связного фрагмента нужного размера для кластера '{}' (тип {}): "
                "свободные клетки разорваны блокировками или уже поставленными кластерами".format(inst.id, inst.type_id),
            )

    # -- DFS -------------------------------------------------------------------

    def _dfs(self, idx: int) -> bool:
        if not self._budget_ok():
            self.budget_exhausted = True
            return False
        # Дешёвая обрезка до генерации кандидатов: частичный cost уже не лучше.
        if self.best_cost is not None and self.cost_acc >= self.best_cost - _EPS:
            return False
        self.nodes += 1

        if idx == len(self.order):
            # Полное размещение — фиксируем лучшее по cost.
            total = self.cost_acc
            if self.best_cost is None or total < self.best_cost - _EPS:
                self.best_cost = total
                self.best_placement = [cells if cells else frozenset() for cells in self.placed_cells]
            return True

        inst = self.order[idx]
        t = self.targets[inst.id]
        lo = max(1, self.rules.size_min or 0)
        hi = len(self.free) - self.lb_suffix[idx + 1]
        if self.rules.size_max is not None:
            hi = min(hi, self.rules.size_max)
        if lo > hi:
            self._record_reason(
                "area",
                "не хватает свободной площади под сумму целей кластеров: всем "
                "оставшимся нужно не менее {} клеток, а свободно только {}".format(self.lb_suffix[0], len(self.free)),
            )
            return False

        free_avail = self.free - self.bad_by_type[inst.type_id]
        cands = self._candidates(free_avail, inst, lo, hi)
        if not cands:
            self._candidate_reason(idx, inst, free_avail)
            return False
        # touchAll (docs/04 §9): жёсткое требование примыкания к уже поставленным.
        if self.touch_all and self.placed_union:
            touched = [cf for cf in cands if self._touches_placed(cf[0])]
            if not touched:
                # Кандидаты были, но ни один не примыкает к общему кому.
                self._record_reason(
                    "touch",
                    "режим touchAll: кластер '{}' (тип {}) не может примыкать к уже "
                    "поставленным кластерам — свободные клетки рядом с общим комом "
                    "отсутствуют или запрещены правилом соседства".format(inst.id, inst.type_id),
                )
                return False
            cands = touched

        for cells, fr in cands:
            term = abs(len(cells) - t) + DEFAULT_LAMBDA * (1.0 - fr)
            # Branch-and-bound: частичный cost уже не лучше лучшего.
            if self.best_cost is not None and self.cost_acc + term >= self.best_cost - _EPS:
                continue
            self._apply(idx, inst, cells)
            self.cost_acc += term
            ok = True
            # Forward-checking (docs/05 §5.3).
            if len(self.free) < self.lb_suffix[idx + 1]:
                self._record_reason(
                    "area",
                    "не хватает свободной площади под сумму целей кластеров: после "
                    "постановки '{}' осталось {} клеток, остальным нужно не менее {}".format(inst.id, len(self.free), self.lb_suffix[idx + 1]),
                )
                ok = False
            else:
                max_comp = _largest_component_size(self.free)
                need_max = max((self.lb[o.id] for o in self.order[idx + 1:]), default=0)
                if max_comp < need_max:
                    tight = next(
                        (o.id for o in self.order[idx + 1:] if self.lb[o.id] == need_max), "?"
                    )
                    self._record_reason(
                        "fragment",
                        "нет связного фрагмента нужного размера для кластера '{}': "
                        "крупнейшая свободная область — {} клеток, нужно не менее {}".format(tight, max_comp, need_max),
                    )
                    ok = False
            if ok:
                self._dfs(idx + 1)
            self.cost_acc -= term
            self._unapply(idx, inst)
            if not self._budget_ok():
                self.budget_exhausted = True
                return False
        return True

    # -- сборка результата ------------------------------------------------------

    def run(self) -> PlacementResult:
        if self.to_place:
            self._dfs(0)

        instances_out: Dict[str, ClusterInstance] = {}
        for p in self.presets:
            p.actual_cells = sorted(p.actual_cells)
            instances_out[p.id] = p

        warnings: List[str] = []
        if self.to_place and self.best_placement is not None:
            # После поиска все откаты вернули сетку в исходное состояние —
            # настраиваем лучшее размещение заново (только для вывода).
            placed_total = 0
            for inst, cells in zip(self.order, self.best_placement):
                inst.actual_cells = sorted(list(cells))
                for x, y in cells:
                    c = self.grid.cell(x, y)
                    c.state = CellState.PLACED
                    c.instance_id = inst.id
                placed_total += len(cells)
                instances_out[inst.id] = inst
            leftover = self.free_initial - placed_total
            if self.rules.fill_all and leftover > 0:
                warnings.append(
                    "fillAll: осталось {} незаполненных клеток из {}".format(leftover, self.free_initial)
                )
            if self.rules.touch_all and not all_clusters_touch(instances_out.values()):
                # Поиск требует примыкания каждого нового кластера к предыдущим,
                # но несколько изолированных preset-групп могли остаться вне кома.
                feasible = False
                reason: Optional[str] = (
                    "режим touchAll: не все кластеры образуют единый примыкающий ком — "
                    "часть неподвижных preset-кластеров недостижима для остальных"
                )
            else:
                feasible = True
                reason = None
        elif self.to_place:
            for inst in self.order:
                inst.actual_cells = []
                instances_out[inst.id] = inst
            feasible = False
            reason = self._best_reason()
        else:
            # Кластеров к размещению нет — тривиально выполнимо.
            feasible = True
            reason = None

        if self.budget_exhausted and self.best_placement is not None:
            warnings.append(
                "поиск остановлен бюджетом (узлы/время); приведено лучшее найденное размещение"
            )

        return PlacementResult(
            feasible=feasible,
            grid=self.grid,
            instances=instances_out,
            warnings=warnings,
            infeasible_reason=reason,
        )


# ---------------------------------------------------------------------------
# Публичный API
# ---------------------------------------------------------------------------

def solve_grid(
    grid: Grid,
    instances: List[ClusterInstance],
    rules: Ruleset,
    seed: int = DEFAULT_SEED,
    time_budget_seconds: float = DEFAULT_TIME_BUDGET_SECONDS,
    node_budget: int = DEFAULT_NODE_BUDGET,
) -> PlacementResult:
    """Размещает `instances` (preset + запрошенные) на готовой `Grid`.

    Preset-экземпляры (is_preset=True с заполненными actual_cells) неподвижны и
    учитываются в проверках adjacency. Возвращает PlacementResult; входные
    объекты не мутируются (Grid копируется). Реестр типов выводится из самого
    списка экземпляров.
    """
    solver = _BacktrackingSolver(
        grid, instances, rules, seed, time_budget_seconds, node_budget
    )
    return solver.run()


def solve(
    spec: PlacementSpec,
    seed: int = DEFAULT_SEED,
    time_budget_seconds: float = DEFAULT_TIME_BUDGET_SECONDS,
    node_budget: int = DEFAULT_NODE_BUDGET,
) -> PlacementResult:
    """Точка входа: PlacementSpec → PlacementResult (docs/05 §1).

    Материализует сетку через spec_io.prepare_placement (blocked → BLOCKED,
    preset → неподвижные PLACED, цели = round(F·%/100)) и запускает поиск.
    Возвращает ОДНО размещение — лучшее по soft_cost в пределах бюджета
    (docs/01 §7). Одинаковый `seed` даёт идентичный результат (docs/07 §4).
    """
    grid, instances = prepare_placement(spec)
    return solve_grid(
        grid, instances, spec.rules, seed=seed,
        time_budget_seconds=time_budget_seconds, node_budget=node_budget,
    )
