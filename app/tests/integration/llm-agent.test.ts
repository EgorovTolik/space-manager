// Integration-тесты LLM-агентного цикла (ТЗ docs-llm/07 §2.2):
// фейковый OpenAI-совместимый LLM-сервер (scripted-ответы) + РЕАЛЬНЫЙ Python-солвер
// (.venv/bin/python) на маленьких спеках; временный workspace, конфиг — LLM_CONFIG_PATH.
import { createServer, type Server } from 'node:http';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runLlmSession } from '../../server/llm/agent.js';
import { STAGNATION_NOTE } from '../../server/llm/stagnation.js';
import { systemClock } from '../../server/workspace.js';

import { api, startServer, type TestCtx } from '../unit/helpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PYTHON_BIN = path.join(ROOT, '.venv', 'bin', 'python');

// ---------------------------------------------------------------------------
// Фикстуры спеки (реальный солвер)
// ---------------------------------------------------------------------------

/** Маленькая спека 7×2, два кластера по 50%: детерминированно feasible (seed 0). */
const SMALL_SPEC = [
  'grid:',
  '  width: 7',
  '  height: 2',
  'blockedFile: blocked.txt',
  'presetFile: preset.txt',
  'types:',
  '  ROOM: { symbol: "R", name: Комната }',
  '  CORRIDOR: { symbol: "C", name: Коридор }',
  'rules:',
  '  connectivity: 8',
  '  adjacency:',
  '    forbidden: []',
  '    allow: null',
  '  size:',
  '    min: null',
  '    max: null',
  '  convexity:',
  '    weight: soft',
  '  fillAll: false',
  '  touchAll: false',
  'clusters:',
  '  - id: room1',
  '    type: ROOM',
  '    areaPercent: 50',
  '    shape: free',
  '  - id: corridor1',
  '    type: CORRIDOR',
  '    areaPercent: 50',
  '    shape: free',
  '',
].join('\n');

const SMALL_MASK = ('.......' + '\n').repeat(2);

/** Маленькая спека 7×2 БЕЗ маски блокировок (для create_blockages_file). */
const NOBLOCK_SPEC = SMALL_SPEC.split('\n').filter((l) => !l.startsWith('blockedFile')).join('\n');
const NOBLOCK_WALL = '.....**\n.......\n'; // 2 заблокированные клетки → F = 12, цели 6/6

/** Тяжёлая спека 50×50 (touchAll + forbidden-пара + rectangle): поиск > 10 c. */
const BIG_SPEC = [
  'grid:',
  '  width: 50',
  '  height: 50',
  'blockedFile: blocked.txt',
  'presetFile: preset.txt',
  'types:',
  '  ROOM: { symbol: "R", name: Комната }',
  '  CORRIDOR: { symbol: "C", name: Коридор }',
  'rules:',
  '  connectivity: 8',
  '  adjacency:',
  '    forbidden:',
  '      - [ROOM, CORRIDOR]',
  '    allow: null',
  '  size:',
  '    min: null',
  '    max: null',
  '  convexity:',
  '    weight: soft',
  '  fillAll: false',
  '  touchAll: true',
  'clusters:',
  '  - id: room1',
  '    type: ROOM',
  '    areaPercent: 40',
  '    shape: rectangle',
  '  - id: corridor1',
  '    type: CORRIDOR',
  '    areaPercent: 35',
  '    shape: free',
  '  - id: room2',
  '    type: ROOM',
  '    areaPercent: 25',
  '    shape: free',
  '',
].join('\n');

const BIG_MASK = ('.'.repeat(50) + '\n').repeat(50);

// ---------------------------------------------------------------------------
// Фейковый LLM-сервер (scripted OpenAI-совместимый, docs-llm/07 §1)
// ---------------------------------------------------------------------------

interface ChatRequest {
  model?: string;
  messages: Array<{ role: string; content: string }>;
}

type ScriptedReply = string | ((reqBody: ChatRequest) => string);

/**
 * result-файл из ответов сервера LLM (run_generation/correct_result):
 * ищем ПЕРВОЕ вхождение "file":"result-…" начиная с конца истории — последний
 * user-сообщение может быть полным текстом read_result, где такого ключа нет.
 */
function lastResultFile(body: ChatRequest): string | null {
  for (let i = body.messages.length - 1; i >= 0; i--) {
    const m = /"file":"(result-[0-9]{8}-[0-9]{6}(?:-[0-9]+)?\.txt)"/.exec(body.messages[i].content);
    if (m) return m[1];
  }
  return null;
}

/** Имя LLM-маски из истории (результат create_*_file), начиная с конца. */
function lastMaskFile(body: ChatRequest, re: RegExp): string | null {
  for (let i = body.messages.length - 1; i >= 0; i--) {
    const m = re.exec(body.messages[i].content);
    if (m) return m[1];
  }
  return null;
}

interface FakeLlm {
  url: string;
  calls: ChatRequest[];
  stop: () => Promise<void>;
}

async function startFakeLlm(replies: ScriptedReply[], opts: { delayMs?: number } = {}): Promise<FakeLlm> {
  const calls: ChatRequest[] = [];
  const server: Server = createServer((req, res) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
    });
    req.on('end', () => {
      let url: URL;
      try {
        url = new URL(req.url ?? '', 'http://fake');
      } catch {
        res.writeHead(400);
        res.end();
        return;
      }
      if (url.pathname === '/v1/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'test-model' }] }));
        return;
      }
      if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
        const body = JSON.parse(data) as ChatRequest;
        calls.push(body);
        const reply = replies[calls.length - 1];
        if (reply === undefined) {
          // Скрипт исчерпан — сбрасываем провайдера: сессия завершится как error,
          // а не зациклится на дефолтном ответе.
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'script exhausted' }));
          return;
        }
        let content: string;
        try {
          content = typeof reply === 'function' ? reply(body) : reply;
        } catch (err) {
          content = JSON.stringify({ action: 'finish', args: { candidates: [] }, thought: `fake-llm error: ${(err as Error).message}` });
        }
        const respond = (): void => {
          try {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }));
          } catch {
            // клиент уже закрыл соединение (таймаут) — не критично для теста
          }
        };
        if (opts.delayMs && opts.delayMs > 0) setTimeout(respond, opts.delayMs);
        else respond();
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{"error":"not found"}');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    stop: async () => {
      server.closeAllConnections?.();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

// ---------------------------------------------------------------------------
// Конфиг LLM (LLM_CONFIG_PATH → tmp-файл) и вспомогательные функции
// ---------------------------------------------------------------------------

let ctx: TestCtx;
let savedEnv: string | undefined;
let cfgTmp: string | null = null;
const fakes: FakeLlm[] = [];

beforeEach(async () => {
  ctx = await startServer({ pythonBin: PYTHON_BIN, timeoutMs: 90_000 });
});

afterEach(async () => {
  if (savedEnv === undefined) delete process.env.LLM_CONFIG_PATH;
  else process.env.LLM_CONFIG_PATH = savedEnv;
  if (cfgTmp !== null) await fsp.rm(cfgTmp, { recursive: true, force: true });
  cfgTmp = null;
  for (const f of fakes.splice(0)) await f.stop();
  await ctx.stop();
});

async function writeLlmConfig(url: string): Promise<void> {
  cfgTmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'llm-cfg-'));
  savedEnv = process.env.LLM_CONFIG_PATH;
  const p = path.join(cfgTmp, 'llm.config.json');
  process.env.LLM_CONFIG_PATH = p;
  await fsp.writeFile(
    p,
    JSON.stringify({
      providers: { test: { url, apiKey: 'test-key' } },
      defaultModel: 'test/test-model',
      labels: { 'test/test-model': 'тестовая модель' },
    }),
    'utf8',
  );
}

async function fakeLlm(replies: ScriptedReply[], opts: { delayMs?: number } = {}): Promise<FakeLlm> {
  const f = await startFakeLlm(replies, opts);
  fakes.push(f);
  return f;
}

async function makeProject(name: string, spec: string, mask: string): Promise<string> {
  const r = await api(ctx, 'POST', '/api/projects', { name });
  expect(r.status).toBe(201);
  const slug = (r.json as { project: { slug: string } }).project.slug;
  const put = await api(ctx, 'PUT', `/api/projects/${slug}/files`, {
    files: { 'spec.yaml': spec, 'blocked.txt': mask, 'preset.txt': mask },
  });
  expect(put.status).toBe(200);
  return slug;
}

/** Синхронная обычная генерация (без LLM) — базовый result-файл для тестов. */
async function plainGenerate(slug: string): Promise<{ file: string; report: string }> {
  const res = await api(ctx, 'POST', `/api/projects/${slug}/generate`, {});
  expect(res.status).toBe(200);
  const body = res.json as { resultFile: string; exitCode: number; feasible: boolean; report: string };
  expect(body.exitCode).toBe(0);
  expect(body.feasible).toBe(true);
  return { file: body.resultFile, report: body.report };
}

interface StatusBody {
  state: string;
  log: Array<{ n: number; action: string | null; ok: boolean; summary: string }>;
  candidates?: Array<{ file: string; comment: string }>;
  recommended?: string;
  note?: string;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

async function pollStatus(slug: string, sessionId: string, timeoutMs = 90_000): Promise<StatusBody> {
  const t0 = Date.now();
  for (;;) {
    const res = await api(ctx, 'GET', `/api/projects/${slug}/llm-status?session=${sessionId}`);
    expect(res.status).toBe(200);
    const body = res.json as StatusBody;
    if (body.state !== 'running') return body;
    if (Date.now() - t0 > timeoutMs) throw new Error(`сессия не завершилась за ${timeoutMs} мс: ${JSON.stringify(body.log)}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

const sha256 = (buf: Buffer | string): string => crypto.createHash('sha256').update(buf).digest('hex');

/** Карта result-отчёта → строки. */
function mapLinesOf(report: string): string[] {
  const lines = report.split('\n');
  const i = lines.findIndex((l) => l.trim() === '== КАРТА ==');
  expect(i).toBeGreaterThanOrEqual(0);
  const out: string[] = [];
  let k = i + 1;
  while (k < lines.length && lines[k] === '') k++; // пустая строка после заголовка
  for (; k < lines.length && lines[k] !== '' && !lines[k].startsWith('=='); k++) out.push(lines[k]);
  return out;
}

// ---------------------------------------------------------------------------
// Тесты
// ---------------------------------------------------------------------------

describe('LLM-агентный цикл (integration: фейковый LLM + реальный солвер)', () => {
  it('1. полный цикл run → read → finish: done, журнал корректен, result в истории', async () => {
    const fake = await fakeLlm([
      '{"action":"run_generation","args":{"seed":7},"thought":"пробуем новый seed"}',
      (body) => JSON.stringify({ action: 'read_result', args: { file: lastResultFile(body) } }),
      (body) =>
        JSON.stringify({
          action: 'finish',
          args: { candidates: [{ file: lastResultFile(body), comment: 'все кластеры в допуске' }], recommended: lastResultFile(body) },
        }),
    ]);
    await writeLlmConfig(fake.url);
    const slug = await makeProject('llm', SMALL_SPEC, SMALL_MASK);
    const specShaBefore = sha256(fs.readFileSync(path.join(ctx.ws, slug, 'spec.yaml')));

    const start = await api(ctx, 'POST', `/api/projects/${slug}/llm-generate`, {
      prompt: 'сделай размещение ближе к целям',
      modelId: 'test/test-model',
    });
    expect(start.status).toBe(202);
    const sessionId = (start.json as { sessionId: string }).sessionId;
    expect(sessionId).toMatch(/^\d{8}-\d{6}(-\d+)?$/);

    const status = await pollStatus(slug, sessionId);
    expect(status.state).toBe('done');
    expect(status.log.map((l) => l.action)).toEqual(['run_generation', 'read_result', 'finish']);
    expect(status.log.every((l) => l.ok)).toBe(true);
    expect(status.log[0].summary).toContain('seed'); // thought LLM в summary
    expect(status.candidates?.[0]?.comment).toBe('все кластеры в допуске');
    expect(status.recommended).toBe(status.candidates?.[0]?.file);
    expect(status.error).toBeNull();

    // Журнал на диске: точный формат (docs-llm/05 §5).
    const journalPath = path.join(ctx.ws, slug, 'llm-sessions', `${sessionId}.json`);
    const journal = JSON.parse(await fsp.readFile(journalPath, 'utf8'));
    expect(journal.prompt).toBe('сделай размещение ближе к целям');
    expect(journal.modelId).toBe('test/test-model');
    // Жёсткого временного лимита сессии больше нет (LST-7): только счётчики/бюджеты.
    expect(journal.limits).toEqual({ maxIterations: 5, timeBudgetPerRun: 2.0 });
    expect(journal.status).toBe('done');
    expect(typeof journal.startedAt).toBe('string');
    expect(typeof journal.finishedAt).toBe('string');
    expect(journal.iterations).toHaveLength(3);
    for (const it of journal.iterations) {
      expect(it).toMatchObject({ n: expect.any(Number), action: expect.any(String), args: expect.any(Object), ok: true });
      expect(typeof it.summary).toBe('string');
    }
    expect(journal.iterations[0].args).toEqual({ seed: 7 });
    expect(journal.candidates).toHaveLength(1);

    // Result-файл создан со стандартным именем и в истории проекта.
    const file = status.candidates?.[0]?.file as string;
    expect(file).toMatch(/^result-\d{8}-\d{6}(-\d+)?\.txt$/);
    await expect(fsp.access(path.join(ctx.ws, slug, file))).resolves.toBeUndefined();
    const results = await api(ctx, 'GET', `/api/projects/${slug}/results`);
    expect((results.json as { results: Array<{ name: string }> }).results.map((r) => r.name)).toContain(file);
    const projects = await api(ctx, 'GET', '/api/projects');
    const proj = (projects.json as { projects: Array<{ slug: string; latestResult: string }> }).projects.find((p) => p.slug === slug);
    expect(proj?.latestResult).toBe(file);

    // Файлы проекта не изменялись.
    expect(sha256(fs.readFileSync(path.join(ctx.ws, slug, 'spec.yaml')))).toBe(specShaBefore);

    // Список сессий: одна запись нужной формы.
    const list = await api(ctx, 'GET', `/api/projects/${slug}/llm-sessions`);
    expect(list.status).toBe(200);
    const sessions = (list.json as { sessions: unknown[] }).sessions;
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId,
      status: 'done',
      modelId: 'test/test-model',
      startedAt: journal.startedAt,
      finishedAt: journal.finishedAt,
    });
    expect((sessions[0] as { promptPreview: string }).promptPreview).toBe('сделай размещение ближе к целям');

    // Полный журнал по id — без изменений.
    const full = await api(ctx, 'GET', `/api/projects/${slug}/llm-sessions/${sessionId}`);
    expect(full.status).toBe(200);
    expect(full.json).toEqual(journal);
  });

  it('2. correct_result (валидная правка): новый файл, исходный побайтово нетронут, validate пройден', async () => {
    const slug = await makeProject('llm-corr', SMALL_SPEC, SMALL_MASK);
    const base = await plainGenerate(slug);
    const map = mapLinesOf(base.report);
    const noopSymbol = map[0][0]; // no-op edit: символ остаётся тем же

    const fake = await fakeLlm([
      JSON.stringify({
        action: 'correct_result',
        args: { baseFile: base.file, edits: [{ x: 0, y: 0, symbol: noopSymbol }], reason: 'проверка механизма коррекции' },
      }),
      (body) =>
        JSON.stringify({
          action: 'finish',
          args: { candidates: [{ file: lastResultFile(body), comment: 'исправленная версия' }] },
        }),
    ]);
    await writeLlmConfig(fake.url);

    const baseBefore = fs.readFileSync(path.join(ctx.ws, slug, base.file));
    const res = await api(ctx, 'POST', `/api/projects/${slug}/llm-generate`, { prompt: 'поправь маску', modelId: 'test/test-model' });
    expect(res.status).toBe(202);
    const sessionId = (res.json as { sessionId: string }).sessionId;

    const status = await pollStatus(slug, sessionId);
    expect(status.state).toBe('done');
    expect(status.log[0].ok).toBe(true);
    expect(status.log[0].summary).toContain('validate пройден');

    // Новый файл создан (не base), исходный побайтово нетронут.
    const newFile = status.candidates?.[0]?.file as string;
    expect(newFile).not.toBe(base.file);
    expect(sha256(fs.readFileSync(path.join(ctx.ws, slug, base.file)))).toBe(sha256(baseBefore));
    // No-op edit: содержимое новое == исходному (механизм «копировать как есть»).
    const newContent = await fsp.readFile(path.join(ctx.ws, slug, newFile), 'utf8');
    expect(newContent).toBe(baseBefore.toString('utf8'));

    // latestResult указывает на валидный новый файл.
    const projects = await api(ctx, 'GET', '/api/projects');
    const proj = (projects.json as { projects: Array<{ slug: string; latestResult: string }> }).projects.find((p) => p.slug === slug);
    expect(proj?.latestResult).toBe(newFile);
  });

  it('2б. correct_result (невалидная правка): файл удалён, LLM получила список нарушений', async () => {
    const slug = await makeProject('llm-corr-bad', SMALL_SPEC, SMALL_MASK);
    const base = await plainGenerate(slug);
    const map = mapLinesOf(base.report);

    // Правка, гарантированно нарушающая V-AREA: убрать клетку типа, чья площадь
    // после этого выйдет за ±10% от суммы целей типа (в фикстуре оба типа точно в цели).
    const counts: Record<string, number> = {};
    for (const row of map) for (const ch of row) if (ch !== '.' && ch !== '*') counts[ch] = (counts[ch] ?? 0) + 1;
    // Цели типов из таблицы отчёта.
    const tableSection = base.report.split('== ТАБЛИЦА')[1].split('\n');
    const targets: Record<string, number> = {};
    for (const line of tableSection) {
      const cells = line.split(' | ').map((c) => c.trim());
      if (cells.length >= 5 && !cells[0].startsWith('-') && cells[0] !== 'id' && /^\d+$/.test(cells[3])) {
        targets[cells[1]] = (targets[cells[1]] ?? 0) + Number.parseInt(cells[3], 10);
      }
    }
    const symbolToType: Record<string, string> = { R: 'ROOM', C: 'CORRIDOR' };
    let edit: { x: number; y: number } | null = null;
    outer: for (let y = 0; y < map.length; y++) {
      for (let x = 0; x < map[y].length; x++) {
        const ch = map[y][x];
        if (ch === '.' || ch === '*') continue;
        const type = symbolToType[ch];
        const targetSum = targets[type] ?? 0;
        const newArea = counts[ch] - 1;
        if (targetSum > 0 && Math.abs(newArea - targetSum) > 0.1 * targetSum) {
          edit = { x, y };
          break outer;
        }
      }
    }
    expect(edit).not.toBeNull();

    const fake = await fakeLlm([
      JSON.stringify({
        action: 'correct_result',
        args: { baseFile: base.file, edits: [{ x: edit!.x, y: edit!.y, symbol: '.' }], reason: 'уменьшить комнату' },
      }),
      JSON.stringify({ action: 'finish', args: { candidates: [{ file: base.file, comment: 'оставляю исходный вариант' }] } }),
    ]);
    await writeLlmConfig(fake.url);

    const res = await api(ctx, 'POST', `/api/projects/${slug}/llm-generate`, { prompt: 'уменьши комнату', modelId: 'test/test-model' });
    expect(res.status).toBe(202);
    const sessionId = (res.json as { sessionId: string }).sessionId;

    const status = await pollStatus(slug, sessionId);
    expect(status.state).toBe('done');
    // Шаг коррекции — ok:false с причиной (LLM получила нарушения, 03 §8).
    expect(status.log[0].ok).toBe(false);
    expect(status.log[0].summary).toContain('нарушения');

    // Невалидная копия удалена: в проекте остался ТОЛЬКО исходный result-файл.
    const files = fs.readdirSync(path.join(ctx.ws, slug)).filter((n) => n.startsWith('result-'));
    expect(files).toEqual([base.file]);
  });

  it('3. запрещённый аргумент (touchAll): шаг ok:false с причиной, далее исправленный запуск', async () => {
    const fake = await fakeLlm([
      '{"action":"run_generation","args":{"seed":5,"touchAll":true}}',
      '{"action":"run_generation","args":{"seed":3}}',
      (body) => JSON.stringify({ action: 'finish', args: { candidates: [{ file: lastResultFile(body), comment: 'ok' }] } }),
    ]);
    await writeLlmConfig(fake.url);
    const slug = await makeProject('llm-forbidden', SMALL_SPEC, SMALL_MASK);
    const specShaBefore = sha256(fs.readFileSync(path.join(ctx.ws, slug, 'spec.yaml')));

    const res = await api(ctx, 'POST', `/api/projects/${slug}/llm-generate`, { prompt: 'попробуй', modelId: 'test/test-model' });
    expect(res.status).toBe(202);
    const sessionId = (res.json as { sessionId: string }).sessionId;

    const status = await pollStatus(slug, sessionId);
    expect(status.state).toBe('done');
    expect(status.log[0].ok).toBe(false);
    expect(status.log[0].summary).toContain('запрещён');
    expect(status.log[1].ok).toBe(true);

    // Спека проекта не изменялась (оверрайды — только аргументы/временная копия).
    expect(sha256(fs.readFileSync(path.join(ctx.ws, slug, 'spec.yaml')))).toBe(specShaBefore);
  });

  it('4а. areaPercent вне допуска: шаг ok:false с причиной, файлы проекта не меняются', async () => {
    const slug = await makeProject('llm-area', SMALL_SPEC, SMALL_MASK);
    const base = await plainGenerate(slug);
    const specShaBefore = sha256(fs.readFileSync(path.join(ctx.ws, slug, 'spec.yaml')));

    // room1: цель 7; 70% от F=14 → round(9.8)=10 → |10−7|=3 > 0.7 — вне допуска.
    const fake = await fakeLlm([
      '{"action":"run_generation","args":{"areaPercent":{"room1":70}}}',
      JSON.stringify({ action: 'finish', args: { candidates: [{ file: base.file, comment: 'исходный вариант' }] } }),
    ]);
    await writeLlmConfig(fake.url);

    const res = await api(ctx, 'POST', `/api/projects/${slug}/llm-generate`, { prompt: 'поменяй долю комнаты', modelId: 'test/test-model' });
    expect(res.status).toBe(202);
    const sessionId = (res.json as { sessionId: string }).sessionId;

    const status = await pollStatus(slug, sessionId);
    expect(status.state).toBe('done');
    // Оверрайд отвергнут: шаг ok:false с причиной; LLM получила ошибку и завершилась.
    expect(status.log[0].ok).toBe(false);
    expect(status.log[0].summary).toContain('room1');

    // Спека проекта не тронута; новых result-файлов нет (запуск был отвергнут).
    expect(sha256(fs.readFileSync(path.join(ctx.ws, slug, 'spec.yaml')))).toBe(specShaBefore);
    const files = fs.readdirSync(path.join(ctx.ws, slug)).filter((n) => n.startsWith('result-'));
    expect(files).toEqual([base.file]);
  });

  it('4б. areaPercent в допуске: запуск на временной копии спеки (файлы проекта не меняются)', async () => {
    const fake = await fakeLlm([
      '{"action":"run_generation","args":{"areaPercent":{"room1":50}}}', // round(14·0.5)=7 — ровно цель (diff 0)
      (body) => JSON.stringify({ action: 'finish', args: { candidates: [{ file: lastResultFile(body), comment: 'оверрайд доли' }] } }),
    ]);
    await writeLlmConfig(fake.url);
    const slug = await makeProject('llm-area2', SMALL_SPEC, SMALL_MASK);
    const specShaBefore = sha256(fs.readFileSync(path.join(ctx.ws, slug, 'spec.yaml')));

    const res = await api(ctx, 'POST', `/api/projects/${slug}/llm-generate`, { prompt: 'оставь долю как есть', modelId: 'test/test-model' });
    expect(res.status).toBe(202);
    const sessionId = (res.json as { sessionId: string }).sessionId;

    const status = await pollStatus(slug, sessionId);
    expect(status.state).toBe('done');
    expect(status.log[0].ok).toBe(true);
    const file = status.candidates?.[0]?.file as string;
    expect(file).toMatch(/^result-\d{8}-\d{6}(-\d+)?\.txt$/);

    // Файлы проекта не изменялись: спека побайтово та же (оверрайд — во временной копии вне проекта).
    expect(sha256(fs.readFileSync(path.join(ctx.ws, slug, 'spec.yaml')))).toBe(specShaBefore);
    expect(fs.readFileSync(path.join(ctx.ws, slug, 'blocked.txt'), 'utf8')).toBe(SMALL_MASK);

    // Временные каталоги не остались в проекте и в /tmp проекта.
    const tmpLeftovers = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('space-manager-llm-'));
    expect(tmpLeftovers).toEqual([]);
  });

  it('5. stop во время реального запуска солвера: SIGKILL, частичный файл удалён, stopped', async () => {
    const fake = await fakeLlm([
      '{"action":"run_generation","args":{"nodeBudget":10000000}}', // тяжёлый поиск > 10 c
      (body) => JSON.stringify({ action: 'finish', args: { candidates: [{ file: lastResultFile(body) ?? 'result-x.txt', comment: 'x' }] } }),
    ]);
    await writeLlmConfig(fake.url);
    const slug = await makeProject('llm-stop', BIG_SPEC, BIG_MASK);

    const res = await api(ctx, 'POST', `/api/projects/${slug}/llm-generate`, {
      prompt: 'сложное размещение',
      modelId: 'test/test-model',
      limits: { timeBudgetPerRun: 60, totalTimeoutSec: 300 },
    });
    expect(res.status).toBe(202);
    const sessionId = (res.json as { sessionId: string }).sessionId;

    // Ждём, пока солвер реально запущен (python-интерпретатор + старт поиска), — и «Стоп».
    await new Promise((r) => setTimeout(r, 2500));
    const stop = await api(ctx, 'POST', `/api/projects/${slug}/llm-stop`);
    expect(stop.status).toBe(200);
    expect((stop.json as { state: string }).state).toBe('stopping');

    const status = await pollStatus(slug, sessionId, 30_000);
    expect(status.state).toBe('stopped');
    expect(status.error).toContain('остановлено');
    expect(status.finishedAt).not.toBeNull();

    // Частичный result-файл удалён: либо файлов нет, либо все полные отчёты.
    const files = fs.readdirSync(path.join(ctx.ws, slug)).filter((n) => n.startsWith('result-'));
    for (const f of files) {
      expect(fs.readFileSync(path.join(ctx.ws, slug, f), 'utf8')).toContain('== ТАБЛИЦА');
    }

    // Повторный «Стоп» после терминального состояния → 200 с текущим state.
    const stop2 = await api(ctx, 'POST', `/api/projects/${slug}/llm-stop`);
    expect(stop2.status).toBe(200);
    expect((stop2.json as { state: string }).state).toBe('stopped');
  });

  it('6. прогон длиннее 180 «стенковых» секунд (DI-часы) НЕ останавливается: totalTimeoutSec убран (LST-7)', async () => {
    const slug = await makeProject('llm-notimeout', SMALL_SPEC, SMALL_MASK);
    const base = await plainGenerate(slug);

    // Прямой вызов runLlmSession с DI: фейковый chatFn продвигает «стеновое» время
    // на 200 c за каждый LLM-вызов; жёсткого дедлайна нет — сессия доходит до finish.
    let fakeNow = Date.now();
    const readReply = JSON.stringify({ action: 'read_result', args: { file: base.file } });
    const replies = [readReply, readReply, readReply, readReply,
      JSON.stringify({ action: 'finish', args: { candidates: [{ file: base.file, comment: 'готово' }] } })];
    let call = 0;

    const outcome = await runLlmSession({
      projectDir: path.join(ctx.ws, slug),
      sessionId: '19700101-000000',
      prompt: 'длинный прогон без жёсткого лимита времени',
      modelId: 'test/test-model',
      provider: { url: 'http://127.0.0.1:9', apiKey: 'x' }, // не используется: chatFn подставлен
      limits: { maxIterations: 5, timeBudgetPerRun: 2.0 },
      pythonBin: PYTHON_BIN,
      now: systemClock,
      dateNow: () => fakeNow,
      chatFn: async () => {
        fakeNow += 200_000; // после ПЕРВОГО ответа «истекло» уже >180 с
        return replies[call++] ?? JSON.stringify({ action: 'finish', args: { candidates: [{ file: base.file, comment: 'x' }] } });
      },
    });

    // 5 LLM-вызовов × +200 c = «прошло» 1000 с — остановка по времени не случилась.
    expect(fakeNow).toBeGreaterThan(Date.now() + 900_000);
    expect(outcome.status).toBe('done');

    // Журнал на диске: done, лимиты без totalTimeoutSec.
    const journal = JSON.parse(await fsp.readFile(path.join(ctx.ws, slug, 'llm-sessions/19700101-000000.json'), 'utf8'));
    expect(journal.status).toBe('done');
    expect(journal.limits).toEqual({ maxIterations: 5, timeBudgetPerRun: 2.0 });
    expect(journal.iterations.map((it: { action: string }) => it.action)).toEqual(['read_result', 'read_result', 'read_result', 'read_result', 'finish']);

    // Старое UI-поле totalTimeoutSec в теле llm-generate — молча игнорируется (совместимость):
    // тело НЕ отвергается как invalid-body (400) — дальше срабатывает обычный
    // контроль конфига/модели (503 без конфига или 422 неизвестный провайдер).
    const compat = await api(ctx, 'POST', `/api/projects/${slug}/llm-generate`, {
      prompt: 'x', modelId: 'test/test-model', limits: { maxIterations: 5, timeBudgetPerRun: 2.0, totalTimeoutSec: 180 },
    });
    expect(compat.status).not.toBe(400);
    if (compat.status === 400) {
      throw new Error(`totalTimeoutSec должен игнорироваться: ${JSON.stringify(compat.json)}`);
    }
  });

  it('A. create_blockages_file (спека без blockedFile) → run_generation {blockagesFile} → finish', async () => {
    const fake = await fakeLlm([
      JSON.stringify({ action: 'create_blockages_file', args: { content: NOBLOCK_WALL, reason: 'маленькая стена в углу' } }),
      (body) => {
        const maskFile = lastMaskFile(body, /"file":"(blocked-llm-[0-9]{8}-[0-9]{6}(?:-[0-9]+)?\.txt)"/);
        return JSON.stringify({ action: 'run_generation', args: { blockagesFile: maskFile, seed: 0 } });
      },
      (body) =>
        JSON.stringify({
          action: 'finish',
          args: { candidates: [{ file: lastResultFile(body), comment: 'размещение с учётом стены' }] },
        }),
    ]);
    await writeLlmConfig(fake.url);

    // Спека без blockedFile; blocked.txt удаляется (каноническая тройка из payload).
    const r = await api(ctx, 'POST', '/api/projects', { name: 'llm-blockages' });
    expect(r.status).toBe(201);
    const slug = (r.json as { project: { slug: string } }).project.slug;
    const put = await api(ctx, 'PUT', `/api/projects/${slug}/files`, {
      files: { 'spec.yaml': NOBLOCK_SPEC, 'preset.txt': SMALL_MASK },
    });
    expect(put.status).toBe(200);
    expect(fs.existsSync(path.join(ctx.ws, slug, 'blocked.txt'))).toBe(false);
    const specShaBefore = sha256(fs.readFileSync(path.join(ctx.ws, slug, 'spec.yaml')));

    const start = await api(ctx, 'POST', `/api/projects/${slug}/llm-generate`, {
      prompt: 'поставь стену и сгенерируй',
      modelId: 'test/test-model',
    });
    expect(start.status).toBe(202);
    const sessionId = (start.json as { sessionId: string }).sessionId;

    const status = await pollStatus(slug, sessionId);
    expect(status.state).toBe('done');
    expect(status.log.map((l) => l.action)).toEqual(['create_blockages_file', 'run_generation', 'finish']);
    expect(status.log.every((l) => l.ok)).toBe(true);

    // НОВЫЙ файл маски в каталоге проекта; существующие файлы не тронуты.
    const maskFiles = fs.readdirSync(path.join(ctx.ws, slug)).filter((n) => n.startsWith('blocked-llm-'));
    expect(maskFiles).toHaveLength(1);
    expect(fs.readFileSync(path.join(ctx.ws, slug, maskFiles[0]), 'utf8')).toBe(NOBLOCK_WALL);
    expect(sha256(fs.readFileSync(path.join(ctx.ws, slug, 'spec.yaml')))).toBe(specShaBefore); // spec.yaml не изменён

    // Feasible-результат с учётом НОВОЙ F (12 клеток) и кандидаты.
    expect(status.log[1].summary).not.toContain('infeasible');
    const file = status.candidates?.[0]?.file as string;
    expect(file).toMatch(/^result-\d{8}-\d{6}(-\d+)?\.txt$/);
    await expect(fsp.access(path.join(ctx.ws, slug, file))).resolves.toBeUndefined();
  });

  it('A2. create_blockages_file при существующей маске пользователя → отказ', async () => {
    const slug = await makeProject('llm-blockages-busy', SMALL_SPEC, SMALL_MASK);
    const base = await plainGenerate(slug);
    const fake = await fakeLlm([
      JSON.stringify({ action: 'create_blockages_file', args: { content: SMALL_MASK, reason: 'лишняя маска' } }),
      JSON.stringify({ action: 'finish', args: { candidates: [{ file: base.file, comment: 'исходный вариант' }] } }),
    ]);
    await writeLlmConfig(fake.url);

    const res = await api(ctx, 'POST', `/api/projects/${slug}/llm-generate`, { prompt: 'создай маску', modelId: 'test/test-model' });
    expect(res.status).toBe(202);
    const sessionId = (res.json as { sessionId: string }).sessionId;

    const status = await pollStatus(slug, sessionId);
    // Шаг создания маски — ok:false с причиной; LLM получила отказ и завершилась.
    expect(status.log[0].action).toBe('create_blockages_file');
    expect(status.log[0].ok).toBe(false);
    expect(status.log[0].summary).toContain('уже есть маска блокировок');
    // Ни одной LLM-маски в проекте; сессия завершилась (finish на базовом файле).
    expect(fs.readdirSync(path.join(ctx.ws, slug)).filter((n) => n.startsWith('blocked-llm-'))).toEqual([]);
    expect(status.state).toBe('done');
  });

  it('B. create_preset_file → run_generation {presetsFile}: regions в ответе, результат создан', async () => {
    const PRESET = 'RRR....\n..CCC..\n';
    const fake = await fakeLlm([
      JSON.stringify({ action: 'create_preset_file', args: { content: PRESET, reason: 'фиксация комнат и коридора' } }),
      (body) => {
        const maskFile = lastMaskFile(body, /"file":"(preset-llm-[0-9]{8}-[0-9]{6}(?:-[0-9]+)?\.txt)"/);
        return JSON.stringify({ action: 'run_generation', args: { presetsFile: maskFile, seed: 0 } });
      },
      (body) =>
        JSON.stringify({
          action: 'finish',
          args: { candidates: [{ file: lastResultFile(body), comment: 'с фиксированными областями' }] },
        }),
    ]);
    await writeLlmConfig(fake.url);
    const slug = await makeProject('llm-preset', SMALL_SPEC, SMALL_MASK);

    const res = await api(ctx, 'POST', `/api/projects/${slug}/llm-generate`, {
      prompt: 'зафиксируй области и сгенерируй',
      modelId: 'test/test-model',
    });
    expect(res.status).toBe(202);
    const sessionId = (res.json as { sessionId: string }).sessionId;

    const status = await pollStatus(slug, sessionId);
    expect(status.state).toBe('done');
    expect(status.log.map((l) => l.action)).toEqual(['create_preset_file', 'run_generation', 'finish']);
    expect(status.log.every((l) => l.ok)).toBe(true);

    // НОВЫЙ файл пресета с заданным содержимым.
    const presetFiles = fs.readdirSync(path.join(ctx.ws, slug)).filter((n) => n.startsWith('preset-llm-'));
    expect(presetFiles).toHaveLength(1);
    expect(fs.readFileSync(path.join(ctx.ws, slug, presetFiles[0]), 'utf8')).toBe(PRESET);

    // В ответе create_preset_file — regions (ROOM 3 клетки, CORRIDOR 3 клетки).
    const secondCall = fake.calls[1];
    const userMsg = secondCall.messages[secondCall.messages.length - 1].content;
    expect(userMsg).toContain('"regions"');
    expect(userMsg).toContain('"type":"ROOM"');
    expect(userMsg).toContain('"cells":3');
    expect(userMsg).toContain('"type":"CORRIDOR"');

    // Результат feasible (пресет не уменьшает F — цели 7/7 при F=14).
    expect(status.log[1].summary).not.toContain('infeasible');
    const file = status.candidates?.[0]?.file as string;
    await expect(fsp.access(path.join(ctx.ws, slug, file))).resolves.toBeUndefined();
  });

  it('C. стагнация: модель зациклена на одном run_generation → авто-done с note и кандидатами', async () => {
    const loop = JSON.stringify({ action: 'run_generation', args: { seed: 1 } });
    const fake = await fakeLlm(Array.from({ length: 10 }, () => loop));
    await writeLlmConfig(fake.url);
    const slug = await makeProject('llm-stagnation', SMALL_SPEC, SMALL_MASK);

    const res = await api(ctx, 'POST', `/api/projects/${slug}/llm-generate`, { prompt: 'генерируй', modelId: 'test/test-model' });
    expect(res.status).toBe(202);
    const sessionId = (res.json as { sessionId: string }).sessionId;

    const status = await pollStatus(slug, sessionId);
    // 3 идентичных исполняющих шага подряд — авто-завершение (finish LLM не вызывала).
    expect(status.state).toBe('done');
    expect(status.note).toBe(STAGNATION_NOTE);
    expect(status.log.map((l) => l.action)).toEqual(['run_generation', 'run_generation', 'run_generation']);
    // Кандидаты — ВСЕ созданные этой сессией файлы (в порядке создания).
    expect(status.candidates).toHaveLength(3);
    for (const [i, c] of status.candidates!.entries()) {
      expect(c.comment).toBe(`создан в шаге ${i + 1}`);
      await expect(fsp.access(path.join(ctx.ws, slug, c.file))).resolves.toBeUndefined();
    }

    // В журнале на диске — note и candidates.
    const journal = JSON.parse(await fsp.readFile(path.join(ctx.ws, slug, 'llm-sessions', `${sessionId}.json`), 'utf8'));
    expect(journal.note).toBe(STAGNATION_NOTE);
    expect(journal.candidates).toHaveLength(3);
  });

  it('7. очередь: вторая llm-generate при активной → 409; после завершения — старт возможен', async () => {
    const slug = await makeProject('llm-queue', SMALL_SPEC, SMALL_MASK);
    const base = await plainGenerate(slug);
    const finishReply = JSON.stringify({ action: 'finish', args: { candidates: [{ file: base.file, comment: 'готово' }] } });
    const fake = await fakeLlm([finishReply, finishReply], { delayMs: 1500 });
    await writeLlmConfig(fake.url);

    const r1 = await api(ctx, 'POST', `/api/projects/${slug}/llm-generate`, { prompt: 'первый', modelId: 'test/test-model' });
    expect(r1.status).toBe(202);
    const id1 = (r1.json as { sessionId: string }).sessionId;

    const r2 = await api(ctx, 'POST', `/api/projects/${slug}/llm-generate`, { prompt: 'второй', modelId: 'test/test-model' });
    expect(r2.status).toBe(409);
    expect((r2.json as { error: string }).error).toBe('LLM_SESSION_ACTIVE');

    const s1 = await pollStatus(slug, id1, 30_000);
    expect(s1.state).toBe('done');

    const r3 = await api(ctx, 'POST', `/api/projects/${slug}/llm-generate`, { prompt: 'третий', modelId: 'test/test-model' });
    expect(r3.status).toBe(202);
    const id3 = (r3.json as { sessionId: string }).sessionId;
    const s3 = await pollStatus(slug, id3, 30_000);
    expect(s3.state).toBe('done');

    // В списке — обе завершённые сессии.
    const list = await api(ctx, 'GET', `/api/projects/${slug}/llm-sessions`);
    expect((list.json as { sessions: unknown[] }).sessions).toHaveLength(2);
  });

  it('8. ошибки старта: 422 неизвестный провайдер, 503 не настроен, 400 тело', async () => {
    const fake = await fakeLlm([]);
    await writeLlmConfig(fake.url);
    const slug = await makeProject('llm-errors', SMALL_SPEC, SMALL_MASK);

    // modelId с провайдером вне конфигурации → 422.
    const r1 = await api(ctx, 'POST', `/api/projects/${slug}/llm-generate`, { prompt: 'x', modelId: 'other/model' });
    expect(r1.status).toBe(422);
    expect((r1.json as { error: string }).error).toBe('LLM_UNKNOWN_MODEL');

    // llm.config.json отсутствует → 503.
    process.env.LLM_CONFIG_PATH = path.join(cfgTmp!, 'missing.json');
    const r2 = await api(ctx, 'POST', `/api/projects/${slug}/llm-generate`, { prompt: 'x', modelId: 'test/test-model' });
    expect(r2.status).toBe(503);
    expect((r2.json as { error: string }).error).toBe('LLM_NOT_CONFIGURED');

    // Валидация тела → 400 (возвращаем конфиг).
    process.env.LLM_CONFIG_PATH = path.join(cfgTmp!, 'llm.config.json');
    const r3 = await api(ctx, 'POST', `/api/projects/${slug}/llm-generate`, { prompt: '', modelId: 'test/test-model' });
    expect(r3.status).toBe(400);
    expect((r3.json as { error: string }).error).toBe('LLM_INVALID_BODY');

    const r4 = await api(ctx, 'POST', `/api/projects/${slug}/llm-generate`, {
      prompt: 'x', modelId: 'test/test-model', limits: { maxIterations: 51 },
    });
    expect(r4.status).toBe(400);

    const r5 = await api(ctx, 'POST', `/api/projects/${slug}/llm-generate`, {
      prompt: 'x', modelId: 'test/test-model', limits: { bogus: 1 },
    });
    expect(r5.status).toBe(400);

    const r6 = await api(ctx, 'POST', `/api/projects/${slug}/llm-generate`, { prompt: 'x', modelId: 'no-slash' });
    expect(r6.status).toBe(400);

    // llm-status: неизвестная сессия → 404; без параметра → 400.
    const r7 = await api(ctx, 'GET', `/api/projects/${slug}/llm-status?session=19700101-000000`);
    expect(r7.status).toBe(404);
    expect((r7.json as { error: string }).error).toBe('LLM_NO_SESSION');
    const r8 = await api(ctx, 'GET', `/api/projects/${slug}/llm-status`);
    expect(r8.status).toBe(400);

    // llm-stop без активной сессии → 404 (журналов ещё нет).
    const r9 = await api(ctx, 'POST', `/api/projects/${slug}/llm-stop`);
    expect(r9.status).toBe(404);
    expect((r9.json as { error: string }).error).toBe('LLM_NO_SESSION');
  });
});
