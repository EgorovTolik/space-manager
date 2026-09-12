// Чистая математика камеры (ТЗ 04 §4.3–§4.5, §5) — без three/React/DOM, unit-тестируемо.
// Все значения — мировые единицы; системы координат — ТЗ 03 §1.

import type { Room } from '../lib/reportParser';

export type CameraPresetName = 'iso' | 'top' | 'front';

/** Вектор-кортеж [x, y, z] в мировых единицах. */
export type V3 = [number, number, number];

export interface CameraPose {
  position: V3;
  target: V3;
}

/** Нормализованное расстояние камеры D = max(W,H)·S·0.9 (ТЗ 04 §4.3). */
export function sceneSpanD(W: number, H: number, scale: number): number {
  return Math.max(W, H) * scale * 0.9;
}

/**
 * Позиция/цель для пресета вида (таблица ТЗ 04 §4.4). У «Сверху» — смещение
 * 0.001·D по Z: иначе вектор up камеры вырождается и OrbitControls «залипает».
 */
export function presetCamera(
  preset: CameraPresetName,
  W: number,
  H: number,
  scale: number,
  wallHeight: number,
): CameraPose {
  const D = sceneSpanD(W, H, scale);
  const target: V3 = [0, wallHeight / 2, 0];
  switch (preset) {
    case 'iso':
      return { position: [D, 0.9 * D, D], target };
    case 'top':
      return { position: [0, D, 0.001 * D], target };
    case 'front':
      return { position: [0, wallHeight / 2, D], target };
  }
}

/**
 * Фокус камеры на комнате (формула ТЗ 04 §5): центр = центроид в мировых единицах
 * на половине высоты стен; направление — текущий взгляд; расстояние —
 * max(bboxW,bboxH)·S·1.6 + Hw (bbox в клетках: x1−x0+1, y1−y0+1).
 */
export function roomFocus(
  room: Room,
  W: number,
  H: number,
  scale: number,
  wallHeight: number,
  currentPosition: V3,
): CameraPose {
  const target: V3 = [
    (room.centroid.x - W / 2) * scale,
    wallHeight / 2,
    (room.centroid.y - H / 2) * scale,
  ];
  let dx = currentPosition[0] - target[0];
  let dy = currentPosition[1] - target[1];
  let dz = currentPosition[2] - target[2];
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-9) {
    // Камера в центре комнаты — вырожденное направление: берём нормализованное
    // изометрическое (dir остаётся единичным, как и у normalize).
    const inv = 1 / Math.hypot(1, 1, 1);
    dx = inv;
    dy = inv;
    dz = inv;
  } else {
    dx /= len;
    dy /= len;
    dz /= len;
  }
  const bboxW = room.bbox.x1 - room.bbox.x0 + 1;
  const bboxH = room.bbox.y1 - room.bbox.y0 + 1;
  const dist = Math.max(bboxW, bboxH) * scale * 1.6 + wallHeight;
  return { position: [target[0] + dx * dist, target[1] + dy * dist, target[2] + dz * dist], target };
}
