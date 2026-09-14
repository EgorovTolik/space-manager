// Сквозной e2e «LLM-маски» (docs-llm 03 §8–§9, LST-7): реальный app-сервер
// (:3212, tmp-workspace, настоящий Python-солвер) + фейковый OpenAI-совместимый
// провайдер на эфемерном порту (паттерн 11-llm.spec.ts).
//
// Проект БЕЗ маски блокировок (spec.blockedFile: null, blocked.txt удалён через
// PUT /api/projects/:p/files) → доступен create_blockages_file.
//
// Сценарий 1: create_blockages_file (маска 20×14 с вертикальной стеной '*' в
// середине) → run_generation {blockagesFile: <имя из ответа>, seed} → finish.
// Проверки: blocked-llm-*.txt на диске, result feasible (exit 0), стена '*' и оба
// типа на карте, кандидаты в UI, журнал 3 шага + note ABSENT.
//
// Сценарий 2: create_preset_file (патчи типов R/h) → regions из ответа фейк
// использует в комментарии finish; run_generation {presetsFile} → finish.

import { test as base, expect } from '@playwright/test';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { e2eLlmConfigPath, e2eWorkspace } from './workspace';

const VENV_PYTHON = fileURLToPath(new URL('../../../.venv/bin/python', import.meta.url));
base.skip(!fs.existsSync(VENV_PYTHON), 'нет .venv/bin/python — реальный солвер недоступен');
const test = base;

const PROJECT = 'llm-masks';
const PROVIDER_ID = 'fake';
const MODEL_ID = 'Fake-35B';
const FULL_MODEL = `${PROVIDER_ID}/${MODEL_ID}`;

const W = 20;
const H = 14;
const projDir = path.join(e2eWorkspace, PROJECT);

/** result-файлы проекта, asc (старые первыми). */
const resultFilesAsc = (): string[] =>
  fs.readdirSync(projDir).filter((f) => /^result-.*\.txt$/.test(f)).sort();

// ── Спека проекта: 20×14, ROOM (R) + HALL (h), БЕЗ масок (blockedFile: null) ───
const SPEC_YAML = [
  'grid:',
  `  width: ${W}`,
  `  height: ${H}`,
  'blockedFile: null',
  'presetFile: null',
  'types:',
  '  ROOM: { symbol: "R", name: Комната }',
  '  HALL: { symbol: "h", name: Зал }',
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
  '    areaPercent: 55',
  '    shape: free',
  '  - id: hall1',
  '    type: HALL',
  '    areaPercent: 45',
  '    shape: free',
  '',
].join('\n');

/** Маска блокировок 20×14: вертикальная стена '*' в столбце x=9 (y=3..10). */
function blockagesMask(): string {
  const rows: string[] = [];
  for (let y = 0; y < H; y++) {
    let row = '';
    for (let x = 0; x < W; x++) row += x === 9 && y >= 3 && y <= 10 ? '*' : '.';
    rows.push(row);
  }
  return rows.join('\n');
}

/** Пресет 20×14: патч R слева сверху (x=0..8, y=0..1), патч h справа снизу (x=10..19, y=12..13). */
function presetMask(): string {
  const rows: string[] = [];
  for (let y = 0; y < H; y++) {
    let row = '';
    for (let x = 0; x < W; x++) {
      if (y <= 1 && x <= 8) row += 'R';
      else if (y >= 12 && x >= 10) row += 'h';
      else row += '.';
    }
    rows.push(row);
  }
  return rows.join('\n');
}

// ── Фейковый LLM: scripted-очередь ответов chat/completions ─────────────────────
type ScriptedStep = () => string;

let scripted: ScriptedStep[] = [];
const chatCalls: Array<Record<string, unknown>> = [];

/** Последнее содержимое user-сообщения (результат предыдущего действия сервера). */
function lastToolResult(): string {
  const req = chatCalls.at(-1);
  if (req === undefined) return '';
  const messages = (req.messages as Array<{ role: string; content: string }>) ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'user' && /Результат create_/.test(m.content)) return m.content;
  }
  return '';
}

/** Имя LLM-маски из ответа create_*_file (первое "file":"…txt" в результате). */
function maskFileFromLastResult(): string {
  const match = lastToolResult().match(/"file":\s*"([^"]+\.txt)"/);
  if (match === null) throw new Error('в ответе create_*_file не найдено имя файла');
  return match[1];
}

/** Сценарий 1: маска блокировок → генерация с ней → finish. */
function scriptBlockages(): ScriptedStep[] {
  return [
    () => JSON.stringify({ action: 'create_blockages_file', args: { content: blockagesMask(), reason: 'стена по центру — разделить сетку на комнату и зал' } }),
    () => JSON.stringify({ action: 'run_generation', args: { blockagesFile: maskFileFromLastResult(), seed: 7 } }),
    () => {
      const f = resultFilesAsc().at(-1)!;
      return JSON.stringify({
        action: 'finish',
        args: { candidates: [{ file: f, comment: 'стена из маски LLM разделяет зоны — размещение выполнимо' }], recommended: f },
      });
    },
  ];
}

/** Сценарий 2: пресет (regions из ответа) → генерация с ним → finish. */
function scriptPreset(): ScriptedStep[] {
  let regionsCount = -1;
  return [
    () => JSON.stringify({ action: 'create_preset_file', args: { content: presetMask(), reason: 'зафиксировать комнату слева и зал справа' } }),
    () => {
      // Полный объект результата {"file": …, "regions": […]} — фигурных скобок внутри нет,
      // поэтому жадный [^}]* корректно захватывает массив regions с вложенными bbox.
      const match = lastToolResult().match(/"file":\s*"[^"]+","regions":\s*(\[.*\])\}/);
      if (match !== null) regionsCount = JSON.parse(match[1] as string).length;
      return JSON.stringify({ action: 'run_generation', args: { presetsFile: maskFileFromLastResult(), seed: 3 } });
    },
    () => {
      const f = resultFilesAsc().at(-1)!;
      return JSON.stringify({
        action: 'finish',
        args: { candidates: [{ file: f, comment: `пресет из ${regionsCount} областей — неподвижные кластеры, размещение выполнимо` }], recommended: f },
      });
    },
  ];
}

// Служебные доступы для проверок диска.
let fakeServer: http.Server | null = null;
let fakePort = 0;

/** Строки карты из result-файла (после «== КАРТА ==», до пустого отступа). */
function mapLinesOf(file: string): string[] {
  const lines = fs.readFileSync(path.join(projDir, file), 'utf8').split('\n');
  const start = lines.findIndex((l) => l === '== КАРТА ==');
  expect(start).toBeGreaterThanOrEqual(0);
  const rest = lines.slice(start + 1);
  while (rest.length > 0 && rest[0].trim() === '') rest.shift(); // пустой отступ после заголовка
  const out: string[] = [];
  for (const l of rest) {
    if (l.trim() === '') break;
    out.push(l);
  }
  return out;
}

interface Journal {
  status: string;
  iterations: Array<{ n: number; action: string; ok: boolean; summary: string }>;
  candidates: Array<{ file: string; comment: string }>;
  recommended?: string;
  note?: string;
}

test.describe.serial('LLM-e2e (LST-7): create_blockages_file / create_preset_file', () => {
  test.setTimeout(180_000);

  test.beforeAll(() => {
    fakeServer = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname === '/v1/models' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ object: 'list', data: [{ id: MODEL_ID }] }));
        return;
      }
      if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          chatCalls.push(JSON.parse(body || '{}'));
          const step = scripted.shift();
          const content =
            step !== undefined ? step() : JSON.stringify({ action: 'finish', args: { candidates: [{ file: resultFilesAsc().at(-1)!, comment: 'fallback' }] } });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ id: 'fake-1', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }] }));
        });
        return;
      }
      res.writeHead(404);
      res.end('not found');
    });
    fakeServer.listen(0, '127.0.0.1', () => {
      fakePort = (fakeServer!.address() as { port: number }).port;
      fs.writeFileSync(
        e2eLlmConfigPath,
        JSON.stringify({ providers: { [PROVIDER_ID]: { url: `http://127.0.0.1:${fakePort}`, apiKey: 'test-key' } }, defaultModel: FULL_MODEL, labels: {} }),
        'utf8',
      );
    });
  });

  test.afterAll(() => {
    fakeServer?.close();
    fs.rmSync(e2eLlmConfigPath, { force: true });
    fs.rmSync(projDir, { recursive: true, force: true });
  });

  test('проект без маски блокировок (UI-создание + PUT спеки)', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Space Manager · проекты' })).toBeVisible();
    await page.getByRole('button', { name: '＋ Создать проект' }).first().click();
    await page.getByPlaceholder('имя проекта (напр., «Офис Б», до 64 символов)').fill(PROJECT);
    await page.getByRole('button', { name: 'Создать', exact: true }).click();
    const card = page.locator('.card', { hasText: PROJECT });
    await expect(card).toBeVisible();

    // Замена канонической тройки: ТОЛЬКО spec.yaml → blocked.txt/preset.txt удалены,
    // spec.blockedFile: null → create_blockages_file доступен.
    const put = await page.request.put(`/api/projects/${PROJECT}/files`, { data: { files: { 'spec.yaml': SPEC_YAML } } });
    expect(put.status()).toBe(200);
    const putBody = (await put.json()) as { saved: string[]; deleted: string[] };
    expect(putBody.saved).toEqual(['spec.yaml']);
    expect(putBody.deleted.sort()).toEqual(['blocked.txt', 'preset.txt']);
    expect(fs.existsSync(path.join(projDir, 'blocked.txt'))).toBe(false);
  });

  test('create_blockages_file → run_generation(blockagesFile) → finish: файл маски, feasible, кандидаты, журнал без note', async ({ page }) => {
    const callsBefore = chatCalls.length;
    scripted = scriptBlockages();

    await page.goto(`/editor?project=${PROJECT}`);
    await expect(page.getByRole('combobox', { name: 'Проект' })).toHaveValue(PROJECT, { timeout: 15_000 });
    const modelSelect = page.getByRole('combobox', { name: 'Модель' });
    await expect.poll(async () => modelSelect.inputValue(), { timeout: 20_000 }).toBe(FULL_MODEL);

    await page.getByLabel('Запрос для LLM').fill(
      'Создай маску блокировок с вертикальной стеной по центру и запусти генерацию с этой маской.',
    );
    await page.getByRole('button', { name: '▶ Запустить LLM-прогон' }).click();
    // Быстрый прогон может завершиться до первого опроса — принимаем оба состояния.
    await expect(page.getByText(/LLM-прогон выполняется…|Прогон завершён/)).toBeVisible();
    await expect(page.getByText('Прогон завершён')).toBeVisible({ timeout: 120_000 });

    // ── Файл маски на диске: blocked-llm-*.txt со стеной '*' ─────────────────────
    const blockageFiles = fs.readdirSync(projDir).filter((f) => /^blocked-llm-\d{8}-\d{6}(-\d+)?\.txt$/.test(f));
    expect(blockageFiles).toHaveLength(1);
    const maskText = fs.readFileSync(path.join(projDir, blockageFiles[0]), 'utf8').replace(/\r\n/g, '\n');
    expect(maskText).toBe(blockagesMask());

    // ── Result feasible: exit 0 в логе, стена '*' и оба типа на карте ─────────────
    const logBox = page.locator('.llm-log');
    await expect(logBox).toContainText(/1\. create_blockages_file — создана маска блокировок blocked-llm-[\w.-]+\.txt \(F: 280 → 272\) \(ок\)/);
    await expect(logBox).toContainText(/2\. run_generation — файл result-[\w.-]+\.txt \(exit 0\) \(ок\)/);
    await expect(logBox).toContainText(/3\. finish — завершено; кандидатов: 1 \(ок\)/);

    const results = resultFilesAsc();
    expect(results).toHaveLength(1);
    const map = mapLinesOf(results[0]);
    expect(map).toHaveLength(H);
    expect(map.every((l) => l.length === W)).toBe(true);
    // Стена: в каждой строке y=3..10 клетка x=9 — '*'.
    for (let y = 3; y <= 10; y++) expect(map[y][9]).toBe('*');
    const flat = map.join('');
    expect(flat).toContain('R');
    expect(flat).toContain('h');

    // ── Кандидаты в UI: один файл, «★ рекомендовано», ссылка Viewer3D ─────────────
    const viewerLink = page.getByRole('link', { name: 'Открыть в Viewer3D' });
    await expect(viewerLink).toHaveCount(1);
    await expect(viewerLink).toHaveAttribute('href', `/viewer3d?project=${PROJECT}&result=${results[0]}`);
    const recMark = page.locator('span').filter({ hasText: '★' }).filter({ hasText: 'рекомендовано' });
    await expect(recMark).toHaveCount(1);

    // ── Журнал: 3 шага, все ok, note ABSENT (finish вызван моделью) ───────────────
    const sessRes = await page.request.get(`/api/projects/${PROJECT}/llm-sessions`);
    const sessions = ((await sessRes.json()) as { sessions: Array<{ sessionId: string; status: string }> }).sessions;
    expect(sessions).toHaveLength(1);
    const journal = JSON.parse(fs.readFileSync(path.join(projDir, 'llm-sessions', `${sessions[0].sessionId}.json`), 'utf8')) as Journal;
    expect(journal.status).toBe('done');
    expect(journal.iterations.map((i) => i.action)).toEqual(['create_blockages_file', 'run_generation', 'finish']);
    expect(journal.iterations.every((i) => i.ok)).toBe(true);
    expect(journal.candidates).toHaveLength(1);
    expect(journal.recommended).toBe(results[0]);
    expect(journal.note).toBeUndefined();

    // Фейк: ровно 3 вызова chat/completions.
    expect(chatCalls.length - callsBefore).toBe(3);
  });

  test('create_preset_file → regions в ответе → run_generation(presetsFile) → finish', async ({ page }) => {
    const callsBefore = chatCalls.length;
    scripted = scriptPreset();

    await page.goto(`/editor?project=${PROJECT}`);
    await expect(page.getByRole('combobox', { name: 'Проект' })).toHaveValue(PROJECT, { timeout: 15_000 });
    const modelSelect = page.getByRole('combobox', { name: 'Модель' });
    await expect.poll(async () => modelSelect.inputValue(), { timeout: 20_000 }).toBe(FULL_MODEL);

    // История авто-раскрывает журнал последней сессии — сворачиваем, чтобы на странице
    // остался только live-блок (один .llm-log и одна ссылка Viewer3D).
    await page.getByRole('button', { name: 'Свернуть журнал' }).click();

    await page.getByLabel('Запрос для LLM').fill('Создай пресет с патчами комнаты и зала, запусти генерацию с ним и заверши.');
    await page.getByRole('button', { name: '▶ Запустить LLM-прогон' }).click();
    // Быстрый прогон может завершиться до первого опроса — принимаем оба состояния.
    await expect(page.getByText(/LLM-прогон выполняется…|Прогон завершён/)).toBeVisible();
    await expect(page.getByText('Прогон завершён')).toBeVisible({ timeout: 120_000 });

    // ── Файл пресета на диске: preset-llm-*.txt с патчами типов ───────────────────
    const presetFiles = fs.readdirSync(projDir).filter((f) => /^preset-llm-\d{8}-\d{6}(-\d+)?\.txt$/.test(f));
    expect(presetFiles).toHaveLength(1);
    expect(fs.readFileSync(path.join(projDir, presetFiles[0]), 'utf8').replace(/\r\n/g, '\n')).toBe(presetMask());

    // ── Лог: 3 шага; новый result-файл (exit 0) ───────────────────────────────────
    const logBox = page.locator('.llm-log');
    await expect(logBox).toContainText(/1\. create_preset_file — создан пресет preset-llm-[\w.-]+\.txt \(2 обл\.\) \(ок\)/);
    await expect(logBox).toContainText(/2\. run_generation — файл result-[\w.-]+\.txt \(exit 0\) \(ок\)/);

    const results = resultFilesAsc();
    expect(results).toHaveLength(2);
    expect(mapLinesOf(results[1]).join('')).toContain('R');

    // ── Кандидаты: один (из этой сессии), comment использует regions из ответа ────
    await expect(page.getByRole('link', { name: 'Открыть в Viewer3D' })).toHaveCount(1);
    const sessRes = await page.request.get(`/api/projects/${PROJECT}/llm-sessions`);
    const sessions = ((await sessRes.json()) as { sessions: Array<{ sessionId: string; status: string }> }).sessions;
    expect(sessions).toHaveLength(2); // newest-first: [сессия 2, сессия 1]
    const journal = JSON.parse(fs.readFileSync(path.join(projDir, 'llm-sessions', `${sessions[0].sessionId}.json`), 'utf8')) as Journal;
    expect(journal.status).toBe('done');
    expect(journal.iterations.map((i) => i.action)).toEqual(['create_preset_file', 'run_generation', 'finish']);
    expect(journal.iterations.every((i) => i.ok)).toBe(true);
    expect(journal.candidates[0]?.comment).toContain('2 областей');
    expect(journal.recommended).toBe(results[1]);
    expect(journal.note).toBeUndefined();

    expect(chatCalls.length - callsBefore).toBe(3);
  });
});
