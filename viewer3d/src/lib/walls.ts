// Геометрия стен (ТЗ 03) — чистые детерминированные функции, без React/DOM/three.
// Все координаты боксов — мировые единицы в XZ-плоскости (Y — вверх), центр сетки —
// начало координат: точка решётки (gx, gy) → X = (gx − W/2)·S, Z = (gy − H/2)·S (ТЗ 03 §1).
// Промежуточные алгоритмы (рёбра, прогоны) считают в единицах сетки; пересчёт ×S —
// один раз при выгрузке боксов. Продолжения углов e = T/2 — МИРОВЫЕ единицы и НЕ
// масштабируются вместе с S (ТЗ 05 §3 G2).

import type { CellChar } from './reportParser';

/** Бокс стены в XZ: центр (x, z) + размеры (sx, sz); высота Hw не передаётся (ТЗ 03 §6). */
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

/** Граничное ребро на решётке углов (ТЗ 03 §3): h(x,y) — от (x,y) до (x+1,y); v(x,y) — от (x,y) до (x,y+1). */
export interface BoundaryEdge {
  side: 'h' | 'v'; // h — горизонтальное; v — вертикальное
  x: number;
  y: number;
}

/** Склеенный коллинеарный прогон рёбер (ТЗ 03 §4). */
export interface WallSegment {
  kind: 'h' | 'v';
  x0: number; // h: начало по X; v: X вертикали
  y0: number; // v: начало по Y; h: Y горизонтали
  len: number; // длина в клетках
}

/** Индексы прогонов для проверки «перпендикуляр через точку» (ТЗ 03 §5.2). */
export interface SpanIndex {
  /** y → массив диапазонов [x0, x0+len] горизонтальных прогонов на этой линии. */
  hByY: Map<number, Array<[number, number]>>;
  /** x → массив диапазонов [y0, y0+len] вертикальных прогонов на этой линии. */
  vByX: Map<number, Array<[number, number]>>;
}

/** Символы, не являющиеся комнатами (ТЗ 03 §3: не `.`, `*`, `?`). */
const NON_ROOM_CHARS: ReadonlySet<string> = new Set(['.', '*', '?']);

function dims(map: CellChar[][]): { W: number; H: number } {
  const H = map.length;
  return { W: H > 0 ? map[0].length : 0, H };
}

/** (nx, ny) вне сетки ИЛИ символ соседа ≠ ch (ТЗ 03 §3, `out`). */
function isOut(map: CellChar[][], W: number, H: number, ch: string, nx: number, ny: number): boolean {
  return nx < 0 || ny < 0 || nx >= W || ny >= H || map[ny][nx] !== ch;
}

/**
 * Извлечение граничных рёбер (ТЗ 03 §3). Граница считается глобально по всем комнатам
 * с дедупликацией по ключу ребра: общее ребро двух соседних комнат даёт ОДНУ стену.
 * Порядок результата детерминирован: h-рёбра по (y, x), затем v-рёбра по (x, y).
 */
export function boundaryEdges(map: CellChar[][]): BoundaryEdge[] {
  const { W, H } = dims(map);
  if (W === 0) return [];
  const seenH = new Set<string>(); // ключ `${x},${y}`
  const seenV = new Set<string>();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ch = map[y][x];
      if (NON_ROOM_CHARS.has(ch)) continue;
      if (isOut(map, W, H, ch, x, y - 1)) seenH.add(`${x},${y}`); // верх
      if (isOut(map, W, H, ch, x, y + 1)) seenH.add(`${x},${y + 1}`); // низ
      if (isOut(map, W, H, ch, x - 1, y)) seenV.add(`${x},${y}`); // лево
      if (isOut(map, W, H, ch, x + 1, y)) seenV.add(`${x + 1},${y}`); // право
    }
  }
  const parseKey = (key: string): [number, number] => {
    const i = key.indexOf(',');
    return [Number(key.slice(0, i)), Number(key.slice(i + 1))];
  };
  const hEdges: BoundaryEdge[] = Array.from(seenH)
    .map(parseKey)
    .sort((a, b) => a[1] - b[1] || a[0] - b[0])
    .map(([x, y]): BoundaryEdge => ({ side: 'h', x, y }));
  const vEdges: BoundaryEdge[] = Array.from(seenV)
    .map(parseKey)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .map(([x, y]): BoundaryEdge => ({ side: 'v', x, y }));
  return hEdges.concat(vEdges);
}

/**
 * Склейка коллинеарных рёбер в максимальные прямолинейные прогоны (ТЗ 03 §4).
 * Прогон не прерывается на T-стыках: склеиваются все consecutive-рёбра по линии.
 * Порядок результата фиксирован: h-прогоны по (y, x0), затем v-прогоны по (x, y0)
 * (тот же порядок использует buildWallBoxes — ТЗ 03 §6.1).
 */
export function mergeSegments(edges: BoundaryEdge[]): WallSegment[] {
  const hByY = new Map<number, number[]>(); // y → отсортированные x
  const vByX = new Map<number, number[]>(); // x → отсортированные y
  for (const e of edges) {
    if (e.side === 'h') {
      const arr = hByY.get(e.y);
      if (arr) arr.push(e.x);
      else hByY.set(e.y, [e.x]);
    } else {
      const arr = vByX.get(e.x);
      if (arr) arr.push(e.y);
      else vByX.set(e.x, [e.y]);
    }
  }
  const mergeRun = (coords: number[]): Array<[number, number]> => {
    coords.sort((a, b) => a - b);
    const runs: Array<[number, number]> = []; // [start, endExclusive]
    for (const c of coords) {
      const last = runs[runs.length - 1];
      if (last && c === last[1]) last[1] += 1; // consecutive → продлеваем
      else runs.push([c, c + 1]);
    }
    return runs;
  };
  const hSegs: WallSegment[] = [];
  for (const [y, coords] of Array.from(hByY.entries()).sort((a, b) => a[0] - b[0])) {
    for (const [x0, x1] of mergeRun(coords)) {
      hSegs.push({ kind: 'h', x0, y0: y, len: x1 - x0 });
    }
  }
  const vSegs: WallSegment[] = [];
  for (const [x, coords] of Array.from(vByX.entries()).sort((a, b) => a[0] - b[0])) {
    for (const [y0, y1] of mergeRun(coords)) {
      vSegs.push({ kind: 'v', x0: x, y0, len: y1 - y0 });
    }
  }
  return hSegs.concat(vSegs);
}

/** Индексы span'ов прогонов для проверки перпендикуляров (ТЗ 03 §5.2). */
export function buildSpanIndex(segments: WallSegment[]): SpanIndex {
  const hByY = new Map<number, Array<[number, number]>>();
  const vByX = new Map<number, Array<[number, number]>>();
  for (const s of segments) {
    if (s.kind === 'h') {
      const arr = hByY.get(s.y0);
      if (arr) arr.push([s.x0, s.x0 + s.len]);
      else hByY.set(s.y0, [[s.x0, s.x0 + s.len]]);
    } else {
      const arr = vByX.get(s.x0);
      if (arr) arr.push([s.y0, s.y0 + s.len]);
      else vByX.set(s.x0, [[s.y0, s.y0 + s.len]]);
    }
  }
  return { hByY, vByX };
}

/**
 * Правило угловых стыков (ТЗ 03 §5.2): конец прогона `seg` с индексом `end`
 * (0 — начало, 1 — конец) имеет перпендикуляр через свою конечную точку?
 * h-прогон: точка (px, py) = (x0 или x0+len, y0); ищем v-span с x == px и
 * py ∈ [y0s, y0s+lenS] (включительно). Для v — симметрично.
 */
export function hasPerpendicularAt(seg: WallSegment, end: 0 | 1, idx: SpanIndex): boolean {
  if (seg.kind === 'h') {
    const px = end === 0 ? seg.x0 : seg.x0 + seg.len;
    const py = seg.y0;
    for (const [a, b] of idx.vByX.get(px) ?? []) {
      if (py >= a && py <= b) return true;
    }
    return false;
  }
  const px = seg.x0;
  const py = end === 0 ? seg.y0 : seg.y0 + seg.len;
  for (const [a, b] of idx.hByY.get(py) ?? []) {
    if (px >= a && px <= b) return true;
  }
  return false;
}

/**
 * Формулы боксов (ТЗ 03 §6). `e0`/`e1` — продолжения (мировые единицы) у начала
 * и конца прогона (T/2 при наличии перпендикуляра, иначе 0).
 */
export function segmentToBox(
  seg: WallSegment,
  W: number,
  H: number,
  p: WallParams,
  e0: number,
  e1: number,
): WallBox {
  const S = p.scale;
  if (seg.kind === 'h') {
    return {
      sx: seg.len * S + e0 + e1,
      sz: p.wallThickness,
      x: (seg.x0 + seg.len / 2 - W / 2) * S + (e1 - e0) / 2,
      z: (seg.y0 - H / 2) * S,
    };
  }
  return {
    sz: seg.len * S + e0 + e1,
    sx: p.wallThickness,
    z: (seg.y0 + seg.len / 2 - H / 2) * S + (e1 - e0) / 2,
    x: (seg.x0 - W / 2) * S,
  };
}

/**
 * Полный конвейер (ТЗ 03 §6): рёбра → прогоны → продолжения T/2 (§5.2) → боксы.
 * Порядок результата фиксирован: h-прогоны по (y, x0), затем v-прогоны по (x, y0).
 * Высота Hw не передаётся — Y-размер боксов в сцене = (sx, Hw, sz) с центром (x, Hw/2, z).
 */
export function buildWallBoxes(map: CellChar[][], p: WallParams): WallBox[] {
  const { W, H } = dims(map);
  if (W === 0) return [];
  const segments = mergeSegments(boundaryEdges(map));
  const idx = buildSpanIndex(segments);
  const e = p.wallThickness / 2;
  const out: WallBox[] = [];
  for (const seg of segments) {
    const e0 = hasPerpendicularAt(seg, 0, idx) ? e : 0;
    const e1 = hasPerpendicularAt(seg, 1, idx) ? e : 0;
    out.push(segmentToBox(seg, W, H, p, e0, e1));
  }
  return out;
}

/**
 * Инвариант покрытия границ (ТЗ 03 §7): каждое единичное ребро границы каждой
 * комнаты (без дедупликации по комнатам) должно лежать в XZ-проекции ОДНОГО бокса
 * (прямоугольник выпуклый → достаточно, что оба конца единичного сегмента внутри
 * одного и того же бокса; точность 1e-9). `scale` — масштаб S, которым строились
 * боксы (дефолт 1 — тесты ТЗ 05 §3/§5 считают при S=1).
 */
export function assertBoundaryCovered(
  map: CellChar[][],
  boxes: WallBox[],
  scale: number = 1,
): boolean {
  const { W, H } = dims(map);
  if (W === 0) return true;
  const EPS = 1e-9;
  const inBox = (gx: number, gy: number, b: WallBox): boolean => {
    const X = (gx - W / 2) * scale;
    const Z = (gy - H / 2) * scale;
    return (
      X >= b.x - b.sx / 2 - EPS &&
      X <= b.x + b.sx / 2 + EPS &&
      Z >= b.z - b.sz / 2 - EPS &&
      Z <= b.z + b.sz / 2 + EPS
    );
  };
  // Единичный сегмент покрыт, если существует ОДИН бокс, содержащий оба его конца.
  const segCovered = (ax: number, ay: number, bx: number, by: number): boolean => {
    for (const b of boxes) {
      if (inBox(ax, ay, b) && inBox(bx, by, b)) return true;
    }
    return false;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ch = map[y][x];
      if (NON_ROOM_CHARS.has(ch)) continue;
      // верх: h(x, y) — от (x, y) до (x+1, y)
      if (isOut(map, W, H, ch, x, y - 1) && !segCovered(x, y, x + 1, y)) return false;
      // низ: h(x, y+1)
      if (isOut(map, W, H, ch, x, y + 1) && !segCovered(x, y + 1, x + 1, y + 1)) return false;
      // лево: v(x, y) — от (x, y) до (x, y+1)
      if (isOut(map, W, H, ch, x - 1, y) && !segCovered(x, y, x, y + 1)) return false;
      // право: v(x+1, y)
      if (isOut(map, W, H, ch, x + 1, y) && !segCovered(x + 1, y, x + 1, y + 1)) return false;
    }
  }
  return true;
}
