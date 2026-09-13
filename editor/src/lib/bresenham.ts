// Чистая функция алгоритма Брезенхэма для инструмента «Линия» (ST-2): целочисленная
// линия между двумя клетками сетки, ОБА КОНЦА включительно. Горизонтальные,
// вертикальные и диагональные линии обрабатываются одинаково (классический
// алгоритм без спецкейсов), порядок точек — от (x0,y0) к (x1,y1).

/** Клетки линии Брезенхэма между (x0,y0) и (x1,y1) включительно, от старта к концу. */
export function bresenham(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const points: [number, number][] = [];
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    points.push([x, y]);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return points;
}
