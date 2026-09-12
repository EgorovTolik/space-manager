// Чистая геометрия canvas-видпорта GridCanvas (ТЗ 04 §3.4 / §3.7).
// БЕЗ React и DOM: только числа — ради unit-тестов (tests/unit/gridView.test.ts).
//
// Согласование терминов с ТЗ 04 §3.7:
//   baseCellPx — размер клетки при zoom = 1 (автоподгонка сетки под область);
//   cellPx     = baseCellPx * zoom;
//   pan        — смещение левой верхней точки сетки в пикселях canvas.

export interface Vec2 {
  x: number;
  y: number;
}

/** Диапазон зума (ТЗ 04 §3.4): [автоfit/4 … 32×]. */
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 32;

// Численная защита от деления на ноль при вырожденных размерах области.
const MIN_CELL_PX = 1e-4;

/** Приведение зума к диапазону [ZOOM_MIN … ZOOM_MAX]; нечисло → fit (1). */
export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(Math.max(zoom, ZOOM_MIN), ZOOM_MAX);
}

/**
 * baseCellPx — размер клетки при zoom = 1: автоподгонка сетки под область
 * (ТЗ 04 §3.4). Берём минимум по осям; вырожденные размеры → 1 px.
 */
export function fitCellPx(viewW: number, viewH: number, gridW: number, gridH: number): number {
  if (viewW <= 0 || viewH <= 0 || gridW <= 0 || gridH <= 0) return 1;
  return Math.max(Math.min(viewW / gridW, viewH / gridH), MIN_CELL_PX);
}

/** cellPx = baseCellPx * zoom (ТЗ 04 §3.7). */
export function cellPx(baseCellPx: number, zoom: number): number {
  return Math.max(baseCellPx * clampZoom(zoom), MIN_CELL_PX);
}

export interface VisibleRange {
  /** Включительные границы по номерам клеток; при empty — x1 = -1. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  empty: boolean;
}

/**
 * Видимый диапазон клеток (crop по rect'у viewport, ТЗ 04 §3.4).
 * Учёт отрицательного pan и zoom < 1 / > 1; границы — по номерам клеток, включительно.
 */
export function visibleRange(
  viewW: number,
  viewH: number,
  pan: Vec2,
  sizePx: number,
  gridW: number,
  gridH: number,
): VisibleRange {
  const s = Math.max(sizePx, MIN_CELL_PX);
  // Клетка с номером i видна, если её интервал [i·s + pan.x, (i+1)·s + pan.x)
  // пересекает [0, viewW). Отсюда:
  const rx0 = Math.floor(-pan.x / s);
  const ry0 = Math.floor(-pan.y / s);
  const rx1 = Math.ceil((viewW - pan.x) / s) - 1;
  const ry1 = Math.ceil((viewH - pan.y) / s) - 1;
  if (rx1 < 0 || ry1 < 0 || rx0 >= gridW || ry0 >= gridH) {
    return { x0: 0, y0: 0, x1: -1, y1: -1, empty: true };
  }
  const x0 = Math.max(rx0, 0);
  const y0 = Math.max(ry0, 0);
  const x1 = Math.min(rx1, gridW - 1);
  const y1 = Math.min(ry1, gridH - 1);
  if (x0 > x1 || y0 > y1) {
    return { x0: 0, y0: 0, x1: -1, y1: -1, empty: true };
  }
  return { x0, y0, x1, y1, empty: false };
}

/**
 * Hit-testing: локальный пиксель canvas → клетка (ТЗ 04 §3.7):
 *   cellX = floor((px − pan.x) / cellPx), аналогично по Y.
 * Клетка вне [0, width) × [0, height) → null (событие игнорируется).
 */
export function hitTest(
  px: number,
  py: number,
  pan: Vec2,
  sizePx: number,
  gridW: number,
  gridH: number,
): Vec2 | null {
  const s = Math.max(sizePx, MIN_CELL_PX);
  const x = Math.floor((px - pan.x) / s);
  const y = Math.floor((py - pan.y) / s);
  if (x < 0 || y < 0 || x >= gridW || y >= gridH) return null;
  return { x, y };
}

/**
 * Зум к курсору (ТЗ 04 §3.7): точка под курсором остаётся неподвижной:
 *   pan' = cursor − (cursor − pan) · (zoom' / zoom).
 */
export function zoomAtCursor(cursor: Vec2, pan: Vec2, fromZoom: number, toZoom: number): Vec2 {
  const k = clampZoom(toZoom) / clampZoom(fromZoom);
  return {
    x: cursor.x - (cursor.x - pan.x) * k,
    y: cursor.y - (cursor.y - pan.y) * k,
  };
}
