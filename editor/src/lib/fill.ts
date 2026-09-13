// Чистая функция flood-fill для инструмента «Заливка» (ST-2): 8-связная область
// клеток с равным значением вокруг стартовой клетки. null в сетке — клетка, занятая
// другой маской: она не входит в область и является её границей (защита ТЗ 04 §3.6).
import type { CellValue } from './types';

/** Канонический ключ значения клетки — сравнение областей для flood-fill. */
export function cellValueKey(v: CellValue): string {
  if (v === 'blocked') return 'b';
  if (v === 'free') return 'f';
  return v.kind === 'preset' ? `p:${v.symbol}` : 'f';
}

/**
 * Flood-fill из клетки (startX, startY) по 8 соседям: собирает ВСЮ связную область
 * клеток, равных стартовой (по `equals`). null-клетки и неравные — граница.
 * Возвращает список координат ВКЛЮЧАЯ стартовую клетку; клик вне сетки → [].
 */
export function floodFill<T>(
  grid: ReadonlyArray<ReadonlyArray<T | null>>,
  startX: number,
  startY: number,
  equals: (a: T, b: T) => boolean,
): [number, number][] {
  const height = grid.length;
  if (startY < 0 || startY >= height) return [];
  const startRow = grid[startY];
  if (!startRow || startX < 0 || startX >= startRow.length) return [];
  const start = startRow[startX];
  if (start === null) return [];

  const result: [number, number][] = [];
  const visited = new Set<string>([`${startX},${startY}`]);
  const stack: [number, number][] = [[startX, startY]];
  while (stack.length > 0) {
    const [x, y] = stack.pop()!;
    result.push([x, y]);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        const row = grid[ny];
        if (!row || nx < 0 || nx >= row.length) continue;
        const key = `${nx},${ny}`;
        if (visited.has(key)) continue;
        const v = row[nx];
        if (v === null || !equals(v, start)) continue;
        visited.add(key);
        stack.push([nx, ny]);
      }
    }
  }
  return result;
}
