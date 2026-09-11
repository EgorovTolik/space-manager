"""Отчёт: ASCII-рендер сетки, таблица долей, предупреждения и диагностика (docs/06).

Состав отчёта (docs/06):
§3 — ASCII-карта: символ типа из реестра / `*` — blocked / `.` — свободная клетка.
     Два соприкасающихся кластера одного типа рендерятся одинаковым символом;
     различение идёт через таблицу и координаты (docs/06 §3, замечание).
§4 — таблица «запрошено / фактически / отклонение» по каждому размещённому
     кластеру: цель = target_cells (= round(F·% / 100)), факт = len(actual_cells),
     отклонение = факт − цель (клетки и % от цели), статус: ок / недостача / превышение.
§5 — предупреждения при существенном отклонении площади; порог «существенности»
     по умолчанию 10% от цели (docs/05 §6).
§6 — блок о невозможности размещения при feasible=False с причиной из
     `PlacementResult.infeasible_reason` (причины формирует солвер, docs/05 §7).
§7 — выходные коды процесса: константы EXIT_* и `exit_code_for` (используются CLI;
     код 2 — ошибки входных данных, которые не выражаются через PlacementResult).

Python 3.9: только typing, без match и `X | Y` в аннотациях.
"""

from typing import Dict, Iterable, List, Optional

from .models import CellState, ClusterInstance, ClusterType, Grid, PlacementResult

# docs/05 §6 — порог «существенной недостачи» для предупреждения.
WARNING_THRESHOLD_PERCENT = 10.0

# docs/06 §7 — выходные коды процесса (задел для автоматизации).
EXIT_SUCCESS = 0      # размещение найдено (возможно, с предупреждениями)
EXIT_INFEASIBLE = 1   # не удалось разместить (жёсткая невозможность)
EXIT_INPUT_ERROR = 2  # ошибка входных данных (валидация спеки/файлов)

# Заголовки таблицы (docs/06 §4).
_TABLE_HEADERS = ["id", "type", "доля (%)", "цель (клеток)", "факт (клеток)", "отклонение", "статус"]


def exit_code_for(result: PlacementResult) -> int:
    """Выходной код по результату размещения (docs/06 §7).

    0 — feasible=True; 1 — feasible=False. Код 2 (EXIT_INPUT_ERROR) возникает
    на этапе валидации входа и не описывается через PlacementResult — CLI
    назначает его при SpecValidationError.
    """
    return EXIT_SUCCESS if result.feasible else EXIT_INFEASIBLE


# ---------------------------------------------------------------------------
# §3. ASCII-карта
# ---------------------------------------------------------------------------

def render_grid(grid: Grid, instances: Iterable[ClusterInstance], types: Dict[str, ClusterType]) -> str:
    """Рендер сетки в текст (docs/06 §3): одна строка на ряд y=0..height-1.

    - `*` — заблокированная клетка;
    - `.` — свободная клетка;
    - символ типа из реестра — клетка кластера (найдётся через instance_id
      клетки → id экземпляра → type_id).
    Неизвестный instance_id/тип → `?` (защита от повреждённого результата).

    `instances` — итерируемое по ClusterInstance (список или values() словаря);
    из него строится карта id → type_id. Строки не содержат завершающего перевода
    строки, между строками — "\\n".
    """
    instance_type: Dict[str, str] = {inst.id: inst.type_id for inst in instances}

    lines: List[str] = []
    for y in range(grid.height):
        chars: List[str] = []
        for x in range(grid.width):
            cell = grid.cells[y][x]
            if cell.state is CellState.BLOCKED:
                chars.append("*")
            elif cell.state is CellState.FREE:
                chars.append(".")
            else:
                type_id = instance_type.get(cell.instance_id or "")
                ctype = types.get(type_id) if type_id else None
                chars.append(ctype.symbol if ctype else "?")
        lines.append("".join(chars))
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# §4. Таблица «запрошено / фактически / отклонение»
# ---------------------------------------------------------------------------

def _format_percent(value: float) -> str:
    """30.0 → '30', 12.5 → '12.5'."""
    if value == int(value):
        return str(int(value))
    return "{0:g}".format(value)


def _deviation_text(actual: int, target: int) -> str:
    """Формат отклонения (docs/06 §4): '0', '+1 (+3%)', '-4 (-14%)'."""
    dev = actual - target
    if dev == 0:
        return "0"
    if target > 0:
        pct = int(round(dev * 100.0 / target))
        if dev > 0:
            return "+{0} (+{1}%)".format(dev, pct)
        return "{0} ({1}%)".format(dev, pct)
    return "{0:+d}".format(dev)


def _status_text(actual: int, target: int,
                 threshold_percent: float = WARNING_THRESHOLD_PERCENT) -> str:
    """Статус строки таблицы (docs/06 §4): ок / недостача / превышение.

    Малое отклонение в пределах `threshold_percent` (по умолчанию 10% цели,
    docs/05 §6) — «ок» (пример из docs/06 §4: +1 к цели 29 → ок);
    существенное — «недостача» / «превышение».
    """
    dev = actual - target
    if dev == 0:
        return "ок"
    if target > 0 and abs(dev) * 100.0 / target <= threshold_percent:
        return "ок"
    return "недостача" if dev < 0 else "превышение"


def format_table(
    instances: Iterable[ClusterInstance],
    types: Dict[str, ClusterType],
    threshold_percent: float = WARNING_THRESHOLD_PERCENT,
) -> str:
    """Таблица по каждому размещённому кластеру (docs/06 §4).

    Колонки: id | type | доля (%) | цель (клеток) | факт (клеток) | отклонение | статус.
    Preset-кластеры включаются (они тоже размещены): их «доля» — `—` (площадь
    фиксирована картой, а не долей). Тип кластера выводится как type_id из реестра;
    неизвестный type_id → сам id.
    """
    rows: List[List[str]] = []
    for inst in instances:
        actual = len(inst.actual_cells)
        target = inst.target_cells
        share = "—" if inst.is_preset else _format_percent(inst.area_percent)
        ctype = types.get(inst.type_id)
        rows.append([
            inst.id,
            ctype.type_id if ctype else inst.type_id,
            share,
            str(target),
            str(actual),
            _deviation_text(actual, target),
            _status_text(actual, target, threshold_percent),
        ])

    widths = [len(h) for h in _TABLE_HEADERS]
    for row in rows:
        for i, value in enumerate(row):
            if len(value) > widths[i]:
                widths[i] = len(value)

    def line(cells: List[str]) -> str:
        return " | ".join(c.ljust(widths[i]) for i, c in enumerate(cells)).rstrip()

    lines = [line(_TABLE_HEADERS), " | ".join("-" * w for w in widths)]
    lines.extend(line(row) for row in rows)
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# §5. Предупреждения
# ---------------------------------------------------------------------------

def area_warnings(
    instances: Iterable[ClusterInstance],
    threshold_percent: float = WARNING_THRESHOLD_PERCENT,
) -> List[str]:
    """Предупреждения о существенном отклонении площади (docs/06 §5, docs/05 §6).

    Для каждого кластера с target > 0 считается отклонение (факт − цель); если
    |отклонение| / цель × 100 строго больше `threshold_percent` (по умолчанию
    10%) — формируется предупреждение. Недостача:

        WARNING: room2 (ROOM) получился меньше запрошенного: 25 клеток вместо цели 29 (-14%).
                 Полностью вписать кластер в заданную долю не удалось.

    Превышение (мягкое отклонение, тоже сообщается):

        WARNING: room3 (ROOM) получился больше запрошенного: 35 клеток вместо цели 29 (+21%).
                 Площадь превышает заданную долю.

    Preset-кластеры пропускаются (их площадь фиксирована картой).
    """
    out: List[str] = []
    for inst in instances:
        if inst.is_preset or inst.target_cells <= 0:
            continue
        actual = len(inst.actual_cells)
        target = inst.target_cells
        dev = actual - target
        if dev == 0:
            continue
        pct = int(round(abs(dev) * 100.0 / target))
        if abs(dev) * 100.0 / target <= threshold_percent:
            continue
        if dev < 0:
            out.append(
                "WARNING: {id} ({tid}) получился меньше запрошенного: {a} клеток вместо цели {t} (-{p}%).\n"
                "         Полностью вписать кластер в заданную долю не удалось.".format(
                    id=inst.id, tid=inst.type_id, a=actual, t=target, p=pct)
            )
        else:
            out.append(
                "WARNING: {id} ({tid}) получился больше запрошенного: {a} клеток вместо цели {t} (+{p}%).\n"
                "         Площадь превышает заданную долю.".format(
                    id=inst.id, tid=inst.type_id, a=actual, t=target, p=pct)
            )
    return out


# ---------------------------------------------------------------------------
# §6. Сообщение о невозможности размещения
# ---------------------------------------------------------------------------

def infeasible_block(reason: Optional[str]) -> str:
    """Человекочитаемый блок при feasible=False (docs/06 §6, docs/05 §7).

    Конкретная причина (`reason`) формируется солвером — это наиболее частая
    причина обрыва ветки поиска (нехватка площади, нет связного фрагмента,
    конфликт forbidden-пар и т.п.). Если причина не указана — фиксируем это явно.
    """
    text = reason if reason else "конкретная причина не указана"
    return (
        "НЕ УДАЛОСЬ РАЗМЕСТИТЬ ВСЕ КЛАСТЕРЫ.\n"
        "Причина: {0}\n"
        "Рассмотрите: уменьшение доли, смену shape на free, или расширение области."
    ).format(text)


# ---------------------------------------------------------------------------
# Сводный отчёт
# ---------------------------------------------------------------------------

def build_report(result: PlacementResult, types: Dict[str, ClusterType]) -> str:
    """Полный текст отчёта по PlacementResult (docs/06 §3–§6); используется CLI.

    Состав:
    - при feasible=False — блок невозможности (docs/06 §6) в начале;
    - "== КАРТА ==" + ASCII-рендер сетки;
    - "== ТАБЛИЦА: запрошено / фактически / отклонение ==" + таблица;
    - "== ПРЕДУПРЕЖДЕНИЯ ==" — предупреждения из `result.warnings` (внешние,
      напр. от солвера/валидации) плюс автоматически сгенерированные
      `area_warnings`; если пусто — «нет».

    Возвращает текст без завершающего перевода строки.
    """
    instances = list(result.instances.values())
    parts: List[str] = []
    if not result.feasible:
        parts.append(infeasible_block(result.infeasible_reason))
    parts.append("== КАРТА ==")
    parts.append(render_grid(result.grid, instances, types))
    parts.append("== ТАБЛИЦА: запрошено / фактически / отклонение ==")
    parts.append(format_table(instances, types))
    warnings = list(result.warnings) + area_warnings(instances)
    parts.append("== ПРЕДУПРЕЖДЕНИЯ ==")
    parts.append("\n".join(warnings) if warnings else "нет")
    return "\n\n".join(parts)
