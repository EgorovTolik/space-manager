// Модель данных парсера отчёта (ТЗ 02 §3) — типы финальные; реализация parseReport
// добавляется в подзадаче 3. Модуль чистый: без React/DOM/three.

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

/**
 * Разбор текста отчёта CLI (result-*.txt) → ParsedReport.
 * Чистая функция; бросает ReportParseError при кодах V-* (ТЗ 02 §4–§6).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function parseReport(text: string): ParsedReport {
  throw new Error('parseReport: не реализовано (подзадача 3)');
}
