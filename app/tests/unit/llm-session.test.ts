// Unit-тесты системного промпта (ТЗ docs-llm/05 §3) и журнала (формат, 05 §5).
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildSystemPrompt, RAW_MASK_MAX_CELLS } from '../../server/llm/session.js';
import { listJournals, readJournalRecord, writeJournalRecord, type LlmJournalRecord } from '../../server/llm/journal.js';
import { parseSpec } from '../../server/llm/specInfo.js';

const SPEC_TEXT = [
  'grid:',
  '  width: 3',
  '  height: 3',
  'blockedFile: blocked.txt',
  'presetFile: preset.txt',
  'types:',
  '  ROOM: { symbol: "R", name: Комната }',
  'rules:',
  '  connectivity: 8',
  'clusters:',
  '  - id: room1',
  '    type: ROOM',
  '    areaPercent: 50',
  '    shape: free',
  '',
].join('\n');

describe('buildSystemPrompt — четыре части (ТЗ docs-llm/05 §3)', () => {
  const base = {
    spec: parseSpec(SPEC_TEXT),
    specText: SPEC_TEXT,
    blockedText: '..*\n...\n...\n',
    presetText: 'R..\n...\n...\n',
    userPrompt: 'сделай коридор поменьше',
  };

  it('части 1/2/3/4 присутствуют; часть 4 — запрос дословно + finish', () => {
    const p = buildSystemPrompt(base);
    expect(p).toContain('## 1. Описание системы');
    expect(p).toContain('ДЕТЕРМИНИРОВАН');
    expect(p).toContain('## 2. Возможности (действия и ограничения)');
    expect(p).toContain('"run_generation"');
    expect(p).toContain('"read_result"');
    expect(p).toContain('"correct_result"');
    expect(p).toContain('"finish"');
    expect(p).toContain('КРИТИЧНОЕ ПРАВИЛО: ты НИКОГДА не изменяешь существующий файл');
    expect(p).toContain('touchAll (критичная настройка пользователя)');
    expect(p).toContain('## 3. Исходная конфигурация проекта');
    expect(p).toContain('## 4. Запрос пользователя');
    expect(p).toContain('«сделай коридор поменьше»');
    expect(p).toContain('вызови finish с кандидатами и комментариями');
  });

  it('маленькая сетка (≤ 2000 клеток) — маски вставляются сырьём', () => {
    const p = buildSystemPrompt(base);
    expect(p).toContain('..*\n...\n...'); // blocked.txt как есть
    expect(p).toContain('R..\n...\n...'); // preset.txt как есть
  });

  it('большая сетка (> 2000 клеток) — компактная сводка F/blocked/пресеты с bbox', () => {
    const w = 50, h = 50;
    const bigSpec = parseSpec(
      SPEC_TEXT.replace('width: 3', `width: ${w}`).replace('height: 3', `height: ${h}`),
    );
    expect(w * h).toBeGreaterThan(RAW_MASK_MAX_CELLS);
    const blockedRow = '.*'.repeat(25); // 10 блокировок на ряд? нет: 50 символов, '*' каждый второй
    const blockedText = (blockedRow + '\n').repeat(h);
    const presetLines = Array.from({ length: h }, () => '.'.repeat(w));
    presetLines[2] = 'R'.repeat(3) + '.'.repeat(w - 3); // пресет 3 клетки в ряду y=2
    const p = buildSystemPrompt({ ...base, spec: bigSpec, blockedText, presetText: presetLines.join('\n') });
    expect(p).toContain('F — свободных клеток после блокировок: 1250');
    expect(p).toContain('Заблокированных клеток: 1250'); // «*» каждый второй символ × 50 рядов
    expect(p).toContain('Пресеты (связные области, позиции и размеры):');
    expect(p).toContain('тип ROOM (символ «R»): клеток 3, bbox x=0..2, y=2..2');
    // Сырой текст большой маски НЕ вставляется целиком.
    expect(p).not.toContain(blockedRow);
  });
});

describe('журнал сессий — формат и IO (ТЗ docs-llm/05 §5)', () => {
  let tmp: string;
  const now = () => new Date(2026, 8, 13, 20, 2, 32);

  beforeEach(async () => {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'llm-journal-'));
  });
  afterEach(async () => {
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  const record: LlmJournalRecord = {
    prompt: 'сделай коридор поменьше',
    modelId: 'test/model-a',
    limits: { maxIterations: 5, timeBudgetPerRun: 2.0, totalTimeoutSec: 180 },
    iterations: [
      { n: 1, action: 'run_generation', args: { seed: 7 }, ok: true, summary: 'файл result-20260913-200232.txt (exit 0)' },
      { n: 2, action: null, args: {}, ok: false, summary: 'ошибка протокола: неверный JSON' },
    ],
    candidates: [{ file: 'result-20260913-200232.txt', comment: 'все в допуске' }],
    recommended: 'result-20260913-200232.txt',
    status: 'done',
    startedAt: '2026-09-13T20:02:32.000Z',
    finishedAt: '2026-09-13T20:04:07.000Z',
  };

  it('write → read round-trip; имя файла = id сессии', async () => {
    await writeJournalRecord(tmp, '20260913-200232', record);
    const onDisk = JSON.parse(await fsp.readFile(path.join(tmp, 'llm-sessions/20260913-200232.json'), 'utf8'));
    expect(onDisk).toEqual(record);
    expect(await readJournalRecord(tmp, '20260913-200232')).toEqual(record);
  });

  it('listJournals — newest-first по имени файла', async () => {
    await writeJournalRecord(tmp, '20260913-200232', record);
    await writeJournalRecord(tmp, '20260914-080000', { ...record, status: 'stopped', error: 'остановлено пользователем' });
    const list = await listJournals(tmp);
    expect(list.map((e) => e.sessionId)).toEqual(['20260914-080000', '20260913-200232']);
  });

  it('отсутствующий/некорректный id → null (без исключений)', async () => {
    expect(await readJournalRecord(tmp, 'nope')).toBeNull();
    expect(await readJournalRecord(tmp, '../spec.yaml')).toBeNull();
    await fsp.mkdir(path.join(tmp, 'llm-sessions'), { recursive: true });
    await fsp.writeFile(path.join(tmp, 'llm-sessions/bad.json'), '{не json', 'utf8');
    const list = await listJournals(tmp);
    expect(list).toEqual([]);
  });

  it('running-запись: finishedAt null; candidates отсутствует до finish', async () => {
    const running: LlmJournalRecord = {
      prompt: 'p', modelId: 'm', limits: record.limits, iterations: [], status: 'running',
      startedAt: now().toISOString(), finishedAt: null,
    };
    await writeJournalRecord(tmp, '20260913-200233', running);
    const read = (await readJournalRecord(tmp, '20260913-200233')) as LlmJournalRecord;
    expect(read.finishedAt).toBeNull();
    expect('candidates' in read).toBe(false);
  });
});
