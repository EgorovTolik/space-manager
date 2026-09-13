// Критический сквозной тест (ТЗ 05 §5): любой отчёт, который реально генерирует
// система размещения, viewer3d понимает и окружает стенами полностью.
// Если .venv в корне репозитория нет — прогоняем по закоммиченной фикстуре
// report_basic.txt (режим skip-с-пометкой, паттерн интеграционных тестов editor/).

import { describe, test, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseReport, ReportParseError } from '../../src/lib/reportParser';
import { buildWallBoxes, assertBoundaryCovered } from '../../src/lib/walls';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const VENV_PYTHON = path.join(REPO_ROOT, '.venv', 'bin', 'python');
const SPEC_FILE = path.join(REPO_ROOT, 'examples', 'spec_basic.yaml');
const COMMITTED_FIXTURE = path.join(__dirname, '..', 'fixtures', 'report_basic.txt');

/** Значения зафиксированы проверкой 2026-09-13 (ТЗ 05 §5); при смене поведения
 *  солвера тест обновляется осознанно, а не «как получится». */
const EXPECTED_ROOMS = [
  { label: 'room1', typeId: 'ROOM1', size: 650 },
  { label: 'room2', typeId: 'ROOM2', size: 375 },
  { label: 'corridor1', typeId: 'CORRIDOR', size: 225 },
];

function assertReportContent(text: string): void {
  let report;
  try {
    report = parseReport(text);
  } catch (e) {
    if (e instanceof ReportParseError) throw new Error(`ошибки парсинга: ${e.issues.map((i) => i.code).join(', ')}`);
    throw e;
  }
  expect(report.width).toBe(50);
  expect(report.height).toBe(50);
  expect(report.infeasible).toBe(false);

  const actual = report.rooms.map((r) => ({ label: r.label, typeId: r.typeId, size: r.size }));
  expect(actual.sort((a, b) => a.label.localeCompare(b.label))).toEqual(
    [...EXPECTED_ROOMS].sort((a, b) => a.label.localeCompare(b.label)),
  );

  // Стены полностью покрывают границы всех комнат (ТЗ 03 §7).
  const boxes = buildWallBoxes(report.map, { scale: 1, wallThickness: 0.25 });
  expect(assertBoundaryCovered(report.map, boxes, 1)).toBe(true);
}

const hasVenv = fs.existsSync(VENV_PYTHON);

describe('сквозной тест совместимости с CLI', () => {
  // skip-с-пометкой (ТЗ 05 §5): без venv свежая генерация невозможна — берём фикстуру.
  const freshTest = hasVenv ? test : test.skip;
  freshTest('свежесгенерированный отчёт space_manager отображается корректно', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'space-viewer3d-'));
    const out = path.join(tmp, 'fresh.txt');
    try {
      execFileSync(
        VENV_PYTHON,
        ['-m', 'space_manager', 'place', SPEC_FILE, '--seed', '7', '--out', out],
        { cwd: REPO_ROOT, timeout: 120_000, stdio: 'pipe' },
      );
      assertReportContent(fs.readFileSync(out, 'utf8'));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('закоммиченная фикстура report_basic.txt (fallback без venv)', () => {
    assertReportContent(fs.readFileSync(COMMITTED_FIXTURE, 'utf8'));
  });
});
