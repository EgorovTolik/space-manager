// Unit-тесты движка геометрии стен (ТЗ 05 §3, кейсы G1–G9; ТЗ 03).
// Все ожидаемые значения посчитаны вручную по формулам ТЗ 03 §6 и эталонному
// примеру §6.1. Сравнение с точностью 1e-9.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  boundaryEdges,
  mergeSegments,
  buildWallBoxes,
  buildSpanIndex,
  hasPerpendicularAt,
  segmentToBox,
  assertBoundaryCovered,
} from '../../src/lib/walls';
import type { WallBox, WallParams, WallSegment } from '../../src/lib/walls';
import type { CellChar } from '../../src/lib/reportParser';
import { parseReport } from '../../src/lib/reportParser';

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8');
}

/** Строки карты → CellChar[][] в семантике код-поинтов (как парсер). */
function grid(lines: string[]): CellChar[][] {
  return lines.map((l) => Array.from(l));
}

const P50: WallParams = { scale: 1, wallThickness: 0.5 }; // эталон ТЗ 03 §6.1

function expectBoxes(got: WallBox[], expected: Array<[number, number, number, number]>, label: string): void {
  expect(got, label).toHaveLength(expected.length);
  got.forEach((b, i) => {
    const [x, z, sx, sz] = expected[i];
    expect(b.x, `${label}[${i}].x`).toBeCloseTo(x, 9);
    expect(b.z, `${label}[${i}].z`).toBeCloseTo(z, 9);
    expect(b.sx, `${label}[${i}].sx`).toBeCloseTo(sx, 9);
    expect(b.sz, `${label}[${i}].sz`).toBeCloseTo(sz, 9);
  });
}

// Эталонная сетка 4×3 (ТЗ 03 §6.1).
const REF_MAP = grid(['AABB', 'A.CC', 'DDCC']);

describe('walls: кейсы ТЗ 05 §3', () => {
  it('G1: эталон 4×3, S=1, T=0.5 — боксы из ТЗ 03 §6.1 (порядок h по y,x; v по x,y0)', () => {
    // Кросс-проверка шагов конвейера: уникальных рёбер = 23 (ТЗ 03 §6.1 шаг 1 ✓).
    expect(boundaryEdges(REF_MAP)).toHaveLength(23);
    // НЕТОЧНОСТЬ ТЗ (зафиксировано, реализация следует алгоритму): таблица §6.1 разбивает
    // линию gy=1 на H2 {x0=1,len=1} («низ A над (1,1)») и H3 {x0=2,len=2} («граница B|C»),
    // но рёбра h(1,1), h(2,1), h(3,1) лежат consecutive на одной линии — по правилу склейки
    // ТЗ 03 §4 они ОБЯЗАНЫ слиться в один прогон {x0=1, y=1, len=3}. Отсюда прогонов/боксов
    // ровно 8 (не 9); объединение боксов H2∪H3 из таблицы геометрически идентично одному
    // склеенному боксу (та же полоса X∈[−1.25, 2.25], Z=−0.5±0.25).
    expect(mergeSegments(boundaryEdges(REF_MAP))).toHaveLength(8);

    const boxes = buildWallBoxes(REF_MAP, P50);
    // Порядок: h-прогоны по (y,x), затем v-прогоны по (x,y0).
    expectBoxes(boxes, [
      [0, -1.5, 4.5, 0.5],     // H1: верхний периметр A+B
      [0.5, -0.5, 3.5, 0.5],   // H2+H3 (склеены по §4): низ A над (1,1) + граница B|C
      [-1, 0.5, 2.5, 0.5],     // H4: граница A|D + верх D над (1,1)
      [0, 1.5, 4.5, 0.5],      // H5: нижний периметр D+C (сквозь T-стык с V2)
      [-2, 0, 0.5, 3.5],       // V1: левый периметр
      [-1, 0, 0.5, 1.5],       // V2: вертикаль A над (1,1)
      [0, 0, 0.5, 3.5],        // V3: граница A/B → C → C/D
      [2, 0, 0.5, 3.5],        // V4: правый периметр
    ], 'G1');
  });

  it('G2: эталон, S=2, T=0.5 — координаты ×2, размеры по формуле (продолжения остаются 0.25 в мировых ед.)', () => {
    // Примечание к формулировке ТЗ G2 («все XZ ×2»): центры x,z масштабируются ×2,
    // но sx/sz = len·S + e0 + e1, где продолжения e = T/2 — МИРОВЫЕ величины и с S не
    // масштабируются (ТЗ 03 §5.2: «продолжается на T/2 (мировых единиц)»). Поэтому
    // sx/sz проверяются по формуле, а не как G1×2.
    const boxes = buildWallBoxes(REF_MAP, { scale: 2, wallThickness: 0.5 });
    expectBoxes(boxes, [
      [0, -3, 8.5, 0.5],     // H1: x=(0+2−2)·2=0; z=(0−1.5)·2=−3; sx=4·2+0.5
      [1, -1, 6.5, 0.5],     // H2+H3 (склеены): x=(1+1.5−2)·2=1; sx=3·2+0.5
      [-2, 1, 4.5, 0.5],     // H4
      [0, 3, 8.5, 0.5],      // H5
      [-4, 0, 0.5, 6.5],     // V1: sz=3·2+0.5
      [-2, 0, 0.5, 2.5],     // V2
      [0, 0, 0.5, 6.5],      // V3
      [4, 0, 0.5, 6.5],      // V4
    ], 'G2');
  });

  it('G3: дедупликация — сетка 2×2 из четырёх комнат AABB/CCDD: на каждой общей линии ровно один бокс, всего 6', () => {
    const map = grid(['AABB', 'CCDD']); // W=4, H=2: A={(0,0),(1,0)}, B={(2,0),(3,0)}, C={(0,1),(1,1)}, D={(2,1),(3,1)};
    // общие границы: h(0,1)+h(1,1) (A|C), h(2,1)+h(3,1) (B|D), v(2,0) (A|B), v(2,1) (C|D)
    const boxes = buildWallBoxes(map, P50);
    // Вручную (W=4, H=2, S=1, T=0.5, e=0.25; W/2=2, H/2=1): периметр объединения
    // (весь 4×2) = 4 прогона (верх y=0 len4, низ y=2 len4, лево x=0 len2, право x=4 len2)
    // + 2 внутренних стыка (горизонтальная линия y=1 и вертикальная x=2) → всего 6 боксов.
    // Каждое общее ребро соседних комнат даёт ОДИН бокс (дедупликация ТЗ 03 §3),
    // а consecutive-общие рёбра сливаются в один прогон (ТЗ 03 §4).
    expectBoxes(boxes, [
      [0, -1, 4.5, 0.5],   // h y=0 — верхний периметр: sx=4+0.5
      [0, 0, 4.5, 0.5],    // h y=1 — ОБЩИЙ стык A|C + B|D (ровно один бокс)
      [0, 1, 4.5, 0.5],    // h y=2 — нижний периметр
      [-2, 0, 0.5, 2.5],   // v x=0 — левый периметр: sz=2+0.5
      [0, 0, 0.5, 2.5],    // v x=2 — ОБЩИЙ стык A|B + C|D (ровно один бокс)
      [2, 0, 0.5, 2.5],    // v x=4 — правый периметр
    ], 'G3');
    const sharedH = boxes.filter((b) => Math.abs(b.z) < 1e-9 && b.sx > b.sz);
    expect(sharedH).toHaveLength(1); // горизонтальная общая линия — один бокс
    const sharedV = boxes.filter((b) => Math.abs(b.x) < 1e-9 && b.sz > b.sx);
    expect(sharedV).toHaveLength(1); // вертикальная общая линия — один бокс
  });

  it('G4: комната 1×3 в углу сетки 3×3 — у обоих концов всех 4 прогонов есть перпендикуляр', () => {
    const map = grid(['AAA', '...', '...']); // A={(0,0),(1,0),(2,0)}
    const segs = mergeSegments(boundaryEdges(map));
    expect(segs.map((s) => `${s.kind}:${s.x0},${s.y0},len=${s.len}`)).toEqual([
      'h:0,0,len=3', // верх
      'h:0,1,len=3', // низ (над '.')
      'v:0,0,len=1', // лево
      'v:3,0,len=1', // право
    ]);
    const idx = buildSpanIndex(segs);
    for (const seg of segs) {
      expect(hasPerpendicularAt(seg, 0, idx), `начало ${seg.kind}@${seg.x0},${seg.y0}`).toBe(true);
      expect(hasPerpendicularAt(seg, 1, idx), `конец ${seg.kind}@${seg.x0},${seg.y0}`).toBe(true);
    }
    // Следствие: e0 = e1 = T/2 у всех прогонов (проверка через боксы; W=3, H=3 → H/2=1.5).
    const boxes = buildWallBoxes(map, P50);
    expectBoxes(boxes, [
      [0, -1.5, 3.5, 0.5],    // h y=0: z=(0−1.5)=−1.5; sx=3+0.5
      [0, -0.5, 3.5, 0.5],    // h y=1: z=(1−1.5)=−0.5
      [-1.5, -1, 0.5, 1.5],   // v x=0: z=(0+0.5−1.5)=−1; sz=1+0.5
      [1.5, -1, 0.5, 1.5],    // v x=3
    ], 'G4');
  });

  it('G5: защитная ветка — конец без перпендикуляра: hasPerpendicularAt=false, бокс без наращивания', () => {
    const seg: WallSegment = { kind: 'h', x0: 0, y0: 0, len: 2 };
    const idx = buildSpanIndex([seg]); // только сам прогон — перпендикуляров нет
    expect(hasPerpendicularAt(seg, 0, idx)).toBe(false);
    expect(hasPerpendicularAt(seg, 1, idx)).toBe(false);
    // segmentToBox с e0=e1=0: без наращивания (W=4, H=4 → W/2=H/2=2; S=1, T=0.5):
    // x=(0+1−2)·1=−1; z=(0−2)·1=−2; sx=len·S=2.
    const box = segmentToBox(seg, 4, 4, P50, 0, 0);
    expect([box.x, box.z, box.sx, box.sz]).toEqual([-1, -2, 2, 0.5]);
    // И то же с продолжениями (контроль формулы §6: sx += e0+e1 = 0.5):
    const ext = segmentToBox(seg, 4, 4, P50, 0.25, 0.25);
    expect(ext.sx).toBeCloseTo(2.5, 9);
    expect([ext.x, ext.z, ext.sz]).toEqual([-1, -2, 0.5]);
  });

  it('G6: инвариант покрытия — true для эталона G1 и реальных фикстур report_basic/report_minimal', () => {
    expect(assertBoundaryCovered(REF_MAP, buildWallBoxes(REF_MAP, P50))).toBe(true);
    for (const name of ['report_basic.txt', 'report_minimal.txt']) {
      const r = parseReport(fixture(name));
      const boxes = buildWallBoxes(r.map, { scale: 1, wallThickness: 0.25 });
      expect(assertBoundaryCovered(r.map, boxes), name).toBe(true);
    }
  });

  it('G7: отрицательный — удаление бокса H2(=H2+H3 из ТЗ) из G1 нарушает инвариант', () => {
    const boxes = buildWallBoxes(REF_MAP, P50);
    // Бокс №2 (индекс 1): склеенный прогон линии gy=1 — «низ A над свободной клеткой
    // (1,1)» + граница B|C (в таблице ТЗ §6.1 это H2+H3).
    const reduced = boxes.filter((_, i) => i !== 1);
    expect(reduced).toHaveLength(7);
    // Кромка h(1,1): левый конец прикрывает V2, правый — V3, но НИ ОДИН бокс не
    // содержит оба конца сегмента → зазор в середине → инвариант false.
    expect(assertBoundaryCovered(REF_MAP, reduced)).toBe(false);
  });

  it('G8: пустая карта (все .) — 0 боксов, без исключений', () => {
    const map = grid(['...', '...', '...']);
    expect(boundaryEdges(map)).toEqual([]);
    expect(buildWallBoxes(map, P50)).toEqual([]);
    expect(assertBoundaryCovered(map, [])).toBe(true); // тривиально: границ нет
  });

  it('G9: комната-полоса 1×7 (N=7) в середине сетки — 2 h len=7 + 2 v len=1', () => {
    const map = grid(['.......', 'AAAAAAA', '.......']); // W=7, H=3; полоса y=1
    const segs = mergeSegments(boundaryEdges(map));
    expect(segs.map((s) => `${s.kind}:${s.x0},${s.y0},len=${s.len}`)).toEqual([
      'h:0,1,len=7', // верх полосы
      'h:0,2,len=7', // низ полосы
      'v:0,1,len=1', // левый торец
      'v:7,1,len=1', // правый торец
    ]);
    // Вручную (S=1, T=0.5, e=0.25; оба конца каждого прогона — углы контура):
    const boxes = buildWallBoxes(map, P50);
    expectBoxes(boxes, [
      [0, -0.5, 7.5, 0.5],   // h y=1: x=(0+3.5−3.5)=0; z=(1−1.5)=−0.5; sx=7+0.5
      [0, 0.5, 7.5, 0.5],    // h y=2
      [-3.5, 0, 0.5, 1.5],   // v x=0: z=(1+0.5−1.5)=0; sz=1+0.5
      [3.5, 0, 0.5, 1.5],    // v x=7
    ], 'G9');
  });

  it('NFR (ТЗ 03 §10): генерация стен на реальном отчёте 50×50 < 100 мс', () => {
    const r = parseReport(fixture('report_basic.txt'));
    const t0 = Date.now();
    const boxes = buildWallBoxes(r.map, { scale: 1, wallThickness: 0.25 });
    const ms = Date.now() - t0;
    expect(boxes.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(100);
  });
});
