// Геометрия пола комнаты (src/scene/roomFloor.ts): нормаль вверх, покрытие клеток,
// подъём y = 0.02·S (ТЗ 03 §1/§9). Чистый three — без DOM/WebGL.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildRoomFloorGeometry, FLOOR_EPS_FACTOR } from '../../src/scene/roomFloor';
import type { Room } from '../../src/lib/reportParser';

function makeRoom(cells: Array<[number, number]>): Room {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const cx = cells.reduce((s, [x]) => s + (x + 0.5), 0) / cells.length;
  const cy = cells.reduce((s, [, y]) => s + (y + 0.5), 0) / cells.length;
  for (const [x, y] of cells) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y);
    x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return {
    index: 1,
    label: 'room-test',
    symbol: 'A',
    typeId: null,
    tableRow: null,
    cells,
    size: cells.length,
    bbox: { x0, y0, x1, y1 },
    centroid: { x: cx, y: cy },
  };
}

function allNormals(geometry: THREE.BufferGeometry): number[] {
  const normals = geometry.getAttribute('normal') as THREE.BufferAttribute;
  const out: number[] = [];
  for (let i = 0; i < normals.count; i += 1) out.push(normals.getY(i));
  return out;
}

describe('buildRoomFloorGeometry', () => {
  it('каждая клетка — два треугольника (6 вершин)', () => {
    const geo = buildRoomFloorGeometry(makeRoom([[0, 0]]), 4, 4, 1);
    expect(geo.getAttribute('position').count).toBe(6);
    geo.dispose();
  });

  it('все нормали направлены вверх (+Y) — mesh виден сверху', () => {
    const cells: Array<[number, number]> = [[0, 0], [1, 0], [0, 1], [2, 3]];
    const geo = buildRoomFloorGeometry(makeRoom(cells), 5, 5, 1);
    for (const ny of allNormals(geo)) {
      expect(ny).toBeCloseTo(1, 9);
    }
    geo.dispose();
  });

  it('подъём пола y = FLOOR_EPS · S (ТЗ 03 §1)', () => {
    const geo = buildRoomFloorGeometry(makeRoom([[2, 1]]), 5, 5, 2);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i += 1) {
      // точность float32 (BufferAttribute) — допуск 1e-6
      expect(pos.getY(i)).toBeCloseTo(FLOOR_EPS_FACTOR * 2, 6);
    }
    geo.dispose();
  });

  it('координаты клеток — мировые по формуле ТЗ 03 §1', () => {
    // сетка 4×4, клетка (3,0) при S=1: X ∈ [3−2, 4−2] = [1, 2], Z ∈ [0−2, 1−2] = [−2, −1]
    const geo = buildRoomFloorGeometry(makeRoom([[3, 0]]), 4, 4, 1);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    let xMin = Infinity, xMax = -Infinity, zMin = Infinity, zMax = -Infinity;
    for (let i = 0; i < pos.count; i += 1) {
      xMin = Math.min(xMin, pos.getX(i)); xMax = Math.max(xMax, pos.getX(i));
      zMin = Math.min(zMin, pos.getZ(i)); zMax = Math.max(zMax, pos.getZ(i));
    }
    expect(xMin).toBeCloseTo(1, 9);
    expect(xMax).toBeCloseTo(2, 9);
    expect(zMin).toBeCloseTo(-2, 9);
    expect(zMax).toBeCloseTo(-1, 9);
    geo.dispose();
  });

  it('масштаб S масштабирует координаты (kлетка ×S)', () => {
    const geo = buildRoomFloorGeometry(makeRoom([[3, 0]]), 4, 4, 2);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    let xMax = -Infinity;
    for (let i = 0; i < pos.count; i += 1) xMax = Math.max(xMax, pos.getX(i));
    expect(xMax).toBeCloseTo(4, 9); // (3+1−2)·2
    geo.dispose();
  });
});
