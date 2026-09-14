// Integration ST-1: дословные ответы LLM в журнале сессии (raw).
// Паттерн llm-agent.test.ts с фейковым chatFn (DI) — без реального солвера:
// шаги = 2× ошибка протокола (длинный и короткий ответ) + finish.
// raw — дословно в каждом шаге; длинный (>8000) — усечённая копия с «…(N символов)».
// llm-status остаётся лёгким (без raw); полный журнал GET .../llm-sessions/:id — c raw.
import fsp from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runLlmSession } from '../../server/llm/agent.js';
import { RAW_MAX_LEN, readJournalRecord } from '../../server/llm/journal.js';
import { systemClock } from '../../server/workspace.js';
import { api, startServer, type TestCtx } from '../unit/helpers.js';

let ctx: TestCtx;

beforeEach(async () => {
  ctx = await startServer();
});
afterEach(async () => {
  await ctx.stop();
});

const RESULT_NAME = 'result-20260913-120000.txt';

describe('Журнал: дословные ответы LLM (raw, ST-1)', () => {
  it('raw в каждом шаге (включая ProtocolError); длинный ответ усечён; llm-status без raw', async () => {
    const r = await api(ctx, 'POST', '/api/projects', { name: 'raw-test' });
    expect(r.status).toBe(201);
    const slug = (r.json as { project: { slug: string } }).project.slug;

    // result-файл для finish — напрямую на диске (солвер не нужен).
    await fsp.writeFile(path.join(ctx.ws, slug, RESULT_NAME), 'stub-отчёт\n', 'utf8');

    const longGarbage = `Не JSON. ${'a'.repeat(8500)}`; // > RAW_MAX_LEN, протокол сломан
    const shortGarbage = 'совершенно не JSON';
    const finishReply = JSON.stringify({
      action: 'finish',
      args: { candidates: [{ file: RESULT_NAME, comment: 'готово' }] },
      thought: 'финал',
    });
    const replies = [longGarbage, shortGarbage, finishReply];
    let call = 0;

    const outcome = await runLlmSession({
      projectDir: path.join(ctx.ws, slug),
      sessionId: '19700101-000000',
      prompt: 'проверка raw в журнале',
      modelId: 'p/m',
      provider: { url: 'http://127.0.0.1:9', apiKey: 'x' }, // не используется: chatFn подставлен
      limits: { maxIterations: 5, timeBudgetPerRun: 2.0 },
      pythonBin: '/bin/true',
      now: systemClock,
      chatFn: async () => replies[call++] ?? finishReply,
    });
    expect(outcome.status).toBe('done');

    // Журнал на диске: raw в каждом шаге (включая шаги с ошибкой протокола).
    const record = await readJournalRecord(path.join(ctx.ws, slug), '19700101-000000');
    expect(record).not.toBeNull();
    expect(record!.iterations).toHaveLength(3);
    expect(record!.iterations.map((it) => it.action)).toEqual([null, null, 'finish']);

    // Шаг 1: Длинный ответ — усечённая копия дословно (префикс + «…(N символов)»).
    expect(record!.iterations[0].raw).toBe(`${longGarbage.slice(0, RAW_MAX_LEN)}…(${longGarbage.length} символов)`);
    // Шаг 2: короткий ответ — дословно.
    expect(record!.iterations[1].raw).toBe(shortGarbage);
    // Шаг 3: успешное действие — тоже дословно.
    expect(record!.iterations[2].raw).toBe(finishReply);

    // Полный журнал по API содержит raw…
    const full = await api(ctx, 'GET', `/api/projects/${slug}/llm-sessions/19700101-000000`);
    expect(full.status).toBe(200);
    const fullIterations = (full.json as { iterations: Array<{ raw?: string }> }).iterations;
    expect(fullIterations[0].raw).toBe(record!.iterations[0].raw);
    expect(fullIterations[1].raw).toBe(shortGarbage);

    // …а llm-status остаётся лёгким: raw в опросе НЕ попадает.
    const status = await api(ctx, 'GET', `/api/projects/${slug}/llm-status?session=19700101-000000`);
    expect(status.status).toBe(200);
    const log = (status.json as { log: Array<Record<string, unknown>> }).log;
    expect(log).toHaveLength(3);
    for (const l of log) expect('raw' in l).toBe(false);
  });

  it('старый журнал без raw остаётся читаемым', async () => {
    const r = await api(ctx, 'POST', '/api/projects', { name: 'legacy-journal' });
    expect(r.status).toBe(201);
    const slug = (r.json as { project: { slug: string } }).project.slug;

    // Журнал «старого формата» (без raw) пишем напрямую.
    const sessionsDir = path.join(ctx.ws, slug, 'llm-sessions');
    await fsp.mkdir(sessionsDir, { recursive: true });
    const legacy = {
      prompt: 'старый прогон',
      modelId: 'p/m',
      limits: { maxIterations: 5, timeBudgetPerRun: 2.0 },
      iterations: [{ n: 1, action: 'finish', args: {}, ok: true, summary: 'готово' }],
      status: 'done',
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:01:00.000Z',
    };
    await fsp.writeFile(path.join(sessionsDir, '19700101-000000.json'), JSON.stringify(legacy, null, 2) + '\n', 'utf8');

    const res = await api(ctx, 'GET', `/api/projects/${slug}/llm-sessions/19700101-000000`);
    expect(res.status).toBe(200);
    const rec = res.json as { status: string; iterations: Array<{ raw?: unknown }> };
    expect(rec.status).toBe('done');
    expect(rec.iterations[0].raw).toBeUndefined();
  });
});
