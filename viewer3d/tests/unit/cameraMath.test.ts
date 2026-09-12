// Математика камеры (ТЗ 04 §4.3–§4.5, §5) — сверка формул пресетов и фокуса.

import { describe, it, expect } from 'vitest';
import { sceneSpanD, presetCamera, roomFocus, type V3 } from '../../src/scene/cameraMath';
import type { Room } from '../../src/lib/reportParser';

function makeRoom(over: Partial<Room> & Pick<Room, 'bbox' | 'centroid'>): Room {
  return {
    index: 1,
    label: 'room-test',
    symbol: 'A',
    typeId: null,
    tableRow: null,
    cells: [],
    size: 0,
    ...over,
  };
}

describe('sceneSpanD (ТЗ 04 §4.3)', () => {
  it('D = max(W,H)·S·0.9', () => {
    expect(sceneSpanD(50, 30, 1)).toBe(45); // max=50 → 50·0.9
    expect(sceneSpanD(20, 40, 2)).toBe(72); // max=40 → 40·2·0.9
    expect(sceneSpanD(10, 10, 0.5)).toBe(4.5);
  });
});

describe('presetCamera (таблица ТЗ 04 §4.4)', () => {
  const W = 50;
  const H = 30;
  const S = 1;
  const Hw = 3;
  // D = 50·0.9 = 45, target = (0, Hw/2, 0) = (0, 1.5, 0)

  it('Изометрия: позиция (D, 0.9·D, D), цель (0, Hw/2, 0)', () => {
    const pose = presetCamera('iso', W, H, S, Hw);
    expect(pose.position).toEqual([45, 40.5, 45]);
    expect(pose.target).toEqual([0, 1.5, 0]);
  });

  it('Сверху: позиция (0, D, 0.001·D) — смещение по Z против вырожденного up', () => {
    const pose = presetCamera('top', W, H, S, Hw);
    expect(pose.position).toEqual([0, 45, 0.045]);
    expect(pose.target).toEqual([0, 1.5, 0]);
  });

  it('Спереди: позиция (0, Hw/2, D), цель (0, Hw/2, 0)', () => {
    const pose = presetCamera('front', W, H, S, Hw);
    expect(pose.position).toEqual([0, 1.5, 45]);
    expect(pose.target).toEqual([0, 1.5, 0]);
  });

  it('масштаб учитывается: S=2 → D удваивается', () => {
    const pose = presetCamera('iso', W, H, 2, Hw);
    expect(pose.position[0]).toBe(90); // D = 50·2·0.9
  });
});

describe('roomFocus (формула ТЗ 04 §5)', () => {
  // Сетка 10×10, комната 2×2 в клетках x∈[0..1], y∈[0..1]:
  // centroid = ((0+0.5 + 1+0.5)/2, (0+0.5+1+0.5)/2) = (1, 1); bboxW=bboxH=2.
  const room = makeRoom({
    bbox: { x0: 0, y0: 0, x1: 1, y1: 1 },
    centroid: { x: 1, y: 1 },
    size: 4,
    cells: [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ],
  });
  const W = 10;
  const H = 10;

  it('target — центроид в мировых координатах на половине высоты стен', () => {
    const pose = roomFocus(room, W, H, 1, 3, [50, 50, 50] as V3);
    expect(pose.target).toEqual([(1 - 5) * 1, 1.5, (1 - 5) * 1]); // (-4, 1.5, -4)
  });

  it('dist = max(bboxW,bboxH)·S·1.6 + Hw; позиция = target + dir·dist', () => {
    // текущая позиция (50, 50, 50): dir = normalize((54, 48.5, 54))
    const pose = roomFocus(room, W, H, 1, 3, [50, 50, 50]);
    const dist = 2 * 1 * 1.6 + 3; // = 6.2
    const dx = 54 / Math.hypot(54, 48.5, 54);
    const dy = 48.5 / Math.hypot(54, 48.5, 54);
    expect(pose.position[0]).toBeCloseTo(-4 + dx * dist, 9);
    expect(pose.position[1]).toBeCloseTo(1.5 + dy * dist, 9);
    expect(pose.position[2]).toBeCloseTo(-4 + dx * dist, 9);
  });

  it('масштаб: S=2 → target ×2 (относительно центра) и dist по формуле', () => {
    const pose = roomFocus(room, W, H, 2, 3, [100, 100, 100]);
    expect(pose.target).toEqual([-8, 1.5, -8]);
    // dist = 2·2·1.6 + 3 = 9.4; dir от (100,100,100) к (-8,1.5,-8)
    const len = Math.hypot(108, 98.5, 108);
    expect(pose.position[0]).toBeCloseTo(-8 + (108 / len) * 9.4, 9);
  });

  it('вырожденный случай: камера в центре комнаты → направление изометрическое', () => {
    const pose = roomFocus(room, W, H, 1, 3, [-4, 1.5, -4]); // ровно в target
    const dist = 6.2;
    const n = 1 / Math.hypot(1, 1, 1);
    expect(pose.position[0]).toBeCloseTo(-4 + n * dist, 9);
    expect(pose.position[1]).toBeCloseTo(1.5 + n * dist, 9);
    expect(pose.position[2]).toBeCloseTo(-4 + n * dist, 9);
  });

  it('неравномерный bbox: используется max(bboxW,bboxH)', () => {
    const wide = makeRoom({
      bbox: { x0: 0, y0: 0, x1: 9, y1: 1 }, // bboxW=10, bboxH=2
      centroid: { x: 5, y: 1 },
      size: 20,
    });
    const pose = roomFocus(wide, W, H, 1, 3, [100, 1.5, -4]); // dir = (+1, 0, 0)
    const dist = 10 * 1 * 1.6 + 3; // = 19
    expect(pose.position[0]).toBeCloseTo(0 + 19, 9); // target.x = (5−5)·1 = 0
    expect(pose.position[1]).toBeCloseTo(1.5, 9);
    expect(pose.position[2]).toBeCloseTo(-4, 9);
  });
});
