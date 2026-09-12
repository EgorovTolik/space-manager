// Unit-тесты чистой геометрии viewport'а (src/lib/gridView.ts, ТЗ 04 §3.4/§3.7).
import { describe, it, expect } from 'vitest';
import {
  cellPx,
  clampZoom,
  fitCellPx,
  hitTest,
  visibleRange,
  zoomAtCursor,
  ZOOM_MAX,
  ZOOM_MIN,
} from '../../src/lib/gridView';

describe('fitCellPx — автоподгонка (baseCellPx при zoom = 1)', () => {
  it('берёт минимум по осям: сетка 50×50 в области 800×600 → 12 px', () => {
    expect(fitCellPx(800, 600, 50, 50)).toBe(12);
  });

  it('высокая узкая сетка подгоняется по высоте', () => {
    // min(800/10, 600/100) = min(80, 6) = 6
    expect(fitCellPx(800, 600, 10, 100)).toBe(6);
  });

  it('широкая низкая сетка подгоняется по ширине', () => {
    // min(800/200, 600/5) = min(4, 120) = 4
    expect(fitCellPx(800, 600, 200, 5)).toBe(4);
  });

  it('вырожденная область/сетка → 1 px (без деления на ноль)', () => {
    expect(fitCellPx(0, 600, 50, 50)).toBe(1);
    expect(fitCellPx(800, -5, 50, 50)).toBe(1);
    expect(fitCellPx(800, 600, 0, 50)).toBe(1);
    expect(fitCellPx(800, 600, 50, 0)).toBe(1);
  });

  it('огромная сетка в маленькой области — дробный размер без NaN', () => {
    // min(200/1000, 150/1000) = min(0.2, 0.15) = 0.15
    expect(fitCellPx(200, 150, 1000, 1000)).toBeCloseTo(0.15);
  });
});

describe('cellPx = baseCellPx * zoom', () => {
  it('масштабирует размер клетки', () => {
    expect(cellPx(12, 1)).toBe(12);
    expect(cellPx(12, 8)).toBe(96);
  });

  it('климпует зум в диапазон [автоfit/4 … 32×]', () => {
    expect(cellPx(10, 0)).toBeCloseTo(10 * ZOOM_MIN);
    expect(cellPx(10, 0.5)).toBeCloseTo(5);
    expect(cellPx(10, 100)).toBeCloseTo(10 * ZOOM_MAX);
  });

  it('защищает от деления на ноль при вырожденных значениях', () => {
    expect(cellPx(0, 4)).toBeGreaterThan(0);
    expect(Number.isFinite(cellPx(0, 4))).toBe(true);
  });
});

describe('clampZoom', () => {
  it('границы диапазона: [0.25 … 32]', () => {
    expect(ZOOM_MIN).toBe(0.25); // автоfit/4 (ТЗ 04 §3.4)
    expect(ZOOM_MAX).toBe(32);
  });

  it('значения внутри диапазона не меняются', () => {
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(6.5)).toBe(6.5);
    expect(clampZoom(0.25)).toBe(0.25);
    expect(clampZoom(32)).toBe(32);
  });

  it('значения вне диапазона приводятся к границам', () => {
    expect(clampZoom(0)).toBe(ZOOM_MIN);
    expect(clampZoom(-4)).toBe(ZOOM_MIN);
    expect(clampZoom(1000)).toBe(ZOOM_MAX);
  });

  it('не-число → fit (1)', () => {
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe('visibleRange — кроп видимых клеток', () => {
  // Базовые параметры: область 800×600, клетка 10 px, сетка 50×60.
  const viewW = 800;
  const viewH = 600;
  const size = 10;
  const gridW = 50;
  const gridH = 60;

  it('pan (0,0) — от начала сетки до правого/нижнего края с клипом', () => {
    // x: 0..ceil(800/10)-1=79 → clip 49; y: 0..59 → clip 59
    const r = visibleRange(viewW, viewH, { x: 0, y: 0 }, size, gridW, gridH);
    expect(r).toEqual({ x0: 0, y0: 0, x1: 49, y1: 59, empty: false });
  });

  it('отрицательный pan — сдвиг диапазона вправо/вниз', () => {
    // (−30, −20): первая видимая клетка x=floor(30/10)=3, y=2
    const r = visibleRange(viewW, viewH, { x: -30, y: -20 }, size, gridW, gridH);
    expect(r.empty).toBe(false);
    expect(r.x0).toBe(3);
    expect(r.y0).toBe(2);
  });

  it('zoom < 1 (маленькие клетки) — диапазон шире сетки, клип по границам', () => {
    const r = visibleRange(viewW, viewH, { x: 0, y: 0 }, 5, gridW, gridH);
    expect(r).toEqual({ x0: 0, y0: 0, x1: 49, y1: 59, empty: false });
  });

  it('zoom > 1 (большие клетки) — диапазон уже области', () => {
    // size=40, pan(100,−40): x: floor(−2.5)=−3→0 … ceil(700/40)−1=17; y: floor(1)=1 … ceil(640/40)−1=15
    const r = visibleRange(viewW, viewH, { x: 100, y: -40 }, 40, gridW, gridH);
    expect(r).toEqual({ x0: 0, y0: 1, x1: 17, y1: 15, empty: false });
  });

  it('кроп на границах: видна только узкая полоса справа-сверху', () => {
    // pan(495, 0), size 10, сетка 50×60: x от floor(−49.5)=−50→0 до ceil(305/10)−1=30
    const r = visibleRange(viewW, viewH, { x: 495, y: 0 }, size, 50, 60);
    expect(r.empty).toBe(false);
    expect(r.x0).toBe(0);
    expect(r.x1).toBe(30);
    expect(r.y0).toBe(0);
  });

  it('viewport полностью за сеткой (справа) → empty', () => {
    // pan(5000, 0): rx1 = ceil((800−5000)/10)−1 < 0
    const r = visibleRange(viewW, viewH, { x: 5000, y: 0 }, size, gridW, gridH);
    expect(r.empty).toBe(true);
  });

  it('viewport полностью за сеткой (слева-сверху) → empty', () => {
    // pan(−100000, −100000): rx0 >= width? Нет — rx0 отрицателен; но ry0 = 10000 ≥ gridH → пусто
    const r = visibleRange(viewW, viewH, { x: -100000, y: -100000 }, size, gridW, gridH);
    expect(r.empty).toBe(true);
  });

  it('точное прилегание границы клетки — клетка видна (включительные границы)', () => {
    // pan(−800, 0): правый край области ровно на границе клетки №79 → rx1 = ceil(1600/10)−1 = 159 → clip 49
    const r = visibleRange(viewW, viewH, { x: -490, y: 0 }, size, gridW, gridH);
    // клетка 49 занимает [−490+490, …) = [0, 10) — видна
    expect(r.empty).toBe(false);
    expect(r.x1).toBe(49);
  });
});

describe('hitTest — пиксель → клетка (ТЗ 04 §3.7)', () => {
  it('pan (0,0): угловые и внутренние точки', () => {
    expect(hitTest(0, 0, { x: 0, y: 0 }, 10, 50, 50)).toEqual({ x: 0, y: 0 });
    expect(hitTest(9.9, 9.9, { x: 0, y: 0 }, 10, 50, 50)).toEqual({ x: 0, y: 0 });
    expect(hitTest(499, 499, { x: 0, y: 0 }, 10, 50, 50)).toEqual({ x: 49, y: 49 });
  });

  it('границы клеток при zуме: px ровно на границе → следующая клетка (floor)', () => {
    expect(hitTest(10, 10, { x: 0, y: 0 }, 10, 50, 50)).toEqual({ x: 1, y: 1 });
    // дробный размер клетки: size=25 → клетка №1 начинается с px=25
    expect(hitTest(24.9, 0, { x: 0, y: 0 }, 25, 50, 50)).toEqual({ x: 0, y: 0 });
    expect(hitTest(25, 0, { x: 0, y: 0 }, 25, 50, 50)).toEqual({ x: 1, y: 0 });
  });

  it('учёт pan в формуле floor((px − pan.x)/cellPx)', () => {
    // pan(3, 7): px=3 → floor(0/10)=0; px=12.9 → floor(9.9)=0; px=13 → floor(10)=1
    expect(hitTest(3, 7, { x: 3, y: 7 }, 10, 50, 50)).toEqual({ x: 0, y: 0 });
    expect(hitTest(12.9, 16.9, { x: 3, y: 7 }, 10, 50, 50)).toEqual({ x: 0, y: 0 });
    expect(hitTest(13, 17, { x: 3, y: 7 }, 10, 50, 50)).toEqual({ x: 1, y: 1 });
  });

  it('отрицательный pan: клетка под курсором смещена', () => {
    // pan(−30, −20), px=5 → floor((5+30)/10)=3; py=25 → floor(45/10)=4
    expect(hitTest(5, 25, { x: -30, y: -20 }, 10, 50, 50)).toEqual({ x: 3, y: 4 });
  });

  it('вне сетки → null (слева, сверху, справа, снизу)', () => {
    expect(hitTest(-0.1, 5, { x: 0, y: 0 }, 10, 50, 50)).toBeNull();
    expect(hitTest(5, -0.1, { x: 0, y: 0 }, 10, 50, 50)).toBeNull();
    expect(hitTest(500, 5, { x: 0, y: 0 }, 10, 50, 50)).toBeNull();
    expect(hitTest(5, 500, { x: 0, y: 0 }, 10, 50, 50)).toBeNull();
    // с pan: точка «до начала» сетки
    expect(hitTest(2, 2, { x: 5, y: 5 }, 10, 50, 50)).toBeNull();
  });
});

describe('zoomAtCursor — зум к курсору (ТЗ 04 §3.7)', () => {
  it('pan\' = cursor − (cursor − pan)·(zoom\'/zoom): удвоение зума', () => {
    // cursor(100,100), pan(50,50), k=2 → (100−100, 100−100) = (0,0)
    expect(zoomAtCursor({ x: 100, y: 100 }, { x: 50, y: 50 }, 1, 2)).toEqual({ x: 0, y: 0 });
  });

  it('уменьшение зума — обратное смещение', () => {
    // k=0.5 → (100−25, 100−25) = (75,75)
    expect(zoomAtCursor({ x: 100, y: 100 }, { x: 50, y: 50 }, 2, 1)).toEqual({ x: 75, y: 75 });
  });

  it('курсор в точке pan → pan не меняется', () => {
    expect(zoomAtCursor({ x: 42, y: -8 }, { x: 42, y: -8 }, 1, 4)).toEqual({ x: 42, y: -8 });
  });

  it('точки вблизи курсора остаются неподвижными при зуме', () => {
    // мирная точка под курсором: world = cursor − (cursor−pan) при старом zуме
    const before = zoomAtCursor({ x: 100, y: 100 }, { x: 50, y: 50 }, 2, 8);
    const cellUnder = hitTest(100, 100, before, cellPx(10, 8), 50, 50);
    const sameCellBefore = hitTest(100, 100, { x: 50, y: 50 }, cellPx(10, 2), 50, 50);
    expect(cellUnder).not.toBeNull();
    expect(sameCellBefore).not.toBeNull();
    // клетка под курсором не прыгает дальше чем на половину клетки (погрешность floor)
    const a = cellUnder!;
    const b = sameCellBefore!;
    expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
  });

  it('зумы вне диапазона климпуются (коэффициент не выходит за [0.25 … 32])', () => {
    const k = clampZoom(100) / clampZoom(1);
    expect(k).toBe(ZOOM_MAX);
    const p = zoomAtCursor({ x: 100, y: 100 }, { x: 50, y: 50 }, 1, 100);
    expect(p).toEqual({ x: 100 - 50 * ZOOM_MAX, y: 100 - 50 * ZOOM_MAX });
  });
});
