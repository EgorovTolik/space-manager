// Unit-тесты LST-7: инструменты создания масок (чистые валидации, имена файлов),
// оверрайды масок в run_generation и временной копии спеки, детектор стагнации.
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import yaml from 'js-yaml';

import {
  checkBlockagesContent,
  checkGenerationArgs,
  checkLlmMaskName,
  checkPresetContent,
  LLM_BLOCKAGES_FILE_RE,
  LLM_PRESET_FILE_RE,
  makeTempSpecCopy,
} from '../../server/llm/actions.js';
import { parseSpec } from '../../server/llm/specInfo.js';
import {
  canonicalJson,
  createStagnationDetector,
  STAGNATION_LIMIT,
  stagnationHash,
} from '../../server/llm/stagnation.js';

const SPEC_NO_BLOCKED = [
  'grid:',
  '  width: 4',
  '  height: 3',
  'presetFile: preset.txt',
  'types:',
  '  ROOM: { symbol: "R", name: Комната }',
  '  CORRIDOR: { symbol: "C", name: Коридор }',
  'clusters:',
  '  - id: room1',
  '    type: ROOM',
  '    areaPercent: 50',
  '    shape: free',
  '',
].join('\n');

const SPEC_WITH_BLOCKED = SPEC_NO_BLOCKED.replace('presetFile: preset.txt', 'blockedFile: blocked.txt\npresetFile: preset.txt');

const NO_BLOCKED = parseSpec(SPEC_NO_BLOCKED); // W=4, H=3
const WITH_BLOCKED = parseSpec(SPEC_WITH_BLOCKED);

// ---------------------------------------------------------------------------
// Имена LLM-масок (регламенты)
// ---------------------------------------------------------------------------

describe('имена LLM-масок: blocked-llm-* / preset-llm-*', () => {
  it('валидные имена проходят по своему виду', () => {
    expect(checkLlmMaskName('blocked-llm-20260913-200232.txt', 'blockages')).toBe('blocked-llm-20260913-200232.txt');
    expect(checkLlmMaskName('blocked-llm-20260913-200232-1.txt', 'blockages')).toBe('blocked-llm-20260913-200232-1.txt');
    expect(checkLlmMaskName('preset-llm-20260913-200232.txt', 'preset')).toBe('preset-llm-20260913-200232.txt');
    expect(LLM_BLOCKAGES_FILE_RE.test('blocked-llm-20260913-200232-2.txt')).toBe(true);
    expect(LLM_PRESET_FILE_RE.test('preset-llm-20260913-200232-2.txt')).toBe(true);
  });

  it('чужие/неправильные имена отвергаются', () => {
    for (const name of [
      'blocked.txt', // маска пользователя
      'preset.txt',
      'result-20260913-200232.txt',
      'blocked-llm-2026-01-01.txt',
      'blocked_llm-20260913-200232.txt',
      'BLOCKED-LLM-20260913-200232.TXT',
      '../blocked-llm-20260913-200232.txt',
      'blocked-llm-20260913-200232.txt/../../etc/passwd',
      '',
      null,
      42,
    ]) {
      expect(checkLlmMaskName(name, 'blockages')).toBeNull();
      expect(checkLlmMaskName(name, 'preset')).toBeNull();
    }
    // Крест-проверка: blocked-имя не проходит как preset и наоборот.
    expect(checkLlmMaskName('blocked-llm-20260913-200232.txt', 'preset')).toBeNull();
    expect(checkLlmMaskName('preset-llm-20260913-200232.txt', 'blockages')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Валидация содержимого масок (чистые функции)
// ---------------------------------------------------------------------------

describe('checkBlockagesContent — размер W×H, «*» = заблокировано', () => {
  it('корректная маска 4×3 проходит и даёт grid', () => {
    const res = checkBlockagesContent('..**\n....\n****', NO_BLOCKED);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.grid).toEqual(['..**', '....', '****'].map((l) => [...l]));
  });

  it('размер не сходится — ошибка с указанием размера', () => {
    for (const content of ['....\n....\n....\n....', // строк 4 вместо 3
      '..*\n...\n...']) { // строки короче width
      const res = checkBlockagesContent(content, NO_BLOCKED);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toContain('4×3');
    }
  });

  it('пустая строка — ошибка по content', () => {
    const res = checkBlockagesContent('', NO_BLOCKED);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('content');
  });

  it('не-строка — ошибка', () => {
    for (const content of [null, 7, ['..**']]) {
      const res = checkBlockagesContent(content, NO_BLOCKED);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toContain('content');
    }
  });
});

describe('checkPresetContent — размер + СТРОГИЕ символы (только «.» и типы)', () => {
  it('«.» + символы типов проходят', () => {
    const res = checkPresetContent('RRC.\n..CC\n....', NO_BLOCKED);
    expect(res.ok).toBe(true);
  });

  it('«*» — недопустимый символ пресета (с координатой)', () => {
    const res = checkPresetContent('.*..\n....\n....', NO_BLOCKED);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('«*»');
      expect(res.error).toContain('(x=1, y=0)');
    }
  });

  it('чужой символ — ошибка со списком допустимых', () => {
    const res = checkPresetContent('.X..\n....\n....', NO_BLOCKED);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('«X»');
      expect(res.error).toContain('R');
      expect(res.error).toContain('C');
    }
  });

  it('размер не сходится — ошибка до проверки символов', () => {
    const res = checkPresetContent('RR\n..', NO_BLOCKED);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('4×3');
  });
});

// ---------------------------------------------------------------------------
// checkGenerationArgs с blockagesFile / presetsFile (LST-7)
// ---------------------------------------------------------------------------

describe('checkGenerationArgs + mask-оверрайды', () => {
  const F = 12; // 4×3 без блокировок

  it('blockagesFile: валидное имя проходит (spec.blockedFile === null)', () => {
    const res = checkGenerationArgs({ blockagesFile: 'blocked-llm-20260913-200232.txt' }, NO_BLOCKED, F, new Set(['blocked-llm-20260913-200232.txt']));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.args.blockagesFile).toBe('blocked-llm-20260913-200232.txt');
  });

  it('presetsFile: валидное имя проходит ВСЕГДА (даже если у пользователя есть preset)', () => {
    const res = checkGenerationArgs({ presetsFile: 'preset-llm-20260913-200232.txt' }, NO_BLOCKED, F, new Set(['preset-llm-20260913-200232.txt']));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.args.presetsFile).toBe('preset-llm-20260913-200232.txt');
  });

  it('оба mask-оверрайда вместе + areaPercent — проходят', () => {
    const names = new Set(['blocked-llm-20260913-200232.txt', 'preset-llm-20260913-200232.txt']);
    const res = checkGenerationArgs(
      { blockagesFile: 'blocked-llm-20260913-200232.txt', presetsFile: 'preset-llm-20260913-200232.txt', areaPercent: { room1: 50 }, seed: 1 },
      NO_BLOCKED,
      F,
      names,
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.args.blockagesFile).toBe('blocked-llm-20260913-200232.txt');
      expect(res.args.presetsFile).toBe('preset-llm-20260913-200232.txt');
      expect(res.args.areaPercent).toEqual({ room1: 50 });
    }
  });

  it('spec.blockedFile !== null → blockagesFile запрещён', () => {
    const res = checkGenerationArgs({ blockagesFile: 'blocked-llm-20260913-200232.txt' }, WITH_BLOCKED, F);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('уже есть маска блокировок');
      expect(res.error).toContain('blocked.txt');
    }
  });

  it('чужие имена масок (вне LLM-регламента) — ошибка', () => {
    for (const [key, name] of [['blockagesFile', 'blocked.txt'], ['presetsFile', 'preset.txt'], ['blockagesFile', 'result-20260913-200232.txt']] as const) {
      const res = checkGenerationArgs({ [key]: name }, NO_BLOCKED, F);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toContain(key);
    }
  });

  it('файл не существует в проекте (maskFileNames передан) — ошибка', () => {
    const res = checkGenerationArgs(
      { blockagesFile: 'blocked-llm-20260913-200232.txt' },
      NO_BLOCKED,
      F,
      new Set(['preset-llm-20260913-200232.txt']), // в каталоге только пресет
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('не найден в каталоге проекта');
  });

  it('areaPercent проверяется на переданную базу F (пересчёт по новой маске)', () => {
    // room1 (50%): при F=12 target=6, допуск ±10% → только 6 клеток; 30% (=round(3.6)=4) вне допуска.
    // Контроль: F=20 → target=10, допуск ±1 → 45% (=9) в допуске.
    const res = checkGenerationArgs({ areaPercent: { room1: 30 } }, NO_BLOCKED, 12);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('room1');
    const okRes = checkGenerationArgs({ areaPercent: { room1: 45 } }, NO_BLOCKED, 20);
    expect(okRes.ok).toBe(true);
  });

  it('пустые args → {} (назад-совместимость)', () => {
    const res = checkGenerationArgs({}, NO_BLOCKED, F);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.args).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// makeTempSpecCopy с оверрайдами масок (LST-7)
// ---------------------------------------------------------------------------

describe('makeTempSpecCopy — areaPercent + маски', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'llm-tmpspec-'));
  });
  afterEach(async () => {
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  it('без оверрайдов масок: пути резолвятся в абсолютные к файлам проекта', async () => {
    const specText = [
      'grid:',
      '  width: 2',
      '  height: 2',
      'blockedFile: blocked.txt',
      'presetFile: preset.txt',
      'clusters:',
      '  - id: room1',
      '    type: ROOM',
      '    areaPercent: 100',
      '',
    ].join('\n');
    const { tempDir, specPath } = await makeTempSpecCopy(tmp, specText, {});
    try {
      const doc = yaml.load(await fsp.readFile(specPath, 'utf8')) as Record<string, string>;
      expect(doc.blockedFile).toBe(path.resolve(tmp, 'blocked.txt'));
      expect(doc.presetFile).toBe(path.resolve(tmp, 'preset.txt'));
    } finally {
      await fsp.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('оверрайды маски + areaPercent подставляются; оригинал спеки не трогается', async () => {
    const specText = SPEC_NO_BLOCKED; // blockedFile отсутствует, presetFile есть
    const before = await fsp.readFile(path.join(tmp, 'spec.yaml'), 'utf8').catch(() => null);
    const llmBlocked = path.join(tmp, 'blocked-llm-20260913-200232.txt');
    const llmPreset = path.join(tmp, 'preset-llm-20260913-200232.txt');
    const { tempDir, specPath } = await makeTempSpecCopy(tmp, specText, {
      areaPercent: { room1: 40 },
      blockedFile: llmBlocked,
      presetFile: llmPreset,
    });
    try {
      const doc = yaml.load(await fsp.readFile(specPath, 'utf8')) as {
        blockedFile?: string;
        presetFile?: string;
        clusters: Array<{ id: string; areaPercent: number }>;
      };
      expect(doc.blockedFile).toBe(llmBlocked); // ЛLM-маска вместо отсутствовавшей
      expect(doc.presetFile).toBe(llmPreset); // заменяет preset проекта
      expect(doc.clusters[0].areaPercent).toBe(40);
      // Временная копия — ВНЕ каталога проекта.
      expect(specPath.startsWith(tmp)).toBe(false);
    } finally {
      await fsp.rm(tempDir, { recursive: true, force: true });
    }
    if (before !== null) {
      expect(await fsp.readFile(path.join(tmp, 'spec.yaml'), 'utf8')).toBe(before);
    }
  });
});

// ---------------------------------------------------------------------------
// Детектор стагнации (чистые функции, LST-7 / docs-llm/05 §2.1)
// ---------------------------------------------------------------------------

describe('детекция стагнации', () => {
  it('canonicalJson — ключи отсортированы рекурсивно, порядок массивов сохраняется', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [1, 2] } })).toBe('{"a":{"c":[1,2],"d":2},"b":1}');
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson([3, { b: 1, a: 2 }])).toBe('[3,{"a":2,"b":1}]');
  });

  it('stagnationHash — детерминирован и не зависит от порядка ключей', () => {
    expect(stagnationHash('run_generation', { seed: 7 })).toBe(stagnationHash('run_generation', { seed: 7 }));
    expect(stagnationHash('run_generation', { a: 1, b: 2 })).toBe(stagnationHash('run_generation', { b: 2, a: 1 }));
    expect(stagnationHash('run_generation', { seed: 7 })).not.toBe(stagnationHash('correct_result', { seed: 7 }));
    expect(stagnationHash('run_generation', { seed: 7 })).not.toBe(stagnationHash('run_generation', { seed: 8 }));
  });

  it('3 подряд идентичных шага → true ровно на третьем (лимит по умолчанию)', () => {
    expect(STAGNATION_LIMIT).toBe(3);
    const d = createStagnationDetector();
    const step = { seed: 7 };
    expect(d.feed('run_generation', step)).toBe(false); // 1-й
    expect(d.feed('run_generation', step)).toBe(false); // 2-й
    expect(d.feed('run_generation', step)).toBe(true); // 3-й
    expect(d.feed('run_generation', step)).toBe(true); // и дальше
  });

  it('другое действие/аргументы между повторами сбрасывают счётчик', () => {
    const d = createStagnationDetector();
    expect(d.feed('run_generation', { seed: 7 })).toBe(false);
    expect(d.feed('run_generation', { seed: 7 })).toBe(false);
    expect(d.feed('read_result', { file: 'x' })).toBe(false); // сброс (хоть и не исполняющий)
    expect(d.feed('run_generation', { seed: 7 })).toBe(false);
    expect(d.feed('run_generation', { seed: 8 })).toBe(false);
    expect(d.feed('run_generation', { seed: 8 })).toBe(false);
    expect(d.feed('run_generation', { seed: 8 })).toBe(true);
  });

  it('порядок ключей аргументов не влияет на повтор (канонический JSON)', () => {
    const d = createStagnationDetector();
    expect(d.feed('run_generation', { seed: 1, nodeBudget: 5 })).toBe(false);
    expect(d.feed('run_generation', { nodeBudget: 5, seed: 1 })).toBe(false);
    expect(d.feed('run_generation', { seed: 1, nodeBudget: 5 })).toBe(true);
  });

  it('настраиваемый порог (DI)', () => {
    const d = createStagnationDetector(2);
    expect(d.feed('correct_result', {})).toBe(false);
    expect(d.feed('correct_result', {})).toBe(true);
  });
});
