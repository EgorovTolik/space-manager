// Парсер отчёта CLI spaec_manager (result-*.txt) — ТЗ 02 §4–§6.
// Чистая детерминированная функция: без DOM/React/three, все строковые операции
// — в семантике код-поинтов (Array.from), как у Python-рендера (ТЗ 02 §1.2).

/** Заголовок секции карты (ТЗ 02 §1.1 — строгое равенство). */
const MAP_HEADER = '== КАРТА ==';
/** Заголовок секции таблицы (ТЗ 02 §1.1 — строгое равенство). */
const TABLE_HEADER = '== ТАБЛИЦА: запрошено / фактически / отклонение ==';
/** Заголовок секции предупреждений (ТЗ 02 §1.1 — строгое равенство). */
const WARNINGS_HEADER = '== ПРЕДУПРЕЖДЕНИЯ ==';
/** Префикс блока невозможности размещения (ТЗ 02 §1.4). */
const INFEASIBLE_PREFIX = 'НЕ УДАЛОСЬ';
/** Лимиты v1 (ТЗ 02 §5.1, ТЗ 05 §7). */
const MAP_DIMS_LIMIT = 200;
const ROOMS_LIMIT = 128;
/** Символы служебные: не комнаты (ТЗ 02 §4 шаг 4). '?' — псевдокомнаты (см. ниже). */
const NON_ROOM_CHARS: ReadonlySet<string> = new Set(['.', '*']);

/** Один код-поинт карты: '.', '*', '?' или символ типа. */
export type CellChar = string; // длина ровно 1 (Array.from-семантика)

/** Комната = связный компонент (4-связность) одинаковых символов (ТЗ 02 §3). */
export interface Room {
  index: number; // порядковый номер, 1-based, в порядке растрового обхода
  label: string; // метка: id из таблицы (эвристика ТЗ 02 §6) либо автоимя §6.4
  symbol: CellChar; // символ карты ('?' допустим — псевдотип «неизвестный»)
  typeId: string | null; // type_id строки таблицы, если сопоставлена; иначе null
  tableRow: TableRow | null; // строка таблицы, если сопоставлена (для InfoPanel)
  cells: Array<[number, number]>; // координаты клеток [x, y]
  size: number; // = cells.length
  bbox: { x0: number; y0: number; x1: number; y1: number }; // включительные, по клеткам
  centroid: { x: number; y: number }; // среднее центров клеток (угол клетки + 0.5)
}

export interface TableRow {
  id: string; // колонка 'id'
  typeId: string; // колонка 'type' (= type_id из реестра, НЕ символ карты)
  share: number | null; // 'доля (%)'; '—' → null (preset)
  target: number; // 'цель (клеток)'
  actual: number; // 'факт (клеток)'
  deviation: string; // 'отклонение' — дословно ('0', '+1 (+3%)', ...)
  status: string; // 'статус' — дословно ('ок' | 'недостача' | 'превышение')
}

export type IssueLevel = 'error' | 'warning';
export interface ParseIssue {
  code: string; // V-* / W-* (ТЗ 02 §5)
  level: IssueLevel;
  message: string;
}

export interface ParsedReport {
  width: number; // W — из карты
  height: number; // H — из карты
  map: CellChar[][]; // map[y][x], y = строка отчёта (сверху вниз)
  rooms: Room[]; // порядок — растровый обход (ТЗ 02 §4 шаг 5)
  blockedCells: Array<[number, number]>;
  unknownCells: Array<[number, number]>; // клетки '?'
  tableRows: TableRow[]; // все корректно разобранные строки таблицы
  unmatchedRows: TableRow[]; // строки, не сопоставленные ни с одной комнатой (ТЗ 02 §6.5)
  infeasible: boolean; // присутствовал блок «НЕ УДАЛОСЬ…» (ТЗ 02 §1.4)
  infeasibleText: string | null; // текст блока дословно
  warningsSection: string[]; // строки секции ПРЕДУПРЕЖДЕНИЯ (без 'нет')
  issues: ParseIssue[]; // все V-*/W-* по файлу (ТЗ 02 §5)
}

/** Бросается при ошибках уровня error (ТЗ 02 §5); .issues — собранные до сброса. */
export class ReportParseError extends Error {
  constructor(public issues: ParseIssue[]) {
    super(issues.map((i) => i.message).join('; ') || 'report parse error');
    this.name = 'ReportParseError';
  }
}

// ---------------------------------------------------------------------------
// Вспомогательные (чистые) функции
// ---------------------------------------------------------------------------

/** Десятичное целое (колонки «цель»/«факт», ТЗ 02 §4.1). */
function isInt(value: string): boolean {
  return /^[+-]?\d+$/.test(value);
}

/** Строка разделителя таблицы: только '-', ' ', '|' (ТЗ 02 §4.1). */
function isTableSeparator(line: string): boolean {
  if (line.length === 0) return false;
  for (const ch of Array.from(line)) {
    if (ch !== '-' && ch !== ' ' && ch !== '|') return false;
  }
  return true;
}

/** Перевод кода-поинта в U+XXXX для сообщений V-MAP-CHAR. */
function formatCodePoint(cp: number): string {
  return cp.toString(16).toUpperCase().padStart(4, '0');
}

// ---------------------------------------------------------------------------
// parseReport — ТЗ 02 §4 (шаги 1–7)
// ---------------------------------------------------------------------------

/**
 * Разбор текста отчёта CLI (result-*.txt) → ParsedReport.
 * Чистая функция; бросает ReportParseError при кодах V-* (ТЗ 02 §4–§6).
 *
 * Примечания к реализации (уточнения ТЗ, зафиксированы в отчёте подзадачи):
 * - '?' образует псевдокомнаты с автоименами unknown-{k} (ТЗ 02 §3/§6.4 и кейс
 *   P10), но НИКОГДА не сопоставляется со строками таблицы (тип «—», §6.4);
 * - поля таблицы после split(" | ") обрезаются trim'ом: report.py выравнивает
 *   колонки ljust, поэтому в реальном файле у полей есть пробелы справа;
 * - infeasibleText — блок без завершающей пустой строки-разделителя секций.
 */
export function parseReport(text: string): ParsedReport {
  const issues: ParseIssue[] = [];
  const err = (code: string, message: string): void => {
    issues.push({ code, level: 'error', message });
  };
  const warn = (code: string, message: string): void => {
    issues.push({ code, level: 'warning', message });
  };

  const lines = text.split(/\r?\n/); // нормализация CRLF/LF (кейс P12)

  // --- шаг 1. заголовок карты ------------------------------------------------
  const i0 = lines.indexOf(MAP_HEADER);
  if (i0 === -1) {
    err('V-NO-MAP', 'Файл не похож на отчёт spaec_manager: не найдена секция "== КАРТА =="');
    throw new ReportParseError(issues);
  }

  // --- шаг 2. блок невозможности ---------------------------------------------
  let firstNonEmpty = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].length > 0) {
      firstNonEmpty = i;
      break;
    }
  }
  let infeasible = false;
  let infeasibleText: string | null = null;
  if (firstNonEmpty !== -1 && lines[firstNonEmpty].startsWith(INFEASIBLE_PREFIX)) {
    infeasible = true;
    // строки блока до заголовка карты; пустой разделитель секций ("\n\n") не часть блока
    const blockLines = lines.slice(firstNonEmpty, i0);
    while (blockLines.length > 0 && blockLines[blockLines.length - 1] === '') {
      blockLines.pop();
    }
    infeasibleText = blockLines.join('\n');
  }

  // --- шаг 3. извлечение карты -------------------------------------------------
  let j = i0 + 1;
  while (j < lines.length && lines[j] === '') j += 1; // пустая разделительная строка
  const mapLines: string[] = [];
  for (; j < lines.length; j += 1) {
    const line = lines[j];
    if (line === '' || line === TABLE_HEADER || line === WARNINGS_HEADER) break;
    mapLines.push(line);
  }
  if (mapLines.length === 0) {
    err('V-MAP-EMPTY', 'Секция "== КАРТА ==" пуста');
    throw new ReportParseError(issues);
  }

  const H = mapLines.length;
  const rows: CellChar[][] = mapLines.map((l) => Array.from(l));
  const W = rows[0].length;
  // валидация прямоугольности (V-MAP-RECT) и символов (V-MAP-CHAR), ТЗ 02 §4 шаг 3
  for (let y = 0; y < H; y += 1) {
    if (rows[y].length !== W) {
      err(
        'V-MAP-RECT',
        `Карты не прямоугольная: строка ${y + 1} имеет длину ${rows[y].length}, ожидаемо ${W}`,
      );
    }
  }
  for (let y = 0; y < H; y += 1) {
    const row = rows[y];
    for (let x = 0; x < row.length; x += 1) {
      const cp = row[x].codePointAt(0) as number;
      if (cp < 0x20 || cp === 0x7f) {
        err('V-MAP-CHAR', `Запрещённый символ U+${formatCodePoint(cp)} в клетке (${x},${y})`);
      }
    }
  }
  if (W > MAP_DIMS_LIMIT || H > MAP_DIMS_LIMIT) {
    err('V-MAP-DIMS-LIMIT', `Сетка ${W}×${H} превышает лимит v1 (200×200)`);
  }
  if (issues.some((i) => i.level === 'error')) {
    throw new ReportParseError(issues); // карта некорректна — дальше парсить бессмысленно
  }

  const map: CellChar[][] = rows; // map[y][x], y — сверху вниз

  // --- шаг 4. комнаты: BFS по 4-связности одинаковых символов -------------------
  // '.'/'*' — не комнаты (ТЗ 02 §2); '?' — псевдотип, образует комнаты с автоименами
  // unknown-{k} (ТЗ 02 §3 «'?' допустим», §6.4, кейс P10).
  const visited: boolean[][] = Array.from({ length: H }, () => new Array<boolean>(W).fill(false));
  const rooms: Room[] = [];
  let n = 0;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const ch = map[y][x];
      if (visited[y][x] || NON_ROOM_CHARS.has(ch)) continue; // '.', '*' — не комнаты
      n += 1;
      const cells: Array<[number, number]> = [];
      let x0 = W;
      let y0 = H;
      let x1 = -1;
      let y1 = -1;
      const stack: Array<[number, number]> = [[x, y]];
      visited[y][x] = true;
      while (stack.length > 0) {
        const [cx, cy] = stack.pop() as [number, number];
        cells.push([cx, cy]);
        if (cx < x0) x0 = cx;
        if (cy < y0) y0 = cy;
        if (cx > x1) x1 = cx;
        if (cy > y1) y1 = cy;
        // 4-соседи: право, лево, низ, верх (детерминированный порядок)
        const neighbors: Array<[number, number]> = [
          [cx + 1, cy],
          [cx - 1, cy],
          [cx, cy + 1],
          [cx, cy - 1],
        ];
        for (const [nx, ny] of neighbors) {
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          if (visited[ny][nx] || map[ny][nx] !== ch) continue;
          visited[ny][nx] = true;
          stack.push([nx, ny]);
        }
      }
      cells.sort((a, b) => (a[1] - b[1]) || (a[0] - b[0])); // растровый порядок клеток
      const size = cells.length;
      let sumCx = 0;
      let sumCy = 0;
      for (const [px, py] of cells) {
        sumCx += px + 0.5;
        sumCy += py + 0.5;
      }
      rooms.push({
        index: n,
        label: '', // заполняется на шаге 6
        symbol: ch,
        typeId: null,
        tableRow: null,
        cells,
        size,
        bbox: { x0, y0, x1, y1 },
        centroid: { x: sumCx / size, y: sumCy / size },
      });
    }
  }
  if (n > ROOMS_LIMIT) {
    err('V-ROOMS-LIMIT', `Найдено ${n} комнат — превышен лимит v1 (${ROOMS_LIMIT})`);
    throw new ReportParseError(issues);
  }

  // --- шаг 5. служебные наборы ---------------------------------------------------
  const blockedCells: Array<[number, number]> = [];
  const unknownCells: Array<[number, number]> = [];
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (map[y][x] === '*') blockedCells.push([x, y]);
      else if (map[y][x] === '?') unknownCells.push([x, y]);
    }
  }
  if (unknownCells.length > 0) {
    const n = unknownCells.length;
    const shown = unknownCells.slice(0, 5).map(([x, y]) => `(${x},${y})`).join(', ');
    const rest = n - 5;
    warn(
      'W-UNKNOWN-CELLS',
      `${n} клеток с неизвестным типом («?»): ${shown}${rest > 0 ? `, … и ещё ${rest}` : ''} — показаны серым псевдотипом`,
    );
  }

  // --- шаг 6. таблица + эвристика меток -------------------------------------------
  const tableRows = parseTableSection(lines, warn);
  assignLabels(rooms, tableRows);
  const unmatchedRows = filterUnmatched(tableRows, rooms);

  // --- шаг 7. предупреждения -------------------------------------------------------
  const warningsSection = parseWarningsSection(lines);

  if (issues.some((i) => i.level === 'error')) {
    throw new ReportParseError(issues);
  }
  return {
    width: W,
    height: H,
    map,
    rooms,
    blockedCells,
    unknownCells,
    tableRows,
    unmatchedRows,
    infeasible,
    infeasibleText,
    warningsSection,
    issues,
  };
}

// ---------------------------------------------------------------------------
// Шаг 6а — разбор секции ТАБЛИЦА (ТЗ 02 §4.1)
// ---------------------------------------------------------------------------

function parseTableSection(
  lines: string[],
  warn: (code: string, message: string) => void,
): TableRow[] {
  const i1 = lines.indexOf(TABLE_HEADER);
  if (i1 === -1) {
    warn(
      'W-TABLE-MISSING',
      'Секция "== ТАБЛИЦА: запрошено / фактически / отклонение ==" не найдена — метки комнат автоматические',
    );
    return [];
  }
  const tableRows: TableRow[] = [];
  for (let i = i1 + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === WARNINGS_HEADER) break; // конец секции таблицы
    if (line === '') continue;
    if (line.startsWith('id ') || isTableSeparator(line)) continue; // шапка и разделитель
    const parts = line.split(' | ');
    if (parts.length !== 7) {
      warn('W-TABLE-ROW', `Пропущена строка таблицы №${i + 1}: не распознана структура колонок`);
      continue;
    }
    // trim: report.py выравнивает колонки ljust → у полей есть пробелы справа
    const [id, typeId, shareRaw, targetRaw, actualRaw, deviation, status] = parts.map((p) =>
      p.trim(),
    );
    if (!isInt(targetRaw) || !isInt(actualRaw)) {
      warn('W-TABLE-ROW', `Пропущена строка таблицы №${i + 1}: не распознана структура колонок`);
      continue;
    }
    let share: number | null = null;
    if (shareRaw !== '—') {
      const v = Number.parseFloat(shareRaw);
      share = Number.isFinite(v) ? v : null;
    }
    tableRows.push({
      id,
      typeId,
      share,
      target: Number.parseInt(targetRaw, 10),
      actual: Number.parseInt(actualRaw, 10),
      deviation,
      status,
    });
  }
  return tableRows;
}

// ---------------------------------------------------------------------------
// Шаг 6б — эвристика меток (ТЗ 02 §6)
// ---------------------------------------------------------------------------

/** Итеративные однозначные назначения (правила §6.2, псевдокод §6). */
function assignLabels(rooms: Room[], tableRows: TableRow[]): void {
  const used = new Array<boolean>(tableRows.length).fill(false);
  let progress = true;
  while (progress) {
    progress = false;
    for (const room of rooms) {
      if (room.symbol === '?') continue; // псевдотип не сопоставляется (§6.4: тип «—»)
      if (room.tableRow !== null) continue;
      const cands: number[] = [];
      for (let idx = 0; idx < tableRows.length; idx += 1) {
        const r = tableRows[idx];
        if (!used[idx] && r.actual > 0 && r.actual === room.size) cands.push(idx);
      }
      if (cands.length === 1) {
        const row = tableRows[cands[0]];
        used[cands[0]] = true;
        room.label = row.id;
        room.typeId = row.typeId;
        room.tableRow = row;
        progress = true;
      }
    }
  }
  // автоимена (§6.4): k — порядковый номер комнаты СИМВОЛА в растровом обходе,
  // независимо от того, получила ли ранняя комната метку из таблицы (кейс P3)
  const ordinalBySymbol: Record<string, number> = {};
  for (const room of rooms) {
    ordinalBySymbol[room.symbol] = (ordinalBySymbol[room.symbol] ?? 0) + 1;
    if (room.tableRow === null) {
      room.label =
        room.symbol === '?'
          ? `unknown-${ordinalBySymbol[room.symbol]}`
          : `room-${room.symbol.toUpperCase()}-${ordinalBySymbol[room.symbol]}`;
      // typeId/tableRow остаются null — тип не определён по отчёту (ТЗ 02 §6.4, §7 п.5)
    }
  }
}

/** Строки, не использованные ни одной комнатой (включая факт=0), в порядке файла. */
function filterUnmatched(tableRows: TableRow[], rooms: Room[]): TableRow[] {
  const matched = new Set<TableRow>();
  for (const room of rooms) {
    if (room.tableRow !== null) matched.add(room.tableRow);
  }
  return tableRows.filter((r) => !matched.has(r));
}

// ---------------------------------------------------------------------------
// Шаг 7 — секция ПРЕДУПРЕЖДЕНИЯ (ТЗ 02 §4 шаг 7)
// ---------------------------------------------------------------------------

function parseWarningsSection(lines: string[]): string[] {
  const iw = lines.indexOf(WARNINGS_HEADER);
  if (iw === -1) return []; // заголовок отсутствует — секции нет (кода для этого в ТЗ нет)
  const raw = lines.slice(iw + 1).filter((l) => l !== '');
  if (raw.length === 1 && raw[0] === 'нет') return [];
  return raw;
}
