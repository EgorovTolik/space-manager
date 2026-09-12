// Типы внутренней модели редактора.
// Фиксируется ТЗ 02 §1 (модель и маски) и 05 (ValidationError).
//
// Примечание к решению: в ТЗ 02 §1 `MaskGrid.cells` типизирован как CellValue[][],
// а типы клеток для blocked-маски ('blocked' | 'free') и preset-карты
// ({kind:'preset';symbol} | {kind:'free'}) различаются. Чтобы сохранить строгую
// типизацию (strict: true), MaskGrid сделан дженериком с параметром по умолчанию:
//   blockedMask : MaskGrid<BlockedCellValue>
//   presetMask  : MaskGrid<PresetCellValue>

export interface SpecDoc {
  grid: { width: number; height: number };
  blockedFile: string | null; // имя файла маски блокировок в спеке (ТЗ 02 §6)
  presetFile: string | null; // имя файла preset-карты в спеке (ТЗ 02 §6)
  // ключ = id типа; порядок хранения = порядок загрузки/добавления
  // (JS-объект сохраняет порядок вставки строковых ключей)
  types: Record<string, TypeDef>;
  rules: Rules;
  clusters: ClusterEntry[]; // порядок = порядок в списке UI
}

export interface TypeDef {
  symbol: string;
  name: string | null;
}

export type ShapeKind = 'free' | 'rectangle' | 'circle';

export interface ClusterEntry {
  id: string; // уникальный внутри спеки
  type: string; // ключ из types
  areaPercent: number; // (0..100], число
  shape: ShapeKind;
}

export interface Rules {
  connectivity: 4 | 8; // дефолт 8; v1-UI редактирует только 8 (ТЗ 02 §2)
  adjacency: {
    forbidden: [string, string][]; // неупорядоченные пары id типов
    allow: [string, string][] | null; // null = default-open
  };
  size: { min: number | null; max: number | null };
  convexity: { weight: 'soft' | 'hard' }; // v1-UI: только soft
  fillAll: boolean;
  touchAll: boolean;
}

// ── Текстовые маски (размер = spec.grid.width × spec.grid.height) ────────────
export type BlockedCellValue = 'blocked' | 'free'; // для blockedMask
export type PresetCellValue =
  | { kind: 'preset'; symbol: string } // символ ОДНОГО из типов спеки
  | { kind: 'free' }; // для presetMask

export type CellValue = BlockedCellValue | PresetCellValue;

export interface MaskGrid<TCell extends CellValue = CellValue> {
  width: number;
  height: number;
  // cells[y][x]: индексация строка×столбец, y сверху вниз (как в масках и на canvas)
  cells: TCell[][];
}

// Ошибка валидации (ТЗ 05 §0): код V-*, русский текст для баннера,
// опциональный путь к полю и клетки сетки для подсветки.
export interface ValidationError {
  code: string; // V-* из таблицы ТЗ 05 §2
  message: string; // текст на русском, для баннера
  field?: string; // путь к полю модели, напр. 'clusters[1].areaPercent'
  cells?: [number, number][]; // клетки сетки для подсветки
}

// Вид маски (используется в actions и UI-режимах canvas)
export type MaskKind = 'blocked' | 'preset';
