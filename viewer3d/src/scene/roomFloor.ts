// Геометрия пола комнаты (ТЗ 03 §9): плоскость из единичных квадов клеток полиомино,
// один mesh на комнату — чтобы emissive-подсветка выделения затронула только её.
// Чистый three (без React/DOM) — unit-тестируемо в node.

import * as THREE from 'three';
import type { Room } from '../lib/reportParser';

/** Подъём пола над плитой: y = FLOOR_EPS = 0.02·S (ТЗ 03 §1, против z-fighting). */
export const FLOOR_EPS_FACTOR = 0.02;

/**
 * BufferGeometry пола комнаты: по каждой клетке два треугольника с нормалью вверх
 * (+Y) — порядок вершин против часовой стрелки, глядя сверху (при обратном порядке
 * mesh с FrontSide невидим). Координаты — мировые, система ТЗ 03 §1.
 */
export function buildRoomFloorGeometry(room: Room, W: number, H: number, S: number): THREE.BufferGeometry {
  const y = FLOOR_EPS_FACTOR * S;
  const positions: number[] = [];
  for (const [x, cy] of room.cells) {
    const x0 = (x - W / 2) * S;
    const x1 = (x + 1 - W / 2) * S;
    const z0 = (cy - H / 2) * S;
    const z1 = (cy + 1 - H / 2) * S;
    positions.push(x0, y, z0, x1, y, z1, x1, y, z0);
    positions.push(x0, y, z0, x0, y, z1, x1, y, z1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}
