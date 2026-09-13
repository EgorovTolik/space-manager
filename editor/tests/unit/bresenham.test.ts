// ST-2: чистая функция Брезенхэма (lib/bresenham.ts) для инструмента «Линия»:
// горизонталь/вертикаль/диагональ, порядок от старта к концу, включительность концов.
import { describe, expect, it } from 'vitest';
import { bresenham } from '../../src/lib/bresenham';

describe('bresenham', () => {
  it('горизонтальная линия: все клетки ряда, по порядку', () => {
    expect(bresenham(0, 3, 4, 3)).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
      [3, 3],
      [4, 3],
    ]);
  });

  it('вертикальная линия: все клетки столбца, по порядку', () => {
    expect(bresenham(2, 1, 2, 6)).toEqual([
      [2, 1],
      [2, 2],
      [2, 3],
      [2, 4],
      [2, 5],
      [2, 6],
    ]);
  });

  it('диагональ: точные шаги по одной клетке', () => {
    expect(bresenham(0, 0, 3, 3)).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
    expect(bresenham(3, 3, 0, 0)).toEqual([
      [3, 3],
      [2, 2],
      [1, 1],
      [0, 0],
    ]);
  });

  it('наклонная линия: оба конца включены, длина = max(|dx|,|dy|) + 1', () => {
    const pts = bresenham(0, 0, 5, 2);
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[pts.length - 1]).toEqual([5, 2]);
    expect(pts).toHaveLength(6); // max(5,2)+1
    // Клетки без повторов.
    const keys = new Set(pts.map(([x, y]) => `${x},${y}`));
    expect(keys.size).toBe(pts.length);
  });

  it('отрицательные координаты (линия «влево-вверх») тоже корректны', () => {
    expect(bresenham(-2, -1, 2, -1)).toEqual([
      [-2, -1],
      [-1, -1],
      [0, -1],
      [1, -1],
      [2, -1],
    ]);
    const pts = bresenham(4, 5, 0, 1);
    expect(pts[0]).toEqual([4, 5]);
    expect(pts[pts.length - 1]).toEqual([0, 1]);
  });

  it('нулевая длина: одна клетка', () => {
    expect(bresenham(2, 2, 2, 2)).toEqual([[2, 2]]);
  });
});
