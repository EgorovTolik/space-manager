# 02. Доменная модель

> Сводный индекс: [../README.md](../README.md) · Постановка: [01-problem-statement.md](./01-problem-statement.md)

Доменная модель описывает сущности, которые используют и спекация, и солвер,
и отчёт. Реализация на Python — в пакете `spaec_manager` (см. [07-implementation-plan.md](./07-implementation-plan.md)).

## 1. Cell — ячейка сетки

Состояние ячейки:

| Состояние | Значение |
|---|---|
| `free` | свободно, доступно для размещения |
| `blocked` | заблокировано (`*` в маске), не участвует в размещении и в базе процентов |
| `placed` | занята кластером (указан `instance_id`) |

Важно: в ячейке хранится **идентификатор экземпляра** (`instance_id`), а не символ.
Символ типа выводится только при рендере. Это необходимо, чтобы два соприкасающихся
кластера одного типа оставались различимыми (слияния нет — см. [01](./01-problem-statement.md) §3).

## 2. ClusterType — тип кластера

Заранее известный тип из реестра.

```python
@dataclass(frozen=True)
class ClusterType:
    type_id: str        # ключ в реестре, напр. "ROOM"
    symbol: str         # символ на карте, напр. "R"
    name: str | None = None   # человекочитаемое имя, напр. "Комната"
```

## 3. ClusterInstance — экземпляр кластера (запрос)

Каждый элемент списка `clusters` в спекации — отдельный экземпляр. Повтор типа =
разные экземпляры.

```python
@dataclass
class ClusterInstance:
    id: str                 # человекочитаемый id, напр. "room1"
    type_id: str            # тип из реестра
    area_percent: float     # доля от доступной площади (0..100]
    shape: Shape = Shape.FREE   # FREE | RECTANGLE | CIRCLE
    target_cells: int = 0       # расчётная цель = round(F * area_percent / 100)
    actual_cells: list[tuple[int, int]] = field(default_factory=list)  # (x, y)
    is_preset: bool = False     # True если кластер пришёл из предзаполненной карты
```

## 4. Grid — сетка

```python
class Grid:
    width: int
    height: int
    cells: list[list[Cell]]          # [y][x]
    def is_free(self, x, y) -> bool
    def available_area(self) -> int  # F = число клеток, не blocked и не preset
```

## 5. Ruleset — правила размещения (системный уровень)

```python
@dataclass(frozen=True)
class Ruleset:
    connectivity: int = 8                       # 4 или 8 (текущий срез: 8)
    adjacency_forbidden: set[frozenset[str]] = field(default_factory=set)
                                                 # пары типов, которым ЗАПРЕЩЕНО касаться
    adjacency_allow: frozenset[frozenset[str]] | None = None
                                                 # если задано — жёсткий whitelist; иначе default-open
    size_min: int | None = None                 # жёсткий минимум клеток (default None)
    size_max: int | None = None                 # жёсткий максимум клеток (default None)
    convexity_weight: str = "soft"              # "soft" (текущий) — штраф; "hard" — запрет вогнутых
    fill_all: bool = False                      # использовать всю доступную площадь
```

Семантика соседства подробно: [04-rules-and-adjacency.md](./04-rules-and-adjacency.md).

## 6. PlacementSpec — входной документ целиком

Агрегирует всё, что приходит на вход:

```python
@dataclass
class PlacementSpec:
    grid_dims: tuple[int, int]          # (width, height)
    blocked_file: str | None
    preset_file: str | None
    types: dict[str, ClusterType]
    rules: Ruleset
    clusters: list[ClusterInstance]
```

## 7. PlacementResult — результат

```python
@dataclass
class PlacementResult:
    feasible: bool                       # удалось ли разместить всё (по жёстким условиям)
    grid: Grid                           # итоговая сетка
    instances: dict[str, ClusterInstance]  # id -> экземпляр с actual_cells
    warnings: list[str]                  # напр. «room2 получился меньше запрошенного»
    infeasible_reason: str | None        # причина невозможности (если feasible=False)
```

## 8. Связь с процентами (база F)

- `F` — **доступная площадь** = число клеток, которые **не заблокированы**.
  По явной договорённости: при сетке 10×10 и заблокированном углу 2×2,
  «100% площади для заполнения» = 96 свободных пикселей.
- Целевая площадь экземпляра: `target_cells = round(F * area_percent / 100)`.
- Обязательное условие входа: `Σ area_percent ≤ 100`, иначе запрос неверен по площади.

> Мелкое уточнение на этапе реализации: как предзаполненные (`preset`) кластеры
> влияют на базу F, уточняется при кодировании (по умолчанию база = «не блокировки»,
> preset — это жёсткое ограничение размещения). См. [05-solver-design.md](./05-solver-design.md) §6.
