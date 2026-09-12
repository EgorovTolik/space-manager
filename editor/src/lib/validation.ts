// lib/validation.ts — клиентская валидация редактора (ТЗ 05).
//
// validateAll(state) -> ValidationError[] — все коды V-* таблиц ТЗ 05 §2:
//   §2.1 спека:  V-GRID-DIMS, V-MASK-DIM, V-CLUST-TYPE, V-CLUST-ID,
//                V-CLUST-SUM (epsilon 1e-9), V-ADJ-TYPE, V-SHAPE,
//                V-TOUCHALL-TYPE;
//   §2.2 маски:  V-MASK-PRESET (ошибки чтения preset-файла из parsePresetMask
//                пробрасываются как есть + «осиротевшие» клетки, чей символ
//                исчез из реестра типов — например, после TYPE_REMOVE);
//   §2.3:        блокировка — чтение терпимое, кодов нет;
//   §2.4/§5:     V-SIZE (min > max — данные уровня модели, в баннере);
//   §2.5:        V-MASK-CONFLICT (клетка одновременно blocked и preset).
//
// Тексты сообщений — шаблоны ru.validation (ИМЕННО тексты ТЗ 05 §5).
// Валидация — soft gate (ТЗ 05 §0): не блокирует редактирование, результат
// уходит в ui.errors (UI_SET_ERRORS) для баннера и подсветки сетки.
//
// Порядок выдачи ошибок детерминирован: сначала коды спеки (GRID-DIMS,
// CLUST-TYPE/SHAPE по списку кластеров, CLUST-ID, CLUST-SUM, ADJ-TYPE,
// TOUCHALL-TYPE, SIZE), затем маски (V-MASK-DIM blocked → preset,
// проброс ошибок чтения preset, осиротевшие preset-клетки, V-MASK-CONFLICT).

import { ru } from '../i18n/ru';
import type {
  BlockedCellValue,
  MaskGrid,
  PresetCellValue,
  SpecDoc,
  ValidationError,
} from './types';

/** Ввод валидации (состав зафиксирован подзадачей; state без ui — он не влияет на правила). */
export interface ValidateInput {
  spec: SpecDoc | null;
  blockedMask: MaskGrid<BlockedCellValue> | null;
  presetMask: MaskGrid<PresetCellValue> | null;
  /** Имена файлов загруженных масок — для шаблона V-MASK-DIM «загруженный файл» (ТЗ 05 §5). */
  maskFileNames?: { blocked?: string; preset?: string };
  /** Ошибки чтения preset-файла (parsePresetMask, код V-MASK-PRESET) — пробрасываются как есть. */
  presetParseErrors?: ValidationError[];
}

const SHAPES: ReadonlySet<string> = new Set(['free', 'rectangle', 'circle']);
/** Epsilon для V-CLUST-SUM (ТЗ 05 §2.1): сумма считается нарушением, если > 100 + EPSILON. */
export const SUM_EPSILON = 1e-9;

// ── Вспомогательное ────────────────────────────────────────────────────────

/** Подстановка {ключ} → значение (ключи могут содержать спецсимволы, напр. «forbidden|allow»). */
function fill(template: string, subs: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(subs)) {
    out = out.split(`{${key}}`).join(value);
  }
  return out;
}

/**
 * Перечисление клеток для шаблонов ТЗ 05 §5: первые ≤ 5 координат
 * «(x, y), (x, y), …»; при N > 5 — сокращение до 5 + «, … и ещё {N-5} клеток».
 */
function cellsListing(cells: [number, number][]): string {
  const shown = cells.slice(0, 5).map(([x, y]) => `(${x}, ${y})`).join(', ');
  const tail = cells.length > 5 ? `, … и ещё ${cells.length - 5} клеток` : '';
  return `${shown}${tail}`;
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

// ── Проверки по кодам ───────────────────────────────────────────────────────

/** §2.1 V-GRID-DIMS: width/height — положительные целые (защита модели + ручное W×H). */
function checkGrid(spec: SpecDoc, errors: ValidationError[]): void {
  if (!isPositiveInt(spec.grid.width)) {
    errors.push({ code: 'V-GRID-DIMS', field: 'grid.width', message: ru.validation.gridDims });
  }
  if (!isPositiveInt(spec.grid.height)) {
    errors.push({ code: 'V-GRID-DIMS', field: 'grid.height', message: ru.validation.gridDims });
  }
}

/** §2.1 V-CLUST-TYPE / V-SHAPE — по каждому кластеру, в порядке списка. */
function checkClusters(spec: SpecDoc, typeIds: ReadonlySet<string>, errors: ValidationError[]): void {
  spec.clusters.forEach((c, i) => {
    if (!typeIds.has(c.type)) {
      errors.push({
        code: 'V-CLUST-TYPE',
        field: `clusters[${i}].type`,
        message: fill(ru.validation.clustType, { id: c.id, type: String(c.type) }),
      });
    }
    if (!SHAPES.has(String(c.shape))) {
      errors.push({
        code: 'V-SHAPE',
        field: `clusters[${i}].shape`,
        message: fill(ru.validation.clustShape, { id: c.id, shape: String(c.shape) }),
      });
    }
  });
}

/** §2.1 V-CLUST-ID — первая пара дубликатов; «№» — порядковый номер в списке (с 1). */
function checkClusterIds(spec: SpecDoc, errors: ValidationError[]): void {
  const firstIndex = new Map<string, number>();
  for (let i = 0; i < spec.clusters.length; i++) {
    const id = String(spec.clusters[i].id);
    const prev = firstIndex.get(id);
    if (prev !== undefined) {
      errors.push({
        code: 'V-CLUST-ID',
        field: `clusters[${i}].id`,
        message: fill(ru.validation.clustId, { id, i1: String(prev + 1), i2: String(i + 1) }),
      });
      return; // одна ошибка на первое обнаруженное дублирование
    }
    firstIndex.set(id, i);
  }
}

/** §2.1 V-CLUST-SUM — Σ areaPercent > 100 (epsilon 1e-9). */
function checkClusterSum(spec: SpecDoc, errors: ValidationError[]): void {
  const sum = spec.clusters.reduce((acc, c) => {
    const p = c.areaPercent;
    return acc + (typeof p === 'number' && !Number.isNaN(p) ? p : 0);
  }, 0);
  if (sum > 100 + SUM_EPSILON) {
    errors.push({
      code: 'V-CLUST-SUM',
      field: 'clusters',
      message: fill(ru.validation.clustSum, { sum: String(round2(sum)) }),
    });
  }
}

/** §2.1 V-ADJ-TYPE — неизвестные типы в парах adjacency; дедупликация по (список, тип). */
function checkAdjacency(spec: SpecDoc, typeIds: ReadonlySet<string>, errors: ValidationError[]): void {
  const seen = new Set<string>();
  const checkScope = (pairs: [string, string][] | null, scope: 'forbidden' | 'allow'): void => {
    if (pairs === null) return;
    for (const pair of pairs) {
      for (const t of pair) {
        const id = String(t);
        if (!typeIds.has(id) && !seen.has(`${scope}:${id}`)) {
          seen.add(`${scope}:${id}`);
          errors.push({
            code: 'V-ADJ-TYPE',
            field: `rules.adjacency.${scope}`,
            message: fill(ru.validation.adjType, { type: id, 'forbidden|allow': scope }),
          });
        }
      }
    }
  };
  checkScope(spec.rules.adjacency.forbidden, 'forbidden');
  checkScope(spec.rules.adjacency.allow, 'allow');
}

/** §2.1 V-TOUCHALL-TYPE — защита модели (в UI — чекбокс). */
function checkTouchAll(spec: SpecDoc, errors: ValidationError[]): void {
  if (typeof spec.rules.touchAll !== 'boolean') {
    errors.push({ code: 'V-TOUCHALL-TYPE', field: 'rules.touchAll', message: ru.validation.touchAllType });
  }
}

/** §2.4/§5 V-SIZE — min ≤ max (оба заданы). */
function checkSize(spec: SpecDoc, errors: ValidationError[]): void {
  const { min, max } = spec.rules.size;
  if (min !== null && max !== null && min > max) {
    errors.push({
      code: 'V-SIZE',
      field: 'rules.size',
      message: fill(ru.validation.sizeLimit, { min: String(min), max: String(max) }),
    });
  }
}

/**
 * §2.1/§2.2 V-MASK-DIM — размер загруженной маски ≠ grid.
 * Вариант шаблона (ТЗ 05 §5): есть имя файла → «Файл маски …»; нет имени →
 * «Маска … больше не совпадает» (имя для отображения — из поля спеки или
 * дефолтное). cells не выдаются: подсветка — заглушка всей маски (04-ui-ux §3.5).
 */
function checkMaskDims(
  state: ValidateInput,
  errors: ValidationError[],
): void {
  const spec = state.spec;
  if (!spec) return;
  // Используется только ширина/высота маски — общий тип-союз достаточен.
  const kinds: Array<{
    kind: 'blocked' | 'preset';
    mask: MaskGrid<BlockedCellValue> | MaskGrid<PresetCellValue> | null;
    fileField: 'blockedFile' | 'presetFile';
    defaultName: string;
  }> = [
    { kind: 'blocked', mask: state.blockedMask, fileField: 'blockedFile', defaultName: 'blocked.txt' },
    { kind: 'preset', mask: state.presetMask, fileField: 'presetFile', defaultName: 'preset.txt' },
  ];
  for (const { kind, mask, fileField, defaultName } of kinds) {
    if (!mask) continue;
    if (mask.width === spec.grid.width && mask.height === spec.grid.height) continue;
    const fileName = state.maskFileNames?.[kind];
    const message = fileName !== undefined
      ? fill(ru.validation.maskDimFile, {
          name: fileName,
          fw: String(mask.width),
          fh: String(mask.height),
          gw: String(spec.grid.width),
          gh: String(spec.grid.height),
        })
      : fill(ru.validation.maskDimGridChanged, {
          name: spec[fileField] ?? defaultName,
          fw: String(mask.width),
          fh: String(mask.height),
          gw: String(spec.grid.width),
          gh: String(spec.grid.height),
        });
    errors.push({ code: 'V-MASK-DIM', field: fileField, message });
  }
}

/**
 * §2.2 V-MASK-PRESET — «осиротевшие» preset-клетки: символ не совпадает ни с
 * одним типом реестра (например, после TYPE_REMOVE, store их сохраняет).
 * Группировка по символу: одна ошибка на символ, cells — все клетки этого символа.
 */
function checkOrphanPresetCells(
  state: ValidateInput,
  typeSymbols: ReadonlySet<string>,
  errors: ValidationError[],
): void {
  const mask = state.presetMask;
  if (!mask) return;
  const bySymbol = new Map<string, [number, number][]>();
  mask.cells.forEach((row, y) => {
    row.forEach((cell, x) => {
      if (cell.kind === 'preset' && !typeSymbols.has(cell.symbol)) {
        const list = bySymbol.get(cell.symbol);
        if (list) list.push([x, y]);
        else bySymbol.set(cell.symbol, [[x, y]]);
      }
    });
  });
  for (const [symbol, cells] of bySymbol) {
    errors.push({
      code: 'V-MASK-PRESET',
      message: fill(ru.validation.maskPreset, { cells: cellsListing(cells), s: symbol }),
      cells,
    });
  }
}

/**
 * §2.5 V-MASK-CONFLICT — клетка одновременно заблокирована и занята preset'ом.
 * Решение А+Б (ТЗ 05 §2.5): при чтении/редактировании — предупреждение со
 * списком клеток; группировка по типу ({type} = id типа по символу, для
 * осиротевшего символа — сам символ). Сравнивается пересечение размеров
 * (при V-MASK-DIM маски могут быть разного размера).
 */
function checkMaskConflict(
  state: ValidateInput,
  symbolToTypeId: ReadonlyMap<string, string>,
  errors: ValidationError[],
): void {
  const blocked = state.blockedMask;
  const preset = state.presetMask;
  if (!blocked || !preset) return;
  const w = Math.min(blocked.width, preset.width);
  const h = Math.min(blocked.height, preset.height);
  const byType = new Map<string, [number, number][]>();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (blocked.cells[y][x] !== 'blocked') continue;
      const pc = preset.cells[y][x];
      if (pc.kind !== 'preset') continue;
      const label = symbolToTypeId.get(pc.symbol) ?? pc.symbol;
      const list = byType.get(label);
      if (list) list.push([x, y]);
      else byType.set(label, [[x, y]]);
    }
  }
  for (const [label, cells] of byType) {
    errors.push({
      code: 'V-MASK-CONFLICT',
      message: fill(ru.validation.maskConflict, { cells: cellsListing(cells), type: label }),
      cells,
    });
  }
}

// ── Публичный API ──────────────────────────────────────────────────────────

/**
 * Полная валидация состояния редактора (ТЗ 05). Чистая функция: без side-эффектов,
 * детерминированный порядок ошибок. spec === null → [] (маски без спеки невозможны,
 * ТЗ 05 §1).
 */
export function validateAll(state: ValidateInput): ValidationError[] {
  const { spec } = state;
  if (!spec) return [];

  const errors: ValidationError[] = [];
  const typeIds = new Set(Object.keys(spec.types));
  const typeSymbols = new Set(
    Object.values(spec.types).map((t) => String(t.symbol)),
  );
  const symbolToTypeId = new Map<string, string>();
  for (const [id, def] of Object.entries(spec.types)) {
    symbolToTypeId.set(String(def.symbol), id);
  }

  checkGrid(spec, errors);
  checkClusters(spec, typeIds, errors);
  checkClusterIds(spec, errors);
  checkClusterSum(spec, errors);
  checkAdjacency(spec, typeIds, errors);
  checkTouchAll(spec, errors);
  checkSize(spec, errors);
  checkMaskDims(state, errors);

  // §2.2: ошибки чтения preset-файла (V-MASK-PRESET из parsePresetMask) — как есть.
  for (const e of state.presetParseErrors ?? []) errors.push(e);

  checkOrphanPresetCells(state, typeSymbols, errors);
  checkMaskConflict(state, symbolToTypeId, errors);

  return errors;
}
