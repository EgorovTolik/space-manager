// ST-2: чистая функция flood-fill (lib/fill.ts) для инструмента «Заливка»:
// 8-связные области равных значений, границы по другой маске (null), крайние случаи.
import { describe, expect, it } from 'vitest';
import { cellValueKey, floodFill } from '../../src/lib/fill';
import type { CellValue } from '../../src/lib/types';

const P = (symbol: string): CellValue => ({ kind: 'preset', symbol });
const F: CellValue = { kind: 'free' };

describe('floodFill', () => {
  it('собирает всю связную область равных значений, включая стартовую клетку', () => {
    // Блок «A» 3×3 в поле free; клик по центру → ровно 9 клеток.
    const grid: CellValue[][] = Array.from({ length: 5 }, () => Array<CellValue>(5).fill(F));
    for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) grid[y][x] = P('A');

    const cells = floodFill(grid, 2, 2, (a, b) => cellValueKey(a) === cellValueKey(b));
    expect(cells).toHaveLength(9);
    expect(cells).toContainEqual([2, 2]); // стартовая клетка включена
    for (const [x, y] of cells) {
      expect(x >= 1 && x <= 3 && y >= 1 && y <= 3, `(${x},${y}) внутри блока A`).toBe(true);
    }
  });

  it('8-связность: клетки, соприкасающиеся только по диагонали, — одна область', () => {
    // Два «A» по диагонали: (0,0) и (1,1) → одна область из 2 клеток.
    const grid: CellValue[][] = [
      [P('A'), F],
      [F, P('A')],
    ];
    const cells = floodFill(grid, 0, 0, (a, b) => cellValueKey(a) === cellValueKey(b));
    expect(cells.sort()).toEqual([[0, 0], [1, 1]]);
  });

  it('клетки другой маски (null) — граница области и не входят в результат', () => {
    // «Стена» null отрезает правый столбец: из (0,2) достижим весь левый столбец,
    // но ни одной клетки из правого столбца.
    const grid: (CellValue | null)[][] = [
      [F, null, F],
      [F, null, F],
      [F, null, F],
      [F, null, F],
      [F, null, F],
    ];
    const cells = floodFill(grid, 0, 2, (a, b) => a === b);
    expect(cells.sort((p, q) => p[1] - q[1])).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
      [0, 4],
    ]);
    for (const [x] of cells) expect(x).toBe(0); // в правый столбец не попала ни одна клетка
  });

  it('кольцо другой маски: внутренность — отдельная область (дыра)', () => {
    // Кольцо null вокруг дыры из 3 клеток; клик в дыру → только эти 3 клетки.
    const grid: (CellValue | null)[][] = [
      [F, F, null, null, null, F],
      [F, F, null, F, null, F], // дыра: (3,1) — окружена кольцом по всем 8 соседям
      [F, F, null, null, null, F],
    ];
    const cells = floodFill(grid, 3, 1, (a, b) => a === b);
    expect(cells).toEqual([[3, 1]]);
    // Внешность расколота стеной null на левую (6 клеток) и правую (3 клетки)
    // области; ни одна не включает дыру.
    const left = floodFill(grid, 0, 0, (a, b) => a === b);
    expect(left).toHaveLength(6);
    expect(left).not.toContainEqual([3, 1]);
    const right = floodFill(grid, 5, 0, (a, b) => a === b);
    expect(right).toHaveLength(3);
    expect(right).not.toContainEqual([3, 1]);
  });

  it('blocked-значения: «blocked» ≠ «free» (равенство строк)', () => {
    const grid = ['free', 'blocked', 'free', 'blocked'] as const;
    // Сетка 1×4: область из (2) — только сама клетка ((3) — blocked).
    const cells = floodFill([grid], 2, 0, (a, b) => a === b);
    expect(cells).toEqual([[2, 0]]);
    // Область заблокированных клеток 8-связна по вертикали? Нет: в строке они не
    // соседствуют; проверяем отдельной 2×1 сеткой.
    const vGrid: ('blocked' | 'free')[][] = [['blocked'], ['blocked']];
    expect(floodFill(vGrid, 0, 0, (a, b) => a === b)).toEqual([
      [0, 0],
      [0, 1],
    ]);
  });

  it('пустая сетка и клик вне сетки → []', () => {
    expect(floodFill([], 0, 0, (a, b) => a === b)).toEqual([]);
    const grid: CellValue[][] = [[F]];
    expect(floodFill(grid, -1, 0, (a, b) => a === b)).toEqual([]);
    expect(floodFill(grid, 5, 0, (a, b) => a === b)).toEqual([]);
    expect(floodFill(grid, 0, 3, (a, b) => a === b)).toEqual([]);
  });

  it('клик по клетке другой маски (null) → []', () => {
    const grid: (CellValue | null)[][] = [[F, null]];
    expect(floodFill(grid, 1, 0, (a, b) => a === b)).toEqual([]);
  });

  it('крупная область (>20000 клеток) считается без ошибок', () => {
    // 150×150 = 22500 клеток free → вся сетка одна область.
    const grid: CellValue[][] = Array.from({ length: 150 }, () => Array<CellValue>(150).fill(F));
    const cells = floodFill(grid, 75, 75, (a, b) => a === b);
    expect(cells).toHaveLength(22_500);
  });
});

describe('cellValueKey', () => {
  it('равные значения дают равные ключи, разные — разные', () => {
    expect(cellValueKey('blocked')).toBe('b');
    expect(cellValueKey('free')).toBe(cellValueKey({ kind: 'free' })); // «f» в обеих масках
    expect(cellValueKey(P('A'))).toBe('p:A');
    expect(cellValueKey(P('A'))).not.toBe(cellValueKey(P('B')));
    expect(cellValueKey(F)).not.toBe(cellValueKey(P('A')));
    expect(cellValueKey('blocked')).not.toBe(cellValueKey('free'));
  });
});
