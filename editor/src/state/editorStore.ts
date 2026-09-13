// Состояние редактора: EditorState (ТЗ 01 §2.3) + useReducer с полным набором
// actions из таблицы ТЗ 01 §2.7 + React-контекст.
//
// Примечания к решениям (отклонений от ТЗ нет):
// - CLUSTER_MOVE в v1 не реализован (ТЗ 01 §2.7: «MOVE — в v1 не реализован»).
// - Dirty-флаг (ТЗ 04 §8) хранится СНАРУЖИ редьюсера: интерфейс EditorState из
//   ТЗ 01 §2.3 dirty-поля не содержит, поэтому флаг ведётся модульной переменной
//   (isDirty()/markClean()) — его будут читать FilesPanel (подзадача панелей).
//   Каждое действие, кроме UI_*, помечает состояние dirty (ТЗ 01 §2.7).
// - TYPE_UPDATE с новым symbol: preset-клетки со старым символом переносятся на
//   новый (палитра preset-редактора строится из типов, вводная №7) — простые
//   операции над структурами в рамках skeleton'а.
// - ui.presetFileErrors: ошибки ЧТЕНИЯ preset-файла (parsePresetMask → V-MASK-PRESET,
//   ТЗ 05 §2.2). Загруженный файл с неизвестными символами моделируется как free-
//   клетки, поэтому сами ошибки хранятся в ui и пробрасываются GridCanvas в
//   validateAll (поле presetParseErrors) — иначе они терялись бы после дебаунса.
import { createContext, createElement, useContext, useReducer } from 'react';
import type { Dispatch, ReactNode } from 'react';
import type {
  BlockedCellValue,
  CellValue,
  ClusterEntry,
  MaskGrid,
  PresetCellValue,
  Rules,
  SpecDoc,
  ValidationError,
} from '../lib/types';

// ── Состояние (ТЗ 01 §2.3, ИМЕННО этот состав) ───────────────────────────────

export interface EditorUIState {
  maskMode: 'blocked' | 'preset'; // активный режим canvas (04 §3)
  tool: 'brush' | 'rect' | 'eraser' | 'fill' | 'line'; // инструмент (fill/line — ST-2)
  paletteSymbol: string | null; // выбранный символ типа в preset-режиме
  pan: { x: number; y: number }; // смещение viewport в пикселях canvas
  zoom: number; // масштаб, 1 = автоподгонка сетки под область
  errors: ValidationError[]; // результат последней валидации (05)
  presetFileErrors: ValidationError[]; // ошибки чтения preset-файла (05 §2.2) — пробрасываются в validateAll
}

export interface EditorState {
  spec: SpecDoc | null; // распарсенная YAML-спекация (модель — ТЗ 02 §1)
  blockedMask: MaskGrid<BlockedCellValue> | null; // маска блокировок, W×H из spec.grid
  presetMask: MaskGrid<PresetCellValue> | null; // карта preset-кластеров, W×H из spec.grid
  ui: EditorUIState; // UI-состояние (не сериализуется)
}

export const initialState: EditorState = {
  spec: null,
  blockedMask: null,
  presetMask: null,
  ui: {
    maskMode: 'blocked',
    tool: 'brush',
    paletteSymbol: null,
    pan: { x: 0, y: 0 },
    zoom: 1,
    errors: [],
    presetFileErrors: [],
  },
};

// ── Actions (полный список — ТЗ 01 §2.7) ─────────────────────────────────────

export type EditorAction =
  | { type: 'SPEC_LOADED'; doc: SpecDoc }
  | {
      type: 'MASK_LOADED';
      kind: 'blocked' | 'preset';
      mask: MaskGrid;
      fileName?: string;
      presetErrors?: ValidationError[]; // ошибки чтения preset-файла (05 §2.2)
    }
  | { type: 'MASK_ADDED'; kind: 'blocked' | 'preset' }
  | { type: 'MASK_CLEARED'; kind: 'blocked' | 'preset' }
  | { type: 'CELL_SET'; kind: 'blocked' | 'preset'; x: number; y: number; value: CellValue }
  | { type: 'STROKE_APPLY'; kind: 'blocked' | 'preset'; cells: [number, number][]; value: CellValue }
  | {
      type: 'RECT_FILL';
      kind: 'blocked' | 'preset';
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      value: CellValue;
    }
  | { type: 'MASK_CLEAR_ALL'; kind: 'blocked' | 'preset' }
  | { type: 'GRID_RESIZE'; w: number; h: number }
  | { type: 'TYPE_ADD'; id: string; symbol: string; name: string | null }
  | { type: 'TYPE_UPDATE'; id: string; patch: Partial<{ symbol: string; name: string | null }> }
  | { type: 'TYPE_REMOVE'; id: string }
  | { type: 'CLUSTER_ADD'; cluster: ClusterEntry }
  | { type: 'CLUSTER_UPDATE'; id: string; patch: Partial<Omit<ClusterEntry, 'id'>> }
  | { type: 'CLUSTER_REMOVE'; id: string }
  // CLUSTER_MOVE — в v1 не реализован (ТЗ 01 §2.7)
  | { type: 'RULES_UPDATE'; patch: Partial<Rules> }
  | { type: 'UI_SET_MASK_MODE'; mode: 'blocked' | 'preset' }
  | { type: 'UI_SET_TOOL'; tool: EditorUIState['tool'] }
  | { type: 'UI_SET_PALETTE_SYMBOL'; symbol: string | null }
  | { type: 'UI_SET_PAN'; pan: { x: number; y: number } }
  | { type: 'UI_SET_ZOOM'; zoom: number }
  | { type: 'UI_SET_ERRORS'; errors: ValidationError[] };

// ── Вспомогательные функции (чистые операции над структурами) ────────────────

function emptyMask(kind: 'blocked' | 'preset', width: number, height: number): MaskGrid {
  if (kind === 'blocked') {
    return {
      width,
      height,
      cells: Array.from({ length: height }, () =>
        Array<BlockedCellValue>(width).fill('free'),
      ),
    };
  }
  return {
    width,
    height,
    cells: Array.from({ length: height }, () =>
      Array<PresetCellValue>(width).fill({ kind: 'free' }),
    ),
  };
}

// Конкретный тип клетки (BlockedCellValue / PresetCellValue) гарантируется
// kind'ом на уровне диспатча — см. приведения в CELL_SET/STROKE_APPLY/RECT_FILL.
function setCell<TCell extends CellValue>(
  mask: MaskGrid<TCell>,
  x: number,
  y: number,
  value: TCell,
): MaskGrid<TCell> {
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return mask;
  const row = mask.cells[y].slice();
  row[x] = value;
  const cells = mask.cells.slice();
  cells[y] = row;
  return { ...mask, cells };
}

function applyCells<TCell extends CellValue>(
  mask: MaskGrid<TCell>,
  coords: [number, number][],
  value: TCell,
): MaskGrid<TCell> {
  let result = mask;
  for (const [x, y] of coords) {
    if (x < 0 || y < 0 || x >= result.width || y >= result.height) continue;
    result = setCell(result, x, y, value);
  }
  return result;
}

interface RectFillArgs {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  value: CellValue;
}

function rectFill<TCell extends CellValue>(
  mask: MaskGrid<TCell>,
  a: RectFillArgs,
  cast: (v: CellValue) => TCell,
): MaskGrid<TCell> {
  const coords: [number, number][] = [];
  const x0 = Math.min(a.x1, a.x2);
  const x1 = Math.max(a.x1, a.x2);
  const y0 = Math.min(a.y1, a.y2);
  const y1 = Math.max(a.y1, a.y2);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) coords.push([x, y]);
  }
  return applyCells(mask, coords, cast(a.value));
}

// Пересоздание маски при GRID_RESIZE: сохраняется пересечение, хвосты отбрасываются
// (ТЗ 01 §2.7 / 04 §1). Новые строки/столбцы — свободные клетки.
function resizeMask<TCell extends CellValue>(
  mask: MaskGrid<TCell>,
  w: number,
  h: number,
): MaskGrid<TCell> {
  if (w === mask.width && h === mask.height) return mask;
  const free = mask.cells[0][0]; // «свободная» клетка данного вида маски
  const cells: TCell[][] = [];
  for (let y = 0; y < h; y++) {
    const row: TCell[] = [];
    for (let x = 0; x < w; x++) {
      row.push(y < mask.height && x < mask.width ? mask.cells[y][x] : free);
    }
    cells.push(row);
  }
  return { width: w, height: h, cells };
}

function baseName(fileName: string): string {
  // basename без пути (редактор не хранит путь на диске, ТЗ 02 §8)
  const parts = fileName.split(/[\\/]/);
  return parts[parts.length - 1] || fileName;
}

// ── Dirty-флаг (ТЗ 04 §8), вне EditorState — см. примечание в шапке ──────────

let dirty = false;

export function isDirty(): boolean {
  return dirty;
}

export function markClean(): void {
  dirty = false;
}

// ── Редьюсер ─────────────────────────────────────────────────────────────────

export function reducer(state: EditorState, action: EditorAction): EditorState {
  // Каждое действие, кроме UI_*, помечает состояние dirty (ТЗ 01 §2.7).
  if (!action.type.startsWith('UI_')) dirty = true;

  switch (action.type) {
    case 'SPEC_LOADED': {
      // Замена spec; маски сохраняются и перепроверяются по новому grid/types
      // (пересчёт валидации — validateAll, следующий модуль; ТЗ 05 §1).
      return { ...state, spec: action.doc };
    }

    case 'MASK_LOADED': {
      const field = action.kind === 'blocked' ? 'blockedFile' : 'presetFile';
      const maskKey = action.kind === 'blocked' ? 'blockedMask' : 'presetMask';
      // ТЗ 02 §6: загрузка маски автоматически ставит её basename в поле спеки,
      // если поле было null.
      let spec = state.spec;
      if (spec && !spec[field] && action.fileName) {
        spec = { ...spec, [field]: baseName(action.fileName) };
      }
      // Конфликт размера — флаг ошибки V-MASK-DIM (ТЗ 01 §2.7 / 05 §2.2):
      // маска сохраняется как загружена, ошибка видна в баннере/на сетке.
      let errors = state.ui.errors;
      if (
        spec &&
        (action.mask.width !== spec.grid.width || action.mask.height !== spec.grid.height)
      ) {
        errors = errors.filter(
          (e) => !(e.code === 'V-MASK-DIM' && e.field === field),
        );
        errors = [
          ...errors,
          {
            code: 'V-MASK-DIM',
            field,
            message: `Файл маски имеет размер ${action.mask.width}×${action.mask.height}, а сетка в спеке — ${spec.grid.width}×${spec.grid.height}.`,
          },
        ];
      }
      return {
        ...state,
        spec,
        [maskKey]: action.mask,
        // Новая preset-карта заменяет старые ошибки чтения; blocked-загрузка не трогает их.
        ui: {
          ...state.ui,
          errors,
          presetFileErrors:
            action.kind === 'preset' ? (action.presetErrors ?? []) : state.ui.presetFileErrors,
        },
      };
    }

    case 'MASK_ADDED': {
      // Пустая маска size=grid, все клетки free (ТЗ 01 §2.7). Маска без спеки невозможна (05 §1).
      if (!state.spec) return state;
      const field = action.kind === 'blocked' ? 'blockedFile' : 'presetFile';
      const maskKey = action.kind === 'blocked' ? 'blockedMask' : 'presetMask';
      const defaultName = action.kind === 'blocked' ? 'blocked.txt' : 'preset.txt';
      const spec = state.spec[field]
        ? state.spec
        : { ...state.spec, [field]: defaultName };
      return {
        ...state,
        spec,
        [maskKey]: emptyMask(action.kind, state.spec.grid.width, state.spec.grid.height),
      };
    }

    case 'MASK_CLEARED': {
      const field = action.kind === 'blocked' ? 'blockedFile' : 'presetFile';
      const maskKey = action.kind === 'blocked' ? 'blockedMask' : 'presetMask';
      const spec = state.spec ? { ...state.spec, [field]: null } : null;
      return {
        ...state,
        spec,
        [maskKey]: null,
        // Ошибки чтения относятся к конкретной карте — вместе с ней и сбрасываются.
        ui: action.kind === 'preset' ? { ...state.ui, presetFileErrors: [] } : state.ui,
      };
    }

    case 'CELL_SET': {
      if (action.kind === 'blocked') {
        if (!state.blockedMask) return state;
        return {
          ...state,
          blockedMask: setCell(
            state.blockedMask,
            action.x,
            action.y,
            action.value as BlockedCellValue,
          ),
        };
      }
      if (!state.presetMask) return state;
      return {
        ...state,
        presetMask: setCell(
          state.presetMask,
          action.x,
          action.y,
          action.value as PresetCellValue,
        ),
      };
    }

    case 'STROKE_APPLY': {
      if (action.kind === 'blocked') {
        if (!state.blockedMask) return state;
        return {
          ...state,
          blockedMask: applyCells(
            state.blockedMask,
            action.cells,
            action.value as BlockedCellValue,
          ),
        };
      }
      if (!state.presetMask) return state;
      return {
        ...state,
        presetMask: applyCells(
          state.presetMask,
          action.cells,
          action.value as PresetCellValue,
        ),
      };
    }

    case 'RECT_FILL': {
      if (action.kind === 'blocked') {
        if (!state.blockedMask) return state;
        return { ...state, blockedMask: rectFill(state.blockedMask, action, (v) => v as BlockedCellValue) };
      }
      if (!state.presetMask) return state;
      return { ...state, presetMask: rectFill(state.presetMask, action, (v) => v as PresetCellValue) };
    }

    case 'MASK_CLEAR_ALL': {
      const maskKey = action.kind === 'blocked' ? 'blockedMask' : 'presetMask';
      const mask = state[maskKey];
      if (!mask) return state;
      return { ...state, [maskKey]: emptyMask(action.kind, mask.width, mask.height) };
    }

    case 'GRID_RESIZE': {
      if (!state.spec) return state;
      if (state.spec.grid.width === action.w && state.spec.grid.height === action.h) {
        return state;
      }
      const spec: SpecDoc = {
        ...state.spec,
        grid: { width: action.w, height: action.h },
      };
      return {
        ...state,
        spec,
        blockedMask: state.blockedMask
          ? resizeMask(state.blockedMask, action.w, action.h)
          : null,
        presetMask: state.presetMask
          ? resizeMask(state.presetMask, action.w, action.h)
          : null,
        // Координаты клеток в ошибках чтения файла больше не соответствуют сетке.
        ui: { ...state.ui, presetFileErrors: [] },
      };
    }

    case 'TYPE_ADD': {
      if (!state.spec) return state;
      const types = { ...state.spec.types, [action.id]: { symbol: action.symbol, name: action.name } };
      return { ...state, spec: { ...state.spec, types } };
    }

    case 'TYPE_UPDATE': {
      if (!state.spec || !state.spec.types[action.id]) return state;
      const prev = state.spec.types[action.id];
      const next = { ...prev, ...action.patch };
      let presetMask = state.presetMask;
      // Смена symbol — переносим preset-клетки со старого символа на новый (вводная №7).
      if (
        presetMask &&
        action.patch.symbol !== undefined &&
        action.patch.symbol !== prev.symbol
      ) {
        const oldSymbol = prev.symbol;
        const newSymbol = action.patch.symbol;
        presetMask = {
          ...presetMask,
          cells: presetMask.cells.map((row) =>
            row.map((c) =>
              c.kind === 'preset' && c.symbol === oldSymbol
                ? { kind: 'preset', symbol: newSymbol }
                : c,
            ),
          ),
        };
      }
      return {
        ...state,
        presetMask,
        spec: {
          ...state.spec,
          types: { ...state.spec.types, [action.id]: next },
        },
      };
    }

    case 'TYPE_REMOVE': {
      // Каскад (ТЗ 04 §5): удаление типа → кластеры этого типа удаляются,
      // пары adjacency с ним отбрасываются; preset-клетки со снятым символом
      // остаются и помечаются ошибкой валидацией (V-MASK-PRESET).
      if (!state.spec || !state.spec.types[action.id]) return state;
      const rules: Rules = {
        ...state.spec.rules,
        adjacency: {
          forbidden: state.spec.rules.adjacency.forbidden.filter(
            ([a, b]) => a !== action.id && b !== action.id,
          ),
          allow: state.spec.rules.adjacency.allow
            ? state.spec.rules.adjacency.allow.filter(
                ([a, b]) => a !== action.id && b !== action.id,
              )
            : null,
        },
      };
      return {
        ...state,
        spec: {
          ...state.spec,
          types: Object.fromEntries(
            Object.entries(state.spec.types).filter(([id]) => id !== action.id),
          ),
          rules,
          clusters: state.spec.clusters.filter((c) => c.type !== action.id),
        },
      };
    }

    case 'CLUSTER_ADD': {
      if (!state.spec) return state;
      return {
        ...state,
        spec: { ...state.spec, clusters: [...state.spec.clusters, action.cluster] },
      };
    }

    case 'CLUSTER_UPDATE': {
      if (!state.spec) return state;
      return {
        ...state,
        spec: {
          ...state.spec,
          clusters: state.spec.clusters.map((c) =>
            c.id === action.id ? { ...c, ...action.patch } : c,
          ),
        },
      };
    }

    case 'CLUSTER_REMOVE': {
      if (!state.spec) return state;
      return {
        ...state,
        spec: {
          ...state.spec,
          clusters: state.spec.clusters.filter((c) => c.id !== action.id),
        },
      };
    }

    case 'RULES_UPDATE': {
      if (!state.spec) return state;
      // Точечное изменение полей rules (ТЗ 01 §2.7): вложенные объекты
      // (adjacency/size/convexity) передаются целиком в patch.
      return {
        ...state,
        spec: { ...state.spec, rules: { ...state.spec.rules, ...action.patch } },
      };
    }

    case 'UI_SET_MASK_MODE':
      return { ...state, ui: { ...state.ui, maskMode: action.mode } };

    case 'UI_SET_TOOL':
      return { ...state, ui: { ...state.ui, tool: action.tool } };

    case 'UI_SET_PALETTE_SYMBOL':
      return { ...state, ui: { ...state.ui, paletteSymbol: action.symbol } };

    case 'UI_SET_PAN':
      return { ...state, ui: { ...state.ui, pan: action.pan } };

    case 'UI_SET_ZOOM':
      return { ...state, ui: { ...state.ui, zoom: action.zoom } };

    case 'UI_SET_ERRORS':
      return { ...state, ui: { ...state.ui, errors: action.errors } };

    default:
      return state;
  }
}

// ── Контекст + хук ───────────────────────────────────────────────────────────

interface EditorContextValue {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
}

const EditorContext = createContext<EditorContextValue | null>(null);

// createElement вместо JSX: модуль — .ts (имя файла зафиксировано ТЗ 01 §2.4)
export function EditorProvider({ children }: { children: ReactNode }): ReturnType<typeof createElement> {
  const [state, dispatch] = useReducer(reducer, initialState);
  return createElement(EditorContext.Provider, { value: { state, dispatch } }, children);
}

export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx) {
    throw new Error('useEditor должен вызываться внутри <EditorProvider>');
  }
  return ctx;
}
