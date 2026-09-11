"""Чистые валидаторы и оценщики правил размещения (docs/04, docs/05 §2/§4).

Все функции чистые: без side-эффектов, принимают явно переданные данные
(координаты / Ruleset) и ничего не мутируют. Python 3.9 совместимо.

Источники:
- docs/04-rules-and-adjacency.md — правила (связность 8, adjacency default-open
  + blacklist, size, формы free/rectangle/circle, выпуклость fill_ratio, fillAll).
- docs/05-solver-design.md §2 (целевая функция), §4 (валидаторы и оценщики).

Закреплённое решение по `is_circle` (открытое уточнение docs/07 §6 / docs/05 §6):
метрика — **расстояние Чебышёва** (max(|dx|, |dy|), «max-ish расстояние» из
docs/04 §4). Идеальный диск D(c, R) = все клетки с расстоянием ≤ R от
целочисленного центра c. Отклонение `circle_deviation(cells)` — минимальная
по симметрической разности (|S △ D|) величина по всем целочисленным центрам
в bounding-box ± 1 и радиусам между min/max расстояниями до клеток S.
`is_circle(cells, tol=3)` истинно при отклонении ≤ tol, где tol — абсолютное
число «лишних/недостающих» клеток по границе (по умолчанию 3: пиксельный диск
не идеален, docs/04 §4).
"""

from typing import Dict, FrozenSet, Iterable, List, Sequence, Tuple

from .models import Ruleset

CellCoord = Tuple[int, int]


# ---------------------------------------------------------------------------
# Вспомогательные чистые функции
# ---------------------------------------------------------------------------

def _chebyshev(a: CellCoord, b: CellCoord) -> int:
    """Расстояние Чебышёва между клетками (метрика 8-окрестности)."""
    return max(abs(a[0] - b[0]), abs(a[1] - b[1]))


def _as_frozen(cells: Iterable[CellCoord]) -> FrozenSet[CellCoord]:
    return frozenset(cells)


# ---------------------------------------------------------------------------
# Связность (docs/04 §1) — жёсткое условие
# ---------------------------------------------------------------------------

def is_connected(cells: Iterable[CellCoord], connectivity: int = 8) -> bool:
    """Связен ли набор клеток в заданной окрестности.

    `connectivity=8` — ортогональ + диагонали (текущий срез, docs/04 §1);
    `connectivity=4` — только ортогональ (зарезервировано).
    Пустой набор и одиночная клетка считаются связными (vacuous).
    """
    if connectivity not in (4, 8):
        raise ValueError("connectivity должен быть 4 или 8, получено: {}".format(connectivity))
    cell_set = _as_frozen(cells)
    if len(cell_set) <= 1:
        return True
    start = next(iter(cell_set))
    steps = (
        ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1))
        if connectivity == 8 else ((-1, 0), (1, 0), (0, -1), (0, 1))
    )
    seen = {start}
    stack = [start]
    while stack:
        cx, cy = stack.pop()
        for dx, dy in steps:
            nxt = (cx + dx, cy + dy)
            if nxt in cell_set and nxt not in seen:
                seen.add(nxt)
                stack.append(nxt)
    return len(seen) == len(cell_set)


# ---------------------------------------------------------------------------
# Формы (docs/04 §4) — жёсткое условие, если заданы
# ---------------------------------------------------------------------------

def is_rectangle(cells: Iterable[CellCoord]) -> bool:
    """Является ли набор клеток сплошным осевым прямоугольным w × h без выемок.

    Валидация (docs/04 §4): клетки = ровно все клетки своего bounding-box,
    bbox заполнен целиком. Дубликаты координат не допускаются, пустой набор —
    не прямоугольник.
    """
    cell_list = list(cells)
    cell_set = _as_frozen(cell_list)
    if not cell_set or len(cell_list) != len(cell_set):
        return False
    xs = [c[0] for c in cell_set]
    ys = [c[1] for c in cell_set]
    w = max(xs) - min(xs) + 1
    h = max(ys) - min(ys) + 1
    return len(cell_set) == w * h


def circle_deviation(cells: Iterable[CellCoord]) -> int:
    """Минимальное |S △ D(c, R)| по всем целочисленным центрам и радиусам.

    Метрика — расстояние Чебышёва (см. модульный докстринг). 0 означает
    точный пиксельный диск. Центр ищется в bounding-box набора ± 1;
    достаточно, т.к. центр диска, содержащего почти все клетки S, обязан
    находиться рядом с их bbox.
    """
    cell_set = _as_frozen(cells)
    if not cell_set:
        return 0
    xs = [c[0] for c in cell_set]
    ys = [c[1] for c in cell_set]
    best = len(cell_set) + (2 * (max(xs) - min(xs))) ** 2 + 1  # заведомо большое

    def _diff_for(center: CellCoord, radius: int) -> int:
        outside = sum(1 for c in cell_set if _chebyshev(c, center) > radius)
        inside = len(cell_set) - outside
        disk_area = (2 * radius + 1) ** 2
        missing = max(0, disk_area - inside)
        return outside + missing

    for cx in range(min(xs) - 1, max(xs) + 2):
        for cy in range(min(ys) - 1, max(ys) + 2):
            center = (cx, cy)
            dists = {_chebyshev(c, center) for c in cell_set}
            for radius in range(min(dists), max(dists) + 1):
                diff = _diff_for(center, radius)
                if diff < best:
                    best = diff
    return best


def is_circle(cells: Iterable[CellCoord], tol: int = 3) -> bool:
    """Приблизительный пиксельный диск (docs/04 §4).

    Истинно, если существует целочисленный центр и радиус R такие, что
    симметрическая разность набора с идеальным диском ≤ tol. `tol` —
    абсолютный допуск в клетках по границе (по умолчанию 3).
    """
    if tol < 0:
        raise ValueError("tol должен быть >= 0")
    return circle_deviation(cells) <= tol


# ---------------------------------------------------------------------------
# Выпуклость (docs/04 §5) — мягкое предпочтение
# ---------------------------------------------------------------------------

def fill_ratio(cells: Iterable[CellCoord]) -> float:
    """Заполненность bounding-box: area(cluster) / area(bounding_box).

    Метрика выпуклости из docs/04 §5: чем ближе к 1.0, тем «ровнее» форма.
    Пустой набор → 0.0 (вырожденный случай; для него штраф максимален).
    """
    cell_set = _as_frozen(cells)
    if not cell_set:
        return 0.0
    xs = [c[0] for c in cell_set]
    ys = [c[1] for c in cell_set]
    bbox_area = (max(xs) - min(xs) + 1) * (max(ys) - min(ys) + 1)
    return len(cell_set) / bbox_area


def convexity_penalty(cells: Iterable[CellCoord], rules: Ruleset) -> float:
    """Штраф за невыпуклость для целевой функции (docs/05 §2, docs/04 §5).

    `rules.convexity_weight == "soft"` → 1.0 − fill_ratio(cells);
    `"hard"` зарезервирован в текущем срезе (не реализован как запрет) —
    возвращает 0.0.
    """
    if rules.convexity_weight == "soft":
        return 1.0 - fill_ratio(cells)
    return 0.0


# ---------------------------------------------------------------------------
# Соседство (docs/04 §2) — жёсткое условие, default-open + blacklist
# ---------------------------------------------------------------------------

def adjacency_ok(type_a: str, type_b: str, rules: Ruleset) -> bool:
    """Разрешено ли соседство двух типов (docs/04 §2).

    1. A == B → всегда разрешено (однотипные кластеры могут касаться; слияния нет).
    2. Если задан whitelist `allow` → разрешено только если {A, B} ∈ allow;
       пары из `forbidden` всё равно запрещены.
    3. Иначе (default-open) → разрешено, кроме пар из `forbidden`.
    Пары неупорядоченные: {A, B} == {B, A}.
    """
    if type_a == type_b:
        return True
    pair = frozenset((type_a, type_b))
    if rules.adjacency_forbidden and pair in rules.adjacency_forbidden:
        return False
    if rules.adjacency_allow is not None:
        return pair in rules.adjacency_allow
    return True


def clusters_touch(cells_a: Iterable[CellCoord], cells_b: Iterable[CellCoord]) -> bool:
    """Соприкасаются ли два набора клеток по 8-окрестности (docs/04 §1).

    Истинно, если существует пара клеток из разных наборов на расстоянии
    Чебышёва ≤ 1 (ортогонально или диагонально).
    """
    set_a = _as_frozen(cells_a)
    if not set_a:
        return False
    for bx, by in cells_b:
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                if (bx + dx, by + dy) in set_a:
                    return True
    return False


def adjacency_violation(
    cells_a: Iterable[CellCoord], type_a: str,
    cells_b: Iterable[CellCoord], type_b: str,
    rules: Ruleset,
) -> bool:
    """Нарушают ли два экземпляра правило соседства.

    Нарушение = кластеры СОПРИКАСАЮТСЯ (8-окрестность) И пара их типов не
    разрешена (`adjacency_ok` — False). Несоприкасающиеся кластеры не
    нарушают правило независимо от типов.
    """
    if not clusters_touch(cells_a, cells_b):
        return False
    return not adjacency_ok(type_a, type_b, rules)


# ---------------------------------------------------------------------------
# Размер (docs/04 §3) — жёсткое ограничение
# ---------------------------------------------------------------------------

def size_ok(size: int, rules: Ruleset) -> bool:
    """Укладывается ли число клеток в жёсткие `size.min/max` (docs/04 §3).

    Границы включительные; незаданные (None) — без ограничения.
    """
    if size < 0:
        raise ValueError("size должен быть >= 0")
    if rules.size_min is not None and size < rules.size_min:
        return False
    if rules.size_max is not None and size > rules.size_max:
        return False
    return True


# ---------------------------------------------------------------------------
# fillAll и мягкая целевая функция (docs/04 §6, docs/05 §2)
# ---------------------------------------------------------------------------

def allocate_proportional(total: int, weights: Sequence[float]) -> List[int]:
    """Распределение `total` клеток пропорционально долям (fillAll, docs/04 §6).

    Метод наибольших дробных остатков: сумма результата точно равна total,
    ни одна доля не «сваливается» в один кластер. Все weights ≥ 0; при сумме
    весов 0 возвращает нули.
    """
    if total < 0:
        raise ValueError("total должен быть >= 0")
    if any(w < 0 for w in weights):
        raise ValueError("weights должны быть >= 0")
    weight_sum = sum(weights)
    n = len(weights)
    if weight_sum == 0 or total == 0:
        return [0] * n
    exact = [total * w / weight_sum for w in weights]
    floors = [int(e) for e in exact]
    remainder = total - sum(floors)
    # +1 по большим дробным остаткам (стабильно: при равенстве — раньше в списке)
    order = sorted(range(n), key=lambda i: (exact[i] - floors[i], -i), reverse=True)
    for i in order[:remainder]:
        floors[i] += 1
    return floors


def soft_cost(
    actuals: Sequence[int],
    targets: Sequence[int],
    fill_ratios: Sequence[float],
    lambda_: float = 1.0,
) -> float:
    """Мягкая целевая функция (docs/05 §2).

    cost = Σ_i |actual_i − target_i| + λ · Σ_i (1 − fill_ratio_i).
    Длины последовательностей должны совпадать.
    """
    if len(actuals) != len(targets) or len(actuals) != len(fill_ratios):
        raise ValueError("actuals, targets и fill_ratios должны быть одной длины")
    base = sum(abs(a - t) for a, t in zip(actuals, targets))
    convexity = lambda_ * sum(1.0 - fr for fr in fill_ratios)
    return base + convexity
