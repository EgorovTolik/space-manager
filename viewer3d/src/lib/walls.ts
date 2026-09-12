// Геометрия стен (ТЗ 03) — типы финальные; реализация добавляется в подзадаче 4.
// Модуль чистый: без React/DOM/three. Все координаты — мировые единицы, XZ-плоскость
// (Y — вверх), центр сетки — начало координат (ТЗ 03 §1).

import type { CellChar } from './reportParser';

/** Бокс стены в XZ: центр (x, z) + размеры (sx, sz); высота Hw не передётся (ТЗ 03 §6). */
export interface WallBox {
  x: number;
  z: number;
  sx: number;
  sz: number;
}

/** Параметры геометрии: S — масштаб (ед./клетка), T — толщина стены (ТЗ 03 §9). */
export interface WallParams {
  scale: number;
  wallThickness: number;
}

/** Граничное ребро клетки комнаты (ТЗ 03 §3): сторона + координаты. */
export interface BoundaryEdge {
  side: 'h' | 'v'; // h — горизонтальное (между (x, y) и (x, y+1)); v — вертикальное
  x: number; // для h: левый угол; для v: нижний угол (см. ТЗ 03 §3)
  y: number;
}

/** Склеенный коллинеарный прогон рёбер (ТЗ 03 §4). */
export interface WallSegment {
  kind: 'h' | 'v';
  x0: number; // h: начало по X; v: X вертикали
  y0: number; // v: начало по Y; h: Y горизонтали
  len: number; // длина в клетках
}

/**
 * Извлечение граничных рёбер клеток комнат (дедупликация общих — ТЗ 03 §3).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function boundaryEdges(map: CellChar[][]): BoundaryEdge[] {
  throw new Error('boundaryEdges: не реализовано (подзадача 4)');
}

/**
 * Склейка коллинеарных рёбер в прогоны, включая сквозные T-стыки (ТЗ 03 §4).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function mergeSegments(edges: BoundaryEdge[]): WallSegment[] {
  throw new Error('mergeSegments: не реализовано (подзадача 4)');
}

/**
 * Полный конвейер рёбра → прогоны → боксы с угловыми продолжениями T/2 (ТЗ 03 §5–§6).
 * Порядок результата фиксирован: сначала h-прогоны по y,x, затем v-прогоны по x,y0.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function buildWallBoxes(map: CellChar[][], p: WallParams): WallBox[] {
  throw new Error('buildWallBoxes: не реализовано (подзадача 4)');
}
