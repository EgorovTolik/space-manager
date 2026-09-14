// Сквозной e2e «LLM-управление генерацией» (docs-llm 07 §4.3): РЕАЛЬНЫЙ app-сервер
// (webServer :3212, tmp-workspace, настоящий Python-солвер из .venv) + ФЕЙКОВЫЙ
// OpenAI-совместимый LLM-провайдер (scripted GET /v1/models и POST /v1/chat/completions
// на эфемерном порту; конфиг — через env LLM_CONFIG_PATH, hot-reload сервером).
//
// Браузер: менеджер → создать проект → редактор: промпт + модель + «Запустить» →
// дождаться done → лог шагов (run_generation → read_result → run_generation → finish),
// два кандидата со звёздочкой «рекомендовано» и ссылками Viewer3D, result-файлы в
// истории проекта, журнал llm-sessions/<sessionId>.json на диске (status done).
//
// Детерминизм: scripted-ответы фейка; scripted-функции читают имена result-файлов
// с диска в момент вызова (имена несут timestamp сервера и заранее неизвестны).

import { test as base, expect } from '@playwright/test';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { e2eLlmConfigPath, e2eWorkspace } from './workspace';

// При отсутствии venv — пропуск файла (реальный солвер недоступен), паттерн 10-full-flow.
const VENV_PYTHON = fileURLToPath(new URL('../../../.venv/bin/python', import.meta.url));
base.skip(!fs.existsSync(VENV_PYTHON), 'нет .venv/bin/python — реальный солвер недоступен');
const test = base;

const PROJECT = 'llm-demo';
const PROVIDER_ID = 'fake';
const MODEL_ID = 'Fake-35B';
const FULL_MODEL = `${PROVIDER_ID}/${MODEL_ID}`;

const projDir = path.join(e2eWorkspace, PROJECT);
/** result-файлы проекта, asc (старые первыми). */
const resultFilesAsc = (): string[] =>
  fs.readdirSync(projDir).filter((f) => /^result-.*\.txt$/.test(f)).sort();

// ── Фейковый LLM: scripted-очередь ответов chat/completions ─────────────────────
type ScriptedStep = () => string;

let scripted: ScriptedStep[] = [];
const chatCalls: Array<Record<string, unknown>> = []; // история запросов (для отладки)

/** Полный сценарий прогона: 2 запуска, чтение отчёта, finish с двумя кандидатами. */
function freshScript(): ScriptedStep[] {
  return [
    () => JSON.stringify({ action: 'run_generation', args: { seed: 7 } }),
    () => JSON.stringify({ action: 'read_result', args: { file: resultFilesAsc().at(-1)! } }),
    () => JSON.stringify({ action: 'run_generation', args: { seed: 42 } }),
    () => {
      const [f1, f2] = resultFilesAsc();
      return JSON.stringify({
        action: 'finish',
        args: {
          candidates: [
            { file: f1, comment: 'вариант с seed 7 — базовое размещение' },
            { file: f2, comment: 'вариант с seed 42 — более компактные комнаты (рекомендуемый)' },
          ],
          recommended: f2,
        },
      });
    },
  ];
}

let fakeServer: http.Server | null = null;
let fakePort = 0;

test.describe.serial('LLM-e2e: реальный сервер + фейковый провайдер → UI', () => {
  test.setTimeout(180_000);

  test.beforeAll(() => {
    scripted = freshScript();
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
          res.end(
            JSON.stringify({
              id: 'fake-1',
              object: 'chat.completion',
              choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
            }),
          );
        });
        return;
      }
      res.writeHead(404);
      res.end('not found');
    });
    fakeServer.listen(0, '127.0.0.1', () => {
      fakePort = (fakeServer!.address() as { port: number }).port;
      // Конфиг с ОДНИМ провайдером; сервер перечитывает его при каждом обращении (hot-reload).
      fs.writeFileSync(
        e2eLlmConfigPath,
        JSON.stringify({
          providers: { [PROVIDER_ID]: { url: `http://127.0.0.1:${fakePort}`, apiKey: 'test-key' } },
          defaultModel: FULL_MODEL,
          labels: {},
        }),
        'utf8',
      );
    });
  });

  test.afterAll(() => {
    fakeServer?.close();
    fs.rmSync(e2eLlmConfigPath, { force: true }); // не мешать следующим прогонам (configured:false)
    fs.rmSync(projDir, { recursive: true, force: true });
  });

  test('создание проекта через менеджер', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Space Manager · проекты' })).toBeVisible();
    await page.getByRole('button', { name: '＋ Создать проект' }).first().click();
    await page.getByPlaceholder('имя проекта (напр., «Офис Б», до 64 символов)').fill(PROJECT);
    await page.getByRole('button', { name: 'Создать', exact: true }).click();
    const card = page.locator('.card', { hasText: PROJECT });
    await expect(card).toBeVisible();
    await expect(card.getByText('файлов: 3 · результатов: 0')).toBeVisible();
  });

  test('LLM-панель: промпт → запуск → done → лог, кандидаты, история, журнал', async ({ page }) => {
    // ── Открыть редактор; панель LLM настроена (конфиг уже на диске) ─────────────
    await page.goto(`/editor?project=${PROJECT}`);
    await expect(page.getByRole('combobox', { name: 'Проект' })).toHaveValue(PROJECT, { timeout: 15_000 });
    await expect(page.getByText('LLM-генерация', { exact: true })).toBeVisible({ timeout: 15_000 });

    // Модель: авто-опрос фейка /v1/models, defaultModel выбран по умолчанию.
    const modelSelect = page.getByRole('combobox', { name: 'Модель' });
    await expect.poll(async () => modelSelect.inputValue(), { timeout: 20_000 }).toBe(FULL_MODEL);

    // Промпт и запуск (лимиты пустые — дефолты сервера, в тело не передаются).
    await page.getByLabel('Запрос для LLM').fill('Сделай два запуска с разными seed и выбери лучший.');
    await expect(page.getByRole('button', { name: '▶ Запустить LLM-прогон' })).toBeEnabled();
    await page.getByRole('button', { name: '▶ Запустить LLM-прогон' }).click();

    // Живой режим → терминальное done (солвер на 20×20 — доли секунды, фейк отвечает сразу).
    await expect(page.getByText('LLM-прогон выполняется…')).toBeVisible();
    await expect(page.getByText('Прогон завершён')).toBeVisible({ timeout: 120_000 });

    // ── Лог шагов: 4 строки «N. action — summary (ок)» (один <pre> панели LLM) ───
    const logPre = page.locator('pre').filter({ hasText: 'run_generation' });
    await expect(logPre).toHaveCount(1);
    await expect(logPre).toContainText(/1\. run_generation — файл result-[\w.-]+\.txt \(exit 0\) \(ок\)/);
    await expect(logPre).toContainText(/2\. read_result — отчёт «result-[\w.-]+\.txt» прочитан \(ок\)/);
    await expect(logPre).toContainText(/3\. run_generation — файл result-[\w.-]+\.txt \(exit 0\) \(ок\)/);
    await expect(logPre).toContainText(/4\. finish — завершено; кандидатов: 2 \(ок\)/);

    // ── Кандидаты: два файла, у одного «рекомендовано», ссылки Viewer3D ──────────
    const [f1, f2] = resultFilesAsc();
    expect(f1).not.toBe(f2);
    const viewerLinks = page.getByRole('link', { name: 'Открыть в Viewer3D' });
    await expect(viewerLinks).toHaveCount(2);
    // recommended (seed 42) = второй по имени файл — отметка «★ рекомендовано» одна,
    // и в её строке лежит именно этот файл.
    const recMark = page.locator('span').filter({ hasText: '★' }).filter({ hasText: 'рекомендовано' });
    await expect(recMark).toHaveCount(1);
    await expect(recMark.locator('xpath=..')).toContainText(f2);
    const hrefs = (await viewerLinks.evaluateAll((els) => els.map((e) => e.getAttribute('href')))).sort();
    expect(hrefs).toEqual(
      [
        `/viewer3d?project=${PROJECT}&result=${f1}`,
        `/viewer3d?project=${PROJECT}&result=${f2}`,
      ].sort(),
    );

    // ── История проекта: оба result-файла; latestResult = последний запуск ───────
    const resRes = await page.request.get(`/api/projects/${PROJECT}/results`);
    expect(resRes.status()).toBe(200);
    const results = (await resRes.json()) as { results: Array<{ name: string }> };
    expect(results.results.map((r) => r.name).sort()).toEqual([f1, f2]);
    // latestResult = последний запуск. Запуски могут попасть в одну секунду
    // (nextResultName дописывает суффикс «-1», который лексикографически раньше точки),
    // поэтому «последний» определяем по mtime, а не по имени.
    const latestByMtime = [f1, f2].sort(
      (a, b) => fs.statSync(path.join(projDir, b)).mtimeMs - fs.statSync(path.join(projDir, a)).mtimeMs,
    )[0];
    const meta = JSON.parse(fs.readFileSync(path.join(projDir, 'project.json'), 'utf8')) as {
      latestResult: string;
    };
    expect(meta.latestResult).toBe(latestByMtime);

    // ── Журнал сессии на диске (docs-llm 05 §5) ──────────────────────────────────
    const sessRes = await page.request.get(`/api/projects/${PROJECT}/llm-sessions`);
    expect(sessRes.status()).toBe(200);
    const sessions = (await sessRes.json()) as {
      sessions: Array<{ sessionId: string; status: string }>;
    };
    expect(sessions.sessions).toHaveLength(1);
    expect(sessions.sessions[0].status).toBe('done');
    const journalPath = path.join(projDir, 'llm-sessions', `${sessions.sessions[0].sessionId}.json`);
    expect(fs.existsSync(journalPath)).toBe(true);
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as {
      status: string;
      modelId: string;
      iterations: Array<{ n: number; action: string; ok: boolean }>;
      candidates: Array<{ file: string; comment: string }>;
      recommended?: string;
    };
    expect(journal.status).toBe('done');
    expect(journal.modelId).toBe(FULL_MODEL);
    expect(journal.iterations.map((i) => i.action)).toEqual([
      'run_generation',
      'read_result',
      'run_generation',
      'finish',
    ]);
    expect(journal.iterations.every((i) => i.ok)).toBe(true);
    expect(journal.candidates).toHaveLength(2);
    expect(journal.recommended).toBe(f2);

    // Служебная проверка фейка: ровно 4 вызова chat/completions, модель — наша.
    expect(chatCalls).toHaveLength(4);
    for (const c of chatCalls) expect(c.model).toBe(FULL_MODEL);
  });
});
