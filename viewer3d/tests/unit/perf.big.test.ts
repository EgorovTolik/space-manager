// NFR (ТЗ 05 §7): производительность на сетке 200×200.
// Фикстура report_big_200x200.txt — сгенерирована один раз CLI spaec_manager по
// временной спекации ТЗ 05 §6 п.12 (4 типа × 25%, seed 1) и закоммичена:
// пере-генерация в тесте заняла бы ~70 с и только замедляла бы прогон.
// Пороги: parseReport ≤ 50 мс, buildWallBoxes ≤ 100 мс (минимум из 3 замеров —
// защита от шума CI; warmup-замер не учитывается).

import { test, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as perf_hooks from 'node:perf_hooks';
import { parseReport } from '../../src/lib/reportParser';
import { buildWallBoxes } from '../../src/lib/walls';

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'report_big_200x200.txt');

function minOfRuns(fn: () => void, runs = 3): number {
  fn(); // warmup (JIT/кэш) — не учитывается
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < runs; i++) {
    const t0 = perf_hooks.performance.now();
    fn();
    best = Math.min(best, perf_hooks.performance.now() - t0);
  }
  return best;
}

test('200×200: parseReport ≤ 50 мс', () => {
  const text = fs.readFileSync(FIXTURE, 'utf8');
  const elapsedMs = minOfRuns(() => {
    const report = parseReport(text);
    expect(report.width).toBe(200);
    expect(report.height).toBe(200);
  });
  expect(elapsedMs, `parseReport занял ${elapsedMs.toFixed(1)} мс`).toBeLessThanOrEqual(50);
});

test('200×200: buildWallBoxes ≤ 100 мс', () => {
  const text = fs.readFileSync(FIXTURE, 'utf8');
  const report = parseReport(text);
  const elapsedMs = minOfRuns(() => {
    const boxes = buildWallBoxes(report.map, { scale: 1, wallThickness: 0.25 });
    expect(boxes.length).toBeGreaterThan(0);
  });
  expect(elapsedMs, `buildWallBoxes занял ${elapsedMs.toFixed(1)} мс`).toBeLessThanOrEqual(100);
});
