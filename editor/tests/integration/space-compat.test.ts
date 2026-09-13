// Сквозной тест совместимости (ТЗ 06 §3.3 — КЛЮЧЕВОЙ): файлы, сгенерированные
// редактором (parseSpec/dumpSpec + parse*/dumpMask), принимаются эталонной системой
// `python -m space_manager place <spec>`: валидный результат → exit 0 и карта в stdout;
// каждый fixtures/bad-specs/*.yaml (двойники кодов V-*, ТЗ 05 §4) → exit 2.
//
// Python берётся из env SPAEC_PYTHON или ../.venv/bin/python относительно editor/.
// Если окружение недоступно — тест пропускается с сообщением (ТЗ 06 §3.3: «маркируется
// @integration и прогоняется при ручной приёмке»).
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseSpec, dumpSpec } from '../../src/lib/specYaml';
import { parseBlockedMaskAny, parsePresetMaskAny, dumpMask } from '../../src/lib/maskText';

const testRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..'); // editor/tests/
const projectRoot = resolve(testRoot, '..', '..'); // корень проекта space-manager/

function pythonBin(): string | null {
  const fromEnv = process.env.SPACE_PYTHON;
  if (fromEnv) return existsSync(fromEnv) ? fromEnv : null;
  const venv = join(projectRoot, '.venv', 'bin', 'python');
  return existsSync(venv) ? venv : null;
}

// execFile: при нормальном завершении с ненулевым кодом error.code === exit code;
// при spawn-ошибке/таймауте код ставится -1.
function runPlace(python: string, specPath: string, cwd: string): Promise<{ code: number; out: string; err: string }> {
  return new Promise((res) => {
    execFile(
      python,
      ['-m', 'space_manager', 'place', specPath],
      { cwd, timeout: 60_000 },
      (error, out, stderr) => {
        const code = error ? Number((error as { code?: unknown }).code ?? -1) : 0;
        res({ code, out: String(out), err: String(stderr) });
      },
    );
  });
}

const SPEC_BASIC = readFileSync(join(projectRoot, 'examples', 'spec_basic.yaml'), 'utf8');
const BLOCKED_BASIC = readFileSync(join(projectRoot, 'examples', 'blocked_basic.txt'), 'utf8');
const PRESET_EXAMPLE = readFileSync(join(projectRoot, 'examples', 'preset_example.txt'), 'utf8');

// Инлайн-спекация 10×10 под размер эталонных масок examples (spec_basic.yaml — 50×50).
const SPEC_10X10 = `grid:
  width: 10
  height: 10

blockedFile: blocked_basic.txt
presetFile: preset_example.txt

types:
  A: { symbol: "A", name: null }
  B: { symbol: "B", name: null }

rules:
  connectivity: 8
  adjacency:
    forbidden: []
    allow: null
  size:
    min: null
    max: null
  convexity:
    weight: soft
  fillAll: false
  touchAll: false

clusters:
  - id: a1
    type: A
    areaPercent: 40
    shape: free
  - id: b1
    type: B
    areaPercent: 30
    shape: free
`;

const python = pythonBin();
describe.runIf(Boolean(python))('Сквозная совместимость со space_manager (ТЗ 06 §3.3)', () => {
  let dir: string;

  it('round-trip spec_basic.yaml через редактор → place → exit 0, карта в stdout', async () => {
    dir = mkdtempSync(join(tmpdir(), 'space-e2e-'));
    const text = dumpSpec(parseSpec(SPEC_BASIC)); // редактор: чтение + сериализация
    const p = join(dir, 'spec_basic.yaml');
    writeFileSync(p, text);
    const r = await runPlace(python!, p, dir);
    expect(r.code, `stdout:\n${r.out}\nstderr:\n${r.err}`).toBe(0);
    expect(r.out).toContain('КАРТА');
    expect(r.out).toContain('ТАБЛИЦА');
  });

  it('10×10 спекация + маски через редактор (побайтовый dump) → place → exit 0', async () => {
    dir = mkdtempSync(join(tmpdir(), 'space-e2e-'));
    writeFileSync(join(dir, 'spec.yaml'), dumpSpec(parseSpec(SPEC_10X10)));
    // Маски: редактор читает и пересобирает канонически — эталоны round-trip'ятся побайтово.
    const blocked = parseBlockedMaskAny(BLOCKED_BASIC);
    writeFileSync(join(dir, 'blocked_basic.txt'), dumpMask(blocked));
    expect(dumpMask(blocked)).toBe(BLOCKED_BASIC); // гарантия: файл скачан без искажений
    const preset = parsePresetMaskAny(PRESET_EXAMPLE, ['A', 'B']);
    writeFileSync(join(dir, 'preset_example.txt'), dumpMask(preset.mask));
    expect(dumpMask(preset.mask)).toBe(PRESET_EXAMPLE);
    const r = await runPlace(python!, join(dir, 'spec.yaml'), dir);
    expect(r.code, `stdout:\n${r.out}\nstderr:\n${r.err}`).toBe(0);
    expect(r.out).toContain('КАРТА');
  });

  it.each(readdirSync(join(testRoot, 'fixtures', 'bad-specs')).filter((f) => f.endsWith('.yaml')))(
    'битая спекация fixtures/bad-specs/%s (двойник кода V-*) → exit 2',
    async (name) => {
      dir = mkdtempSync(join(tmpdir(), 'space-e2e-'));
      const src = readFileSync(join(testRoot, 'fixtures', 'bad-specs', name), 'utf8');
      const p = join(dir, name);
      writeFileSync(p, src);
      const r = await runPlace(python!, p, dir);
      expect(r.code, `stderr:\n${r.err}`).toBe(2);
      expect(r.err.length).toBeGreaterThan(0); // причина ошибки в stderr (docs/06 §7)
    },
  );
});

describe('Сквозная совместимость: окружение Python недоступно', () => {
  it.skipIf(Boolean(python))(
    'пропуск: ../.venv/bin/python не найден (задайте SPAEC_PYTHON для ручной приёмки)',
    () => {
      expect(true).toBe(true);
    },
  );
});
