"""Доменная модель: Grid, Cell, ClusterType, Ruleset и связанные dataclass'ы (docs/02).

Соблюдает Python 3.9: только typing.Optional/List/Dict/Tuple/Set/FrozenSet,
без match-выражений и без `X | Y` в аннотациях.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, FrozenSet, List, Optional, Set, Tuple


# ---------------------------------------------------------------------------
# Cell — ячейка сетки (docs/02 §1)
# ---------------------------------------------------------------------------

class CellState(Enum):
    """Состояние ячейки: free / blocked / placed."""

    FREE = "free"
    BLOCKED = "blocked"
    PLACED = "placed"


@dataclass
class Cell:
    """Одна клетка сетки.

    Для `placed`-ячеек хранится **идентификатор экземпляра** кластера
    (`instance_id`), а не символ — чтобы два соприкасающихся кластера одного
    типа оставались различимыми (слияния нет, docs/01 §3). Символ типа
    выводится только при рендере.
    """

    state: CellState = CellState.FREE
    instance_id: Optional[str] = None  # заполнено только когда state == PLACED


# ---------------------------------------------------------------------------
# ClusterType — тип кластера (docs/02 §2)
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ClusterType:
    """Заранее известный тип из реестра."""

    type_id: str      # ключ в реестре, напр. "ROOM"
    symbol: str       # символ на карте, напр. "R"
    name: Optional[str] = None  # человекочитаемое имя, напр. "Комната"


# ---------------------------------------------------------------------------
# Shape — ограничение формы кластера (docs/02 §3, docs/04 §4)
# ---------------------------------------------------------------------------

class Shape(Enum):
    """Форма кластера: free | rectangle | circle."""

    FREE = "free"
    RECTANGLE = "rectangle"
    CIRCLE = "circle"


# ---------------------------------------------------------------------------
# ClusterInstance — экземпляр кластера (запрос) (docs/02 §3)
# ---------------------------------------------------------------------------

@dataclass
class ClusterInstance:
    """Каждый элемент списка `clusters` в спекации — отдельный экземпляр.

    Повтор типа = разные экземпляры.
    """

    id: str                       # человекочитаемый id, напр. "room1"
    type_id: str                  # тип из реестра
    area_percent: float           # доля от доступной площади (0..100]
    shape: Shape = Shape.FREE     # FREE | RECTANGLE | CIRCLE
    target_cells: int = 0         # расчётная цель = round(F * area_percent / 100)
    actual_cells: List[Tuple[int, int]] = field(default_factory=list)  # (x, y)
    is_preset: bool = False       # True если кластер пришёл из предзаполненной карты


# ---------------------------------------------------------------------------
# Grid — сетка (docs/02 §4)
# ---------------------------------------------------------------------------

@dataclass
class Grid:
    """Прямоугольная пиксельная сетка W × H. `cells` адресуются как [y][x]."""

    width: int
    height: int
    cells: List[List[Cell]] = field(default_factory=list)

    def __post_init__(self) -> None:
        if self.width <= 0 or self.height <= 0:
            raise ValueError("width и height должны быть > 0")
        if not self.cells:
            # Пустая сетка: все клетки free.
            self.cells = [[Cell() for _ in range(self.width)] for _ in range(self.height)]
        elif (len(self.cells) != self.height or any(len(row) != self.width for row in self.cells)):
            raise ValueError("размер cells должен совпадать с width × height")

    def cell(self, x: int, y: int) -> Cell:
        """Клетка по координатам (x — вдоль ширины, y — вдоль высоты)."""
        if not (0 <= x < self.width and 0 <= y < self.height):
            raise IndexError("координаты вне сетки: ({}, {}) при {}x{}".format(x, y, self.width, self.height))
        return self.cells[y][x]

    def in_bounds(self, x: int, y: int) -> bool:
        """Внутри ли сетка данные координаты."""
        return 0 <= x < self.width and 0 <= y < self.height

    def is_free(self, x: int, y: int) -> bool:
        """Свободна ли клетка (не blocked и не placed). Вне сетки — False."""
        if not self.in_bounds(x, y):
            return False
        return self.cells[y][x].state is CellState.FREE

    def available_area(self) -> int:
        """F = доступная площадь: число клеток, которые не заблокированы
        и не заняты (в т.ч. preset). docs/02 §4."""
        return sum(1 for row in self.cells for c in row if c.state is CellState.FREE)


# ---------------------------------------------------------------------------
# Ruleset — правила размещения (системный уровень) (docs/02 §5)
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Ruleset:
    """Правила размещения. Семантика соседства — docs/04."""

    connectivity: int = 8                       # 4 или 8 (текущий срез: 8)
    adjacency_forbidden: Set[FrozenSet[str]] = field(default_factory=set)
    # пары типов, которым ЗАПРЕЩЕНО касаться (неупорядоченные пары)
    adjacency_allow: Optional[FrozenSet[FrozenSet[str]]] = None
    # если задано — жёсткий whitelist; иначе default-open
    size_min: Optional[int] = None              # жёсткий минимум клеток (default None)
    size_max: Optional[int] = None              # жёсткий максимум клеток (default None)
    convexity_weight: str = "soft"              # "soft" (текущий) — штраф; "hard" — запрет вогнутых
    fill_all: bool = False                      # использовать всю доступную площадь
    touch_all: bool = False                     # все кластеры обязаны примыкать друг к другу (docs/04 §9)


# ---------------------------------------------------------------------------
# PlacementSpec — входной документ целиком (docs/02 §6)
# ---------------------------------------------------------------------------

@dataclass
class PlacementSpec:
    """Агрегирует всё, что приходит на вход."""

    grid_dims: Tuple[int, int]                  # (width, height)
    blocked_file: Optional[str]
    preset_file: Optional[str]
    types: Dict[str, ClusterType]
    rules: Ruleset
    clusters: List[ClusterInstance]


# ---------------------------------------------------------------------------
# PlacementResult — результат (docs/02 §7)
# ---------------------------------------------------------------------------

@dataclass
class PlacementResult:
    """Результат размещения."""

    feasible: bool                              # удалось ли разместить всё (по жёстким условиям)
    grid: Grid                                  # итоговая сетка
    instances: Dict[str, ClusterInstance]       # id -> экземпляр с actual_cells
    warnings: List[str] = field(default_factory=list)
    # напр. «room2 получился меньше запрошенного»
    infeasible_reason: Optional[str] = None     # причина невозможности (если feasible=False)
