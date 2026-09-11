"""Загрузка и валидация спецификации размещения (docs/03).

Публичный API:
    SpecValidationError                        — ошибка валидации входа (docs/03 §5)
    parse_spec(yaml_text, base_dir=None)       -> PlacementSpec
    load_spec(path)                            -> PlacementSpec
    read_blocked_file(path, width, height)     -> Set[(x, y)]
    read_preset_file(path, width, height, types_by_symbol)
                                               -> List[Tuple[type_id, List[(x, y)]]]
    area_base(grid)                            -> int   (F = клетки без блокировок)
    prepare_placement(spec)                    -> (Grid, List[ClusterInstance])

Поведение:
- `blocked_file`/`preset_file` в возвращаемом PlacementSpec хранятся как
  **абсолютные** пути (относительные пути резолвятся от каталога спекационного
  файла при load_spec / от base_dir при parse_spec).
- Файлы блокировок и preset читаются и валидируются на этапе парсинга
  (docs/03 §5: несовпадение размера — ошибка парсинга).
- `prepare_placement` материализует Grid: блокировки → BLOCKED, группы preset →
  PLACED с id вида `preset_<TYPE>_<n>`; задаёт target_cells запрошенным кластерам.

Решение открытого вопроса (docs/03 §3, docs/05 §6): база F процентов = число
клеток **без блокировок**; preset НЕ вычитается из F и действует как жёсткое
ограничение «не перекрывать» (его клетки помечаются PLACED).
"""

import os
from typing import Dict, List, Optional, Set, Tuple

import yaml

from .models import (
    CellState,
    ClusterInstance,
    ClusterType,
    Grid,
    PlacementSpec,
    Ruleset,
    Shape,
)

# Допустимые значения поля `shape` (docs/03 §4).
SHAPES = {s.value: s for s in Shape}

_NEIGHBOURS_8 = ((-1, -1), (0, -1), (1, -1), (-1, 0), (1, 0), (-1, 1), (0, 1), (1, 1))


class SpecValidationError(ValueError):
    """Ошибки валидации входной спекации (docs/03 §5).

    Сообщение всегда содержит причину и, где возможно, имя поля/файла.
    """


# ---------------------------------------------------------------------------
# Вспомогательные функции валидации
# ---------------------------------------------------------------------------

def _is_int(value: object) -> bool:
    # bool — подтип int, но не считается целым размером/границей.
    return isinstance(value, int) and not isinstance(value, bool)


def _parse_grid(section: object) -> Tuple[int, int]:
    if section is None:
        raise SpecValidationError("не задан обязательный раздел 'grid'")
    if not isinstance(section, dict):
        raise SpecValidationError("раздел 'grid' должен быть объектом (mapping)")
    width = section.get("width")
    height = section.get("height")
    for key, value in (("width", width), ("height", height)):
        if not _is_int(value) or value <= 0:
            raise SpecValidationError(
                "'grid.{}' должно быть положительным целым (получено: {!r})".format(key, value)
            )
    return int(width), int(height)


def _resolve_files(data: dict, base_dir: str) -> Tuple[Optional[str], Optional[str]]:
    blocked_file = data.get("blockedFile")
    preset_file = data.get("presetFile")
    result = []
    for name, value in (("blockedFile", blocked_file), ("presetFile", preset_file)):
        if value is None:
            result.append(None)
        elif not isinstance(value, str):
            raise SpecValidationError("'{}' должно быть строкой-путем или null (получено: {!r})".format(name, value))
        else:
            result.append(os.path.abspath(os.path.join(base_dir, value)))
    return result[0], result[1]


def _parse_types(section: object) -> Dict[str, ClusterType]:
    if section is None:
        return {}
    if not isinstance(section, dict):
        raise SpecValidationError("раздел 'types' должен быть объектом (type_id -> {symbol, name})")
    types: Dict[str, ClusterType] = {}
    seen_symbols: Dict[str, str] = {}
    for key, val in section.items():
        if not isinstance(key, str) or not key:
            raise SpecValidationError("id типа должен быть непустой строкой (получено: {!r})".format(key))
        if not isinstance(val, dict):
            raise SpecValidationError("'types.{}' должно быть объектом {symbol, name}".format(key))
        symbol = val.get("symbol")
        if not isinstance(symbol, str) or len(symbol) != 1:
            raise SpecValidationError(
                "'types.{}.symbol' должен быть одним символом (получено: {!r})".format(key, symbol)
            )
        if symbol in seen_symbols:
            raise SpecValidationError(
                "символ '{}' типа {} уже используется типом {}".format(symbol, key, seen_symbols[symbol])
            )
        name = val.get("name")
        if name is not None and not isinstance(name, str):
            raise SpecValidationError("'types.{}.name' должен быть строкой или отсутствовать".format(key))
        types[key] = ClusterType(type_id=key, symbol=symbol, name=name)
        seen_symbols[symbol] = key
    return types


def _parse_pairs(raw: object, field_name: str, types: Dict[str, ClusterType]) -> List[frozenset]:
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise SpecValidationError(
            "'rules.adjacency.{}' должен быть списком пар [TYPE_A, TYPE_B]".format(field_name)
        )
    pairs: List[frozenset] = []
    known = ", ".join(sorted(types)) or "<нет>"
    for i, pair in enumerate(raw):
        if not isinstance(pair, (list, tuple)) or len(pair) != 2 or not all(isinstance(t, str) for t in pair):
            raise SpecValidationError(
                "'rules.adjacency.{}[{}]' должна быть пара [TYPE_A, TYPE_B]".format(field_name, i)
            )
        a, b = pair
        for t in (a, b):
            if t not in types:
                raise SpecValidationError(
                    "'rules.adjacency.{}': неизвестный тип '{}' (известные: {})".format(field_name, t, known)
                )
        pairs.append(frozenset((a, b)))
    return pairs


def _parse_size_bound(raw: object, bound_name: str) -> Optional[int]:
    if raw is None:
        return None
    if not _is_int(raw) or raw <= 0:
        raise SpecValidationError(
            "'rules.size.{}' должен быть положительным целым или null (получено: {!r})".format(bound_name, raw)
        )
    return int(raw)


def _parse_rules(section: object, types: Dict[str, ClusterType]) -> Ruleset:
    if section is None:
        return Ruleset()
    if not isinstance(section, dict):
        raise SpecValidationError("раздел 'rules' должен быть объектом (mapping)")

    connectivity = section.get("connectivity", 8)
    if not _is_int(connectivity) or connectivity not in (4, 8):
        raise SpecValidationError("'rules.connectivity' должен быть 4 или 8 (получено: {!r})".format(connectivity))

    forbidden: Set[frozenset] = set()
    allow: Optional[frozenset] = None
    adjacency = section.get("adjacency")
    if adjacency is not None:
        if not isinstance(adjacency, dict):
            raise SpecValidationError("'rules.adjacency' должен быть объектом (forbidden/allow)")
        forbidden = set(_parse_pairs(adjacency.get("forbidden"), "forbidden", types))
        allow_raw = adjacency.get("allow")
        if allow_raw is not None:
            allow = frozenset(_parse_pairs(allow_raw, "allow", types))

    size_min = size_max = None
    size = section.get("size")
    if size is not None:
        if not isinstance(size, dict):
            raise SpecValidationError("'rules.size' должен быть объектом (min/max)")
        size_min = _parse_size_bound(size.get("min"), "min")
        size_max = _parse_size_bound(size.get("max"), "max")

    convexity_weight = "soft"
    convexity = section.get("convexity")
    if convexity is not None:
        if not isinstance(convexity, dict):
            raise SpecValidationError("'rules.convexity' должен быть объектом (weight)")
        weight = convexity.get("weight", "soft")
        if weight not in ("soft", "hard"):
            raise SpecValidationError("'rules.convexity.weight' должен быть 'soft' или 'hard' (получено: {!r})".format(weight))
        convexity_weight = weight

    fill_all = section.get("fillAll", False)
    if not isinstance(fill_all, bool):
        raise SpecValidationError("'rules.fillAll' должен быть boolean (получено: {!r})".format(fill_all))

    return Ruleset(
        connectivity=connectivity,
        adjacency_forbidden=forbidden,
        adjacency_allow=allow,
        size_min=size_min,
        size_max=size_max,
        convexity_weight=convexity_weight,
        fill_all=bool(fill_all),
    )


def _parse_clusters(section: object, types: Dict[str, ClusterType]) -> List[ClusterInstance]:
    if section is None:
        return []
    if not isinstance(section, list):
        raise SpecValidationError("раздел 'clusters' должен быть списком кластеров")
    known = ", ".join(sorted(types)) or "<нет>"
    clusters: List[ClusterInstance] = []
    seen_ids: Set[str] = set()
    total_percent = 0.0
    for i, item in enumerate(section):
        where = "clusters[{}]".format(i)
        if not isinstance(item, dict):
            raise SpecValidationError("'{}' должен быть объектом кластера".format(where))
        cid = item.get("id")
        if not isinstance(cid, str) or not cid:
            raise SpecValidationError("'{}.id' должен быть непустой строкой (получено: {!r})".format(where, cid))
        if cid in seen_ids:
            raise SpecValidationError("дублируется id экземпляра '{}' в пределах одного запроса".format(cid))
        seen_ids.add(cid)

        tid = item.get("type")
        if not isinstance(tid, str) or tid not in types:
            raise SpecValidationError(
                "'{}.type': неизвестный тип '{}' (известные: {})".format(where, tid, known)
            )

        percent = item.get("areaPercent")
        if isinstance(percent, bool) or not isinstance(percent, (int, float)) or not (0 < percent <= 100):
            raise SpecValidationError(
                "'{}.areaPercent' должен быть числом в диапазоне (0..100] (получено: {!r})".format(where, percent)
            )
        total_percent += float(percent)

        shape_raw = item.get("shape", "free")
        if shape_raw not in SHAPES:
            raise SpecValidationError(
                "'{}.shape' должен быть одним из free|rectangle|circle (получено: {!r})".format(where, shape_raw)
            )

        clusters.append(
            ClusterInstance(
                id=cid,
                type_id=tid,
                area_percent=float(percent),
                shape=SHAPES[shape_raw],
            )
        )
    if total_percent > 100 + 1e-9:
        raise SpecValidationError("сумма areaPercent = {:.2f} превышает 100".format(total_percent))
    return clusters


# ---------------------------------------------------------------------------
# Текстовые файлы маски (blocked / preset) — docs/03 §2, §3
# ---------------------------------------------------------------------------

def _read_grid_text(path: str, what: str) -> List[str]:
    """Читает текстовый файл маски; проверяет размерность height строк × width символов."""
    if not os.path.isfile(path):
        raise SpecValidationError("{}: файл не найден: {}".format(what, path))
    with open(path, encoding="utf-8") as f:
        rows = f.read().splitlines()
    return rows


def read_blocked_file(path: str, width: int, height: int) -> Set[Tuple[int, int]]:
    """Маска блокировок (docs/03 §2): `*` — заблокированная клетка.

    Возвращает множество координат (x, y). Размер файла должен быть ровно
    width × height, иначе SpecValidationError.
    """
    rows = _read_grid_text(path, "файл блокировок")
    if len(rows) != height:
        raise SpecValidationError(
            "файл блокировок {} не совпадает по размеру с grid: строк {}, ожидается {}".format(path, len(rows), height)
        )
    for y, row in enumerate(rows):
        if len(row) != width:
            raise SpecValidationError(
                "файл блокировок {}: не совпадает по размеру с grid — строка {} длины {}, ожидается {}".format(
                    path, y + 1, len(row), width
                )
            )
    return {(x, y) for y, row in enumerate(rows) for x, ch in enumerate(row) if ch == "*"}


def read_preset_file(
    path: str, width: int, height: int, types_by_symbol: Dict[str, str]
) -> List[Tuple[str, List[Tuple[int, int]]]]:
    """Предзаполненная карта (docs/03 §3).

    Символ типа из реестра → неподвижный кластер; любой другой символ — свободная
    клетка. Каждые связные (8-окрестность) клетки одного типа образуют отдельную
    группу. Возвращает список (type_id, [(x, y), ...]) в порядке сканирования.
    """
    rows = _read_grid_text(path, "preset-файл")
    if len(rows) != height:
        raise SpecValidationError(
            "preset-файл {} не совпадает по размеру с grid: строк {}, ожидается {}".format(path, len(rows), height)
        )
    for y, row in enumerate(rows):
        if len(row) != width:
            raise SpecValidationError(
                "preset-файл {}: не совпадает по размеру с grid — строка {} длины {}, ожидается {}".format(
                    path, y + 1, len(row), width
                )
            )

    field: List[List[Optional[str]]] = [
        [types_by_symbol.get(ch) for ch in row] for row in rows
    ]
    visited: List[List[bool]] = [[False] * width for _ in range(height)]
    groups: List[Tuple[str, List[Tuple[int, int]]]] = []
    for y0 in range(height):
        for x0 in range(width):
            t = field[y0][x0]
            if t is None or visited[y0][x0]:
                continue
            # BFS по 8-окрестности внутри клеток одного типа.
            stack = [(x0, y0)]
            visited[y0][x0] = True
            cells: List[Tuple[int, int]] = []
            while stack:
                x, y = stack.pop()
                cells.append((x, y))
                for dx, dy in _NEIGHBOURS_8:
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < width and 0 <= ny < height and not visited[ny][nx] and field[ny][nx] == t:
                        visited[ny][nx] = True
                        stack.append((nx, ny))
            groups.append((t, cells))
    return groups


# ---------------------------------------------------------------------------
# Публичные точки входа
# ---------------------------------------------------------------------------

def parse_spec(yaml_text: str, base_dir: Optional[str] = None) -> PlacementSpec:
    """Разбирает YAML-спекацию и валидирует её (docs/03 §1, §5).

    Относительные пути blockedFile/presetFile резолвятся от `base_dir`
    (по умолчанию — текущий каталог); в PlacementSpec сохраняются абсолютные.
    """
    try:
        data = yaml.safe_load(yaml_text)
    except yaml.YAMLError as exc:
        raise SpecValidationError("некорректный YAML: {}".format(" ".join(str(exc).split())))
    if not isinstance(data, dict):
        raise SpecValidationError("корень спекации должен быть объектом (разделы grid/types/rules/clusters)")

    base_dir = os.path.abspath(base_dir or ".")
    width, height = _parse_grid(data.get("grid"))
    blocked_file, preset_file = _resolve_files(data, base_dir)
    types = _parse_types(data.get("types"))
    rules = _parse_rules(data.get("rules"), types)
    clusters = _parse_clusters(data.get("clusters"), types)

    # Валидация файлов на этапе парсинга (docs/03 §5): наличие и размерность.
    if blocked_file is not None:
        read_blocked_file(blocked_file, width, height)
    if preset_file is not None:
        read_preset_file(preset_file, width, height, {t.symbol: t.type_id for t in types.values()})

    return PlacementSpec(
        grid_dims=(width, height),
        blocked_file=blocked_file,
        preset_file=preset_file,
        types=types,
        rules=rules,
        clusters=clusters,
    )


def load_spec(path: str) -> PlacementSpec:
    """Читает YAML-спекацию из файла; относительные пути масок — от каталога спекации."""
    abs_path = os.path.abspath(path)
    if not os.path.isfile(abs_path):
        raise SpecValidationError("файл спекации не найден: {}".format(path))
    with open(abs_path, encoding="utf-8") as f:
        text = f.read()
    return parse_spec(text, base_dir=os.path.dirname(abs_path))


def area_base(grid: Grid) -> int:
    """База F процентов: число клеток **без блокировок** (free + placed).

    docs/03 §2: блокировки — единственное, что вычитается из базы.
    docs/03 §3 / docs/05 §6 (решение): preset НЕ уменьшает F; это жёсткое
    ограничение «не перекрывать», а не часть базы процентов.
    """
    return sum(1 for row in grid.cells for c in row if c.state is not CellState.BLOCKED)


def prepare_placement(spec: PlacementSpec) -> Tuple[Grid, List[ClusterInstance]]:
    """Материализует Grid по спекации и готовит список размещаемых экземпляров.

    - блокировки помечаются BLOCKED;
    - группы preset → клетки PLACED с id `preset_<TYPE>_<n>` (n — номер группы
      внутри типа в порядке сканирования) + неподвижные ClusterInstance
      (is_preset=True, target_cells = размер группы);
    - запрошенным кластерам задаётся target_cells = round(F * areaPercent / 100),
      где F = area_base(grid) (preset не вычитается).

    Возвращает (grid, instances): сначала preset-экземпляры, затем запрошенные.
    """
    width, height = spec.grid_dims
    grid = Grid(width=width, height=height)

    blocked = read_blocked_file(spec.blocked_file, width, height) if spec.blocked_file else set()
    for x, y in blocked:
        grid.cell(x, y).state = CellState.BLOCKED

    groups = (
        read_preset_file(spec.preset_file, width, height, {t.symbol: t.type_id for t in spec.types.values()})
        if spec.preset_file
        else []
    )
    instances: List[ClusterInstance] = []
    per_type_count: Dict[str, int] = {}
    for type_id, cells in groups:
        n = per_type_count.get(type_id, 0) + 1
        per_type_count[type_id] = n
        instance_id = "preset_{}_{}".format(type_id, n)
        for x, y in cells:
            cell = grid.cell(x, y)
            cell.state = CellState.PLACED
            cell.instance_id = instance_id
        instances.append(
            ClusterInstance(
                id=instance_id,
                type_id=type_id,
                area_percent=0.0,
                shape=Shape.FREE,
                target_cells=len(cells),
                actual_cells=list(cells),
                is_preset=True,
            )
        )

    base = area_base(grid)
    for cluster in spec.clusters:
        cluster.target_cells = int(round(base * cluster.area_percent / 100.0))
        instances.append(cluster)
    return grid, instances
