"""Послефактум-валидация result-маски по спеке (docs-llm/04).

Подкоманда ``space_manager validate``: проверка готового text-отчёта
(секция «== КАРТА ==») относительно YAML-спеки **без** повторного запуска
солвера и **без** ассайнмента клеток кластерам (в маске он не
восстанавливается, docs-llm/04 §6 — задокументированное ограничение v1:
проверяются агрегаты по типам).

Проверяемые правила (docs-llm/04 §5, исчерпывающий список, порядок вывода):
1. V-GRID      — размер карты == grid W×H спеки;
2. V-SYMBOL    — все символы ∈ {*, .} ∪ символов spec.types;
3. V-BLOCKED / V-PRESET — блокировки и пресеты не перекроены;
4. V-ADJACENCY — запрещённые пары типов (``rules.adjacency.forbidden``,
                 или пара вне whitelist ``allow``) не касаются по границам
                 связных областей (окрестность из ``rules.connectivity``, 8);
5. V-RECTANGLE — тип с ровно ОДНИМ кластером ``shape=rectangle``: область
                 типа = полный осевой прямоугольник;
6. V-AREA      — площадь типа на маске vs сумма целей кластеров типа
                 (``target = round(F · areaPercent / 100)``, та же формула,
                 что в отчёте, docs/06 §4); допуск по умолчанию
                 ``report.WARNING_THRESHOLD_PERCENT`` (10 %).

Переиспользуется существующий код без дублирования логики:
``spec_io.load_spec/read_blocked_file/read_preset_file``,
``rules.adjacency_ok/clusters_touch/is_rectangle``,
``report.WARNING_THRESHOLD_PERCENT``. F считается как в солвере
(``spec_io.area_base``): свободные клетки **без блокировок**; preset НЕ
уменьшает F (docs/03 §3, docs/05 §6).

Python 3.9: только typing.Optional/List/Dict/Tuple/Set/FrozenSet, без match
и `X | Y` в аннотациях.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Set, Tuple

from .models import PlacementSpec, Shape
from .report import WARNING_THRESHOLD_PERCENT
from .rules import adjacency_ok, clusters_touch, is_rectangle
from .spec_io import read_blocked_file, read_preset_file

# docs-llm/04 §2 — выходной код «найдены нарушения» (свободен у place: 0/1/2).
EXIT_VALIDATION_FAILED = 3

# Заголовок секции карты в отчёте (docs/06 §3; рендерит report.render_grid).
MAP_SECTION_HEADER = "== КАРТА =="

# Ограничение длины перечисления клеток-нарушителей в одном сообщении
# (защита от «повреждённого» отчёта из всех '?').
_MAX_CELLS_PER_MESSAGE = 20

_NEIGHBOURS_4 = ((-1, 0), (1, 0), (0, -1), (0, 1))
_NEIGHBOURS_8 = (
    (-1, -1), (0, -1), (1, -1),
    (-1, 0), (1, 0),
    (-1, 1), (0, 1), (1, 1),
)


class ResultParseError(ValueError):
    """Result-файл не удалось разобрать: нет секции «== КАРТА ==» (docs-llm/04 §2)."""


@dataclass(frozen=True)
class Violation:
    """Одно нарушение правила.

    :param code: код правила, напр. ``"V-ADJACENCY"``;
    :param message: человекочитаемая детализация (docs-llm/04 §5.7).
    """

    code: str
    message: str

    def line(self) -> str:
        """Строка вывода: ``НАРУШЕНИЕ <код>: <детали>`` (docs-llm/04 §5.7)."""
        return "НАРУШЕНИЕ {}: {}".format(self.code, self.message)


# ---------------------------------------------------------------------------
# Парсер секции «== КАРТА ==» result-файла (контракт docs/06 §3)
# ---------------------------------------------------------------------------

def parse_result_map(text: str) -> List[List[str]]:
    """Извлекает ASCII-карту из текста отчёта.

    Ищет строку ``== КАРТА ==``, пропускает пустой отступ после заголовка и
    читает следующие непустые строки до первой пустой строки или следующего
    заголовка секции (``== ... ==``) — ровно тот формат, который пишет
    :func:`space_manager.report.build_report` (секции склеены через "\n\n";
    карта = H строк по W символов, без завершающих пробелов).

    :param text: полный текст result-файла.
    :raises ResultParseError: секция «== КАРТА ==» не найдена.
    """
    lines = text.splitlines()
    header_idx: Optional[int] = None
    for i, line in enumerate(lines):
        if line.strip() == MAP_SECTION_HEADER:
            header_idx = i
            break
    if header_idx is None:
        raise ResultParseError("в result-файле не найдена секция «== КАРТА ==»")

    rows: List[List[str]] = []
    started = False
    for line in lines[header_idx + 1:]:
        if not line.strip():
            if started:
                break  # пустая строка внутри/после карты — конец секции
            continue  # пропуск заголовочного отступа «== КАРТА ==\n\n<карта>»
        if line.startswith("=="):
            break  # следующая секция отчёта
        started = True
        rows.append(list(line))
    return rows


# ---------------------------------------------------------------------------
# Вспомогательные чистые функции
# ---------------------------------------------------------------------------

def _blocked_cells(spec: PlacementSpec) -> Set[Tuple[int, int]]:
    """Клетки ``*`` из blocked.txt спеки (пустое множество, если файла нет)."""
    if not spec.blocked_file:
        return set()
    width, height = spec.grid_dims
    return read_blocked_file(spec.blocked_file, width, height)


def _preset_cells(spec: PlacementSpec) -> List[Tuple[str, Tuple[int, int]]]:
    """Пары (type_id, (x, y)) по всем клеткам preset.txt.

    Читается тем же ``spec_io.read_preset_file``, что и в солвере; размерность
    файла уже проверена при ``load_spec``.
    """
    if not spec.preset_file:
        return []
    width, height = spec.grid_dims
    types_by_symbol = {t.symbol: t.type_id for t in spec.types.values()}
    out: List[Tuple[str, Tuple[int, int]]] = []
    for type_id, cells in read_preset_file(spec.preset_file, width, height, types_by_symbol):
        out.extend((type_id, cell) for cell in cells)
    return out


def _cells_by_type(mask_rows: List[List[str]],
                   types_by_symbol: Dict[str, str]) -> Dict[str, List[Tuple[int, int]]]:
    """Клетки каждого типа на маске (символ → type_id)."""
    result: Dict[str, List[Tuple[int, int]]] = {}
    for y, row in enumerate(mask_rows):
        for x, ch in enumerate(row):
            type_id = types_by_symbol.get(ch)
            if type_id is not None:
                result.setdefault(type_id, []).append((x, y))
    return result


def _components(cells: List[Tuple[int, int]], connectivity: int = 8) -> List[List[Tuple[int, int]]]:
    """Связные компоненты набора клеток в заданной окрестности (docs/04 §1).

    Детерминированный порядок: старты — по возрастанию координат.
    """
    cell_set = set(cells)
    steps = _NEIGHBOURS_8 if connectivity == 8 else _NEIGHBOURS_4
    seen: Set[Tuple[int, int]] = set()
    out: List[List[Tuple[int, int]]] = []
    for start in sorted(cell_set):
        if start in seen:
            continue
        stack = [start]
        seen.add(start)
        comp: List[Tuple[int, int]] = []
        while stack:
            x, y = stack.pop()
            comp.append((x, y))
            for dx, dy in steps:
                nxt = (x + dx, y + dy)
                if nxt in cell_set and nxt not in seen:
                    seen.add(nxt)
                    stack.append(nxt)
        out.append(comp)
    return out


def _touch_cell(cells_a: List[Tuple[int, int]], cells_b: Set[Tuple[int, int]]) -> Optional[Tuple[int, int]]:
    """Первая (по сортировке) клетка A с клеткой B в 8-окрестности; None — не касаются."""
    for x, y in sorted(cells_a):
        for dx, dy in _NEIGHBOURS_8:
            if (x + dx, y + dy) in cells_b:
                return (x, y)
    return None


def _format_percent(value: float) -> str:
    """10.0 → '10', 12.5 → '12.5' (стиль report._format_percent)."""
    if value == int(value):
        return str(int(value))
    return "{0:g}".format(value)


# ---------------------------------------------------------------------------
# Правила (docs-llm/04 §5) — чистые функции, порядок вывода = порядок правил
# ---------------------------------------------------------------------------

def _check_grid(spec: PlacementSpec, mask_rows: List[List[str]]) -> List[Violation]:
    """Правило 1. V-GRID: ровно H строк, в каждой ровно W символов."""
    width, height = spec.grid_dims
    violations: List[Violation] = []
    if len(mask_rows) != height:
        violations.append(Violation(
            "V-GRID",
            "размер карты не совпадает с grid {}x{} спеки: строк {}, ожидается {}".format(
                width, height, len(mask_rows), height),
        ))
    for y, row in enumerate(mask_rows):
        if len(row) != width:
            violations.append(Violation(
                "V-GRID",
                "строка {} карты длины {}, ожидается {} (grid {}x{})".format(
                    y + 1, len(row), width, width, height),
            ))
    return violations


def _check_symbols(mask_rows: List[List[str]], allowed: Set[str]) -> List[Violation]:
    """Правило 2. V-SYMBOL: все символы ∈ {*, .} ∪ символов типов."""
    bad = [
        (x, y, ch)
        for y, row in enumerate(mask_rows)
        for x, ch in enumerate(row)
        if ch not in allowed
    ]
    if not bad:
        return []
    shown = bad[:_MAX_CELLS_PER_MESSAGE]
    lines = ", ".join("({0}, {1}): '{2}'".format(x, y, ch) for x, y, ch in shown)
    tail = "" if len(bad) <= _MAX_CELLS_PER_MESSAGE else " … и ещё {} клеток".format(len(bad) - len(shown))
    return [Violation("V-SYMBOL", "недопустимый символ(ы): {}{}".format(lines, tail))]


def _check_blocked_preset(
    spec: PlacementSpec, mask_rows: List[List[str]], blocked: Set[Tuple[int, int]]
) -> List[Violation]:
    """Правило 3. V-BLOCKED / V-PRESET: маски не перекроены."""
    violations: List[Violation] = []
    for x, y in sorted(blocked):
        ch = mask_rows[y][x]
        if ch != "*":
            violations.append(Violation(
                "V-BLOCKED",
                "клетка ({}, {}): заблокирована в blocked.txt, на маске '{}'".format(x, y, ch),
            ))
    for type_id, (x, y) in sorted(_preset_cells(spec), key=lambda p: (p[1][1], p[1][0])):
        expected = spec.types[type_id].symbol
        ch = mask_rows[y][x]
        if ch != expected:
            violations.append(Violation(
                "V-PRESET",
                "клетка ({}, {}): preset требует символа '{}', на маске '{}'".format(x, y, expected, ch),
            ))
    return violations


def _check_adjacency(spec: PlacementSpec,
                     cells_by_type: Dict[str, List[Tuple[int, int]]]) -> List[Violation]:
    """Правило 4. V-ADJACENCY: запрещённые пары типов не касаются (8-окрестность).

    Область = связная компонента символов одного типа (``rules.connectivity``,
    обычно 8); семантика разрешения — ``rules.adjacency_ok`` (forbidden +
    опциональный whitelist allow; одинаковые типы всегда разрешены, docs/04 §2).
    """
    connectivity = spec.rules.connectivity
    regions: List[Tuple[str, List[Tuple[int, int]]]] = []
    for type_id in sorted(cells_by_type):
        for comp in _components(cells_by_type[type_id], connectivity):
            regions.append((type_id, comp))

    violations: List[Violation] = []
    for i in range(len(regions)):
        for j in range(i + 1, len(regions)):
            type_a, cells_a = regions[i]
            type_b, cells_b = regions[j]
            if type_a == type_b or adjacency_ok(type_a, type_b, spec.rules):
                continue
            if not clusters_touch(cells_a, cells_b):
                continue
            smaller, larger = ((cells_a, cells_b) if len(cells_a) <= len(cells_b) else (cells_b, cells_a))
            touch = _touch_cell(smaller, set(larger))
            where = "({}, {})".format(touch[0], touch[1]) if touch is not None else "?"
            pair = frozenset((type_a, type_b))
            reason = (
                "rules.adjacency.forbidden"
                if pair in spec.rules.adjacency_forbidden
                else "whitelist rules.adjacency.allow"
            )
            violations.append(Violation(
                "V-ADJACENCY",
                "типы {} и {} запрещены к смежности ({}), касаются у клетки {}".format(
                    type_a, type_b, reason, where),
            ))
    return violations


def _check_rectangles(spec: PlacementSpec,
                      cells_by_type: Dict[str, List[Tuple[int, int]]]) -> List[Violation]:
    """Правило 5. V-RECTANGLE: тип с ровно ОДНИМ кластером shape=rectangle.

    Область типа целиком и есть тот кластер (docs-llm/04 §6); проверка —
    ``rules.is_rectangle`` (bbox заполнен полностью). Типы с несколькими
    кластерами — правило не применяется (неразличимые области, §6).
    """
    violations: List[Violation] = []
    for type_id in sorted(spec.types):
        clusters = [c for c in spec.clusters if c.type_id == type_id]
        if len(clusters) != 1 or clusters[0].shape is not Shape.RECTANGLE:
            continue
        cells = cells_by_type.get(type_id, [])
        if not cells:
            violations.append(Violation(
                "V-RECTANGLE",
                "тип {} (кластер {}): на маске нет клеток типа — область не является "
                "полным прямоугольником".format(type_id, clusters[0].id),
            ))
        elif not is_rectangle(cells):
            xs = [c[0] for c in cells]
            ys = [c[1] for c in cells]
            bbox_area = (max(xs) - min(xs) + 1) * (max(ys) - min(ys) + 1)
            violations.append(Violation(
                "V-RECTANGLE",
                "тип {} (кластер {}): область не является полным прямоугольником — "
                "заполнено {} из {} клеток bounding box".format(
                    type_id, clusters[0].id, len(cells), bbox_area),
            ))
    return violations


def _check_areas(spec: PlacementSpec,
                 cells_by_type: Dict[str, List[Tuple[int, int]]],
                 blocked: Set[Tuple[int, int]],
                 tolerance_percent: float) -> List[Violation]:
    """Правило 6. V-AREA: площадь типа vs сумма целей кластеров типа (допуск %).

    F — как в солвере: клетки **без блокировок** (preset не вычитается);
    цель кластера = ``round(F · areaPercent / 100)`` (docs/06 §4). Нарушение —
    отклонение СТРОГО больше допуска (граница внутри допуска, как в отчёте).
    """
    width, height = spec.grid_dims
    f_base = width * height - len(blocked)
    violations: List[Violation] = []
    for type_id in sorted(spec.types):
        clusters = [c for c in spec.clusters if c.type_id == type_id]
        if not clusters:
            continue
        target = sum(int(round(f_base * c.area_percent / 100.0)) for c in clusters)
        actual = len(cells_by_type.get(type_id, []))
        dev = actual - target
        if target <= 0 or dev == 0:
            continue
        if abs(dev) * 100.0 / target <= tolerance_percent:
            continue
        violations.append(Violation(
            "V-AREA",
            "тип {}: {} клеток против суммы целей {} ({}%) — вне допуска {}%".format(
                type_id, actual, target, dev, _format_percent(tolerance_percent)),
        ))
    return violations


def validate(
    spec: PlacementSpec,
    mask_rows: List[List[str]],
    tolerance_percent: float = WARNING_THRESHOLD_PERCENT,
) -> List[Violation]:
    """Полная проверка маски по спеке (docs-llm/04 §5); чистая функция.

    :param spec: загруженная спека (`spec_io.load_spec`).
    :param mask_rows: карта из ``parse_result_map`` — H строк по W символов.
    :param tolerance_percent: допуск правила 6 (по умолчанию 10 %, как отчёт).
    :return: список нарушений в порядке правил 1–6; пустой список — маска валидна.

    При нарушении V-GRID остальные правила не выполняются: геометрия маски
    непредсказуема, выводятся только нарушения размера.
    """
    grid_violations = _check_grid(spec, mask_rows)
    if grid_violations:
        return grid_violations

    types_by_symbol = {t.symbol: t.type_id for t in spec.types.values()}
    allowed = {"*", "."} | set(types_by_symbol)
    blocked = _blocked_cells(spec)
    cells_by_type = _cells_by_type(mask_rows, types_by_symbol)

    violations: List[Violation] = []
    violations.extend(_check_symbols(mask_rows, allowed))
    violations.extend(_check_blocked_preset(spec, mask_rows, blocked))
    violations.extend(_check_adjacency(spec, cells_by_type))
    violations.extend(_check_rectangles(spec, cells_by_type))
    violations.extend(_check_areas(spec, cells_by_type, blocked, tolerance_percent))
    return violations
