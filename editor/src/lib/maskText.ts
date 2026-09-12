// lib/maskText.ts — parse/dump текстовых масок (ТЗ 02 §3/§5, форматы docs/03 §2–§3).
//
// Чтение терпимое по символам (blocked: любой символ ≠ '*' = свободная;
// preset: '.'/' '/'-' = свободная), строгое по размерности (V-MASK-DIM —
// исключение MaskParseError, код из ТЗ 05).
//
// parsePresetMask возвращает PresetParseResult, а не просто MaskGrid:
// клетки с неизвестным символом НЕ бросают исключение (ТЗ 05 §2.2: «файл при
// этом загружается, редактирование доступно») — они отображаются в модели как
// free и перечисляются в invalidCells + errors (V-MASK-PRESET) для подсветки.
//
// Запись каноническая (ТЗ 02 §5): blocked → '*', preset → символ типа,
// свободная → '.'; height строк по width символов, переводы '\n', последняя
// строка — с завершающим '\n'. Round-trip на канонических эталонах examples —
// побайтовый.

import type {
  BlockedCellValue,
  MaskGrid,
  PresetCellValue,
  ValidationError,
} from './types';

/** Ошибка чтения маски (коды V-* из ТЗ 05 §2). */
export class MaskParseError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'MaskParseError';
    this.code = code;
  }
}

/** Результат чтения preset-карты (ТЗ 05 §2.2: файл загружается даже с ошибками). */
export interface PresetParseResult {
  mask: MaskGrid<PresetCellValue>;
  /** Клетки ([x, y]) с символом, не совпадающим ни с одним типом; в модели — free. */
  invalidCells: [number, number][];
  /** Ошибка V-MASK-PRESET по шаблону ТЗ 05 §5 (одна запись на весь файл). */
  errors: ValidationError[];
}

// ── Вспомогательное ────────────────────────────────────────────────────────

/** Нормализация текста в строки: CRLF/CR → LF, один завершающий '\n' игнорируется. */
function toRows(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const body = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized;
  if (body.length === 0) return [];
  return body.split('\n');
}

function checkDims(rows: string[], width: number, height: number): void {
  if (rows.length !== height) {
    throw new MaskParseError(
      'V-MASK-DIM',
      `Маска имеет размер ${dimOf(rows)}, а сетка в спеке — ${width}×${height}. Перезагрузите маску или измените размер сетки.`,
    );
  }
  for (let y = 0; y < rows.length; y++) {
    if (rows[y].length !== width) {
      throw new MaskParseError(
        'V-MASK-DIM',
        `Маска имеет размер ${dimOf(rows)}, а сетка в спеке — ${width}×${height}. ` +
          `Строка ${y + 1}: длина ${rows[y].length}, ожидается ${width}.`,
      );
    }
  }
}

function dimOf(rows: string[]): string {
  const w = rows.length > 0 ? rows[0].length : 0;
  return `${w}×${rows.length}`;
}

// ── Публичный API ──────────────────────────────────────────────────────────

/** Маска блокировок (docs/03 §2): `*` → blocked, любой другой символ → free. */
export function parseBlockedMask(
  text: string,
  width: number,
  height: number,
): MaskGrid<BlockedCellValue> {
  const rows = toRows(text);
  checkDims(rows, width, height);
  return {
    width,
    height,
    cells: rows.map((row) =>
      Array.from(row).map((ch) => (ch === '*' ? 'blocked' : 'free') as BlockedCellValue),
    ),
  };
}

/**
 * Preset-карта (docs/03 §3): символ типа из спеки → preset, '.'/' '/'-' → free,
 * любой другой символ → клетка free + ошибка V-MASK-PRESET (файл загружается).
 */
export function parsePresetMask(
  text: string,
  width: number,
  height: number,
  typeSymbols: string[],
): PresetParseResult {
  const rows = toRows(text);
  checkDims(rows, width, height);

  const symbolSet = new Set(typeSymbols);
  const freeLike = new Set(['.', ' ', '-']);
  const cells: PresetCellValue[][] = [];
  const invalidCells: [number, number][] = [];

  for (let y = 0; y < rows.length; y++) {
    const rowCells: PresetCellValue[] = [];
    for (let x = 0; x < rows[y].length; x++) {
      const ch = rows[y][x];
      if (symbolSet.has(ch)) {
        rowCells.push({ kind: 'preset', symbol: ch });
      } else if (freeLike.has(ch)) {
        rowCells.push({ kind: 'free' });
      } else {
        // неизвестный символ: в модели — free, клетка помечается для подсветки
        rowCells.push({ kind: 'free' });
        invalidCells.push([x, y]);
      }
    }
    cells.push(rowCells);
  }

  const errors: ValidationError[] = [];
  if (invalidCells.length > 0) {
    const first = invalidCells.slice(0, 5).map(([x, y]) => `(${x}, ${y})`).join(', ');
    // Шаблон ТЗ 05 §5: при N > 5 перечисление сокращается до 5 + «… и ещё {N-5} клеток».
    const tail = invalidCells.length > 5 ? `, … и ещё ${invalidCells.length - 5} клеток` : '';
    errors.push({
      code: 'V-MASK-PRESET',
      message: `Preset: клетка ${first}${tail} содержит символ, не совпадающий ни с одним типом. Исправьте ластиком или перезагрузите файл.`,
      cells: invalidCells,
    });
  }

  return { mask: { width, height, cells }, invalidCells, errors };
}

/**
 * Каноническая запись маски (ТЗ 02 §5). Блок-маска и preset-карта различаются
 * типом клеток: строка ('blocked'/'free') vs объект ({kind, symbol}).
 */
export function dumpMask(mask: MaskGrid): string {
  const lines: string[] = [];
  for (let y = 0; y < mask.height; y++) {
    let line = '';
    for (let x = 0; x < mask.width; x++) {
      const cell = mask.cells[y][x];
      if (typeof cell === 'string') {
        line += cell === 'blocked' ? '*' : '.';
      } else {
        line += cell.kind === 'preset' ? cell.symbol : '.';
      }
    }
    lines.push(line);
  }
  return lines.join('\n') + '\n';
}

// ── Чтение «в собственном размере» (ТЗ 04 §3.5 / 05 §2.1) ────────────────────────
// Файл маски, не совпадающий по размерности с grid, ТАКЖЕ загружается — в своём
// фактическом размере; несоответствие фиксируется ошибкой V-MASK-DIM (в store её
// добавляет MASK_LOADED), сетка показывает заглушку, редактирование заблокировано.
// Исключение остаётся только для пустого/непрямоугольного файла (размер неизвестен).

/** Фактические прямоугольные размеры файла маски; null — файл пуст или «рваный». */
export function maskFileDims(text: string): { width: number; height: number } | null {
  const rows = toRows(text);
  if (rows.length === 0) return null;
  const w = rows[0].length;
  if (w === 0 || !rows.every((r) => r.length === w)) return null;
  return { width: w, height: rows.length };
}

/** Маска блокировок в собственном размере файла. */
export function parseBlockedMaskAny(text: string): MaskGrid<BlockedCellValue> {
  const dims = maskFileDims(text);
  if (!dims) {
    throw new MaskParseError('V-MASK-DIM', 'Маска должна быть непустой прямоугольной сеткой символов.');
  }
  return parseBlockedMask(text, dims.width, dims.height);
}

/** Preset-карта в собственном размере файла. */
export function parsePresetMaskAny(text: string, typeSymbols: string[]): PresetParseResult {
  const dims = maskFileDims(text);
  if (!dims) {
    throw new MaskParseError('V-MASK-DIM', 'Preset-карта должна быть непустой прямоугольной сеткой символов.');
  }
  return parsePresetMask(text, dims.width, dims.height, typeSymbols);
}
