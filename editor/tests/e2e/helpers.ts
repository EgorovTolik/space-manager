// Общие помощники e2e в проектном режиме (docs-unified/04-integrations.md §4):
// API единого сервиса мокнутся через page.route('/api/**') — реальный сервер не нужен;
// тела PUT …/files и порядок put/generate перехватываются для сверки.
import { expect, type Page } from '@playwright/test';
import { RESULT_FILE, REPORT_OK } from './fixtures';

export const APP_TITLE = 'Редактор конфигураций space-manager';

// ── Мок API (docs-unified/02 §6) ────────────────────────────────────────────────

/** Содержимое файлов проекта: 'spec.yaml' обязателен; маски — по их именам в спеке. */
export type MockFiles = Record<string, string>;

export interface CapturedApi {
  /** Тела PUT …/files (порядок вызовов). */
  puts: Record<string, string>[];
  /** Последовательность вызовов: 'put' | 'generate' (порядок — для проверки автосохранения). */
  events: ('put' | 'generate')[];
  /** Тела POST …/generate (порядок вызовов) — напр. {seed} (ST-3). */
  generateBodies: unknown[];
  /** Тела POST …/llm-generate (порядок вызовов, docs-llm/06 §1.2). */
  llmGenerateBodies: unknown[];
  /** Число вызовов POST …/llm-stop. */
  llmStops: number;
  /** Число вызовов GET …/llm-sessions (список; полный журнал не считается). */
  llmSessionsCalls: number;
}

/** Мок LLM-эндпоинтов (docs-llm/06 §1.1–§1.5). По умолчанию — {configured:false}. */
export interface MockLlm {
  /** Тело GET /api/llm/providers (по умолчанию { configured: false, reason: 'моk' }). */
  providers?: unknown;
  /** Ответ N-му POST …/llm-generate; по умолчанию 202 {sessionId}. */
  generate?: (i: number) => { status?: number; body: unknown };
  /** Ответ N-му вызову GET …/llm-status (N — с нуля, на текущую сессию).
   * Массив — последовательность, после исчерпания повторяется последний элемент. */
  status?: unknown[] | ((i: number) => unknown);
  /** Ответ N-му POST …/llm-stop; по умолчанию 200 {state:'stopping'}. */
  stop?: (i: number) => { status?: number; body: unknown };
  /** Список GET …/llm-sessions (newest-first); функция — по номеру вызова. По умолчанию []. */
  sessions?:
    | MockLlmSessionSummary[]
    | ((i: number) => MockLlmSessionSummary[]);
  /** Полные журналы GET …/llm-sessions/<id> по id. */
  sessionDetails?: Record<string, unknown>;
}

export interface MockLlmSessionSummary {
  sessionId: string;
  status: 'running' | 'done' | 'stopped' | 'error';
  modelId: string;
  promptPreview: string;
  startedAt: string;
  finishedAt: string | null;
}

export interface MockOpts {
  /** Дополнительные имена проектов в списке (для сценариев «не найден»). */
  extraProjects?: string[];
  /** Ответ на N-й POST …/generate. По умолчанию — feasible exit 0 с REPORT_OK. */
  generate?: (i: number) => { status?: number; body: unknown };
  /** Начальная история result-* проекта (`GET …/results`); после успешной
   *  генерации новая ревизия добавляется наверх (замечание 4). */
  results?: { name: string; mtimeIso: string }[];
  /** LLM-эндпоинты (docs-llm/06 §1); без параметра — {configured:false}. */
  llm?: MockLlm;
  /** Общий список типов (ST-2): тело GET /api/types-catalog.
   * Без параметра — пустой каталог { types: {} } (реальный сервер не нужен). */
  catalog?: Record<string, { symbol: string; name: string | null }>;
  /** Мутации каталога (ST-4): обработчик PATCH/DELETE /api/types-catalog/:id.
   * Без параметра — 200 с неизменным opts.catalog (реальный сервер не нужен). */
  catalogMutate?: (
    method: 'PATCH' | 'DELETE',
    id: string,
    body?: Record<string, unknown>,
  ) => { status?: number; body?: unknown };
}

export async function mockProject(
  page: Page,
  name: string,
  files: MockFiles,
  opts: MockOpts = {},
): Promise<CapturedApi> {
  const captured: CapturedApi = {
    puts: [],
    events: [],
    generateBodies: [],
    llmGenerateBodies: [],
    llmStops: 0,
    llmSessionsCalls: 0,
  };
  const llm = opts.llm ?? {};
  const statusArg = llm.status;
  const llmStatusFn: (i: number) => unknown = Array.isArray(statusArg)
    ? (i) => statusArg[Math.min(i, statusArg.length - 1)]
    : typeof statusArg === 'function'
      ? statusArg
      : () => ({ state: 'running', log: [], error: null, startedAt: '', finishedAt: null });
  let llmStatusCalls = 0;
  let llmStopCalls = 0;
  // Историю result-* храним в замыкании: успешная генерация добавляет ревизию наверх.
  let resultsList: { name: string; mtimeIso: string }[] = [...(opts.results ?? [])];
  const info = (n: string) => ({
    id: `id-${n}`,
    name: n,
    slug: n, // человекочитаемое имя и slug совпадают (замечание 2)
    createdAt: '2026-09-13T12:00:00.000Z',
    updatedAt: '2026-09-13T12:00:00.000Z',
    latestResult: null,
    sizeBytes: 123,
    resultsCount: 0,
    previewsCount: 0,
    filesCount: Object.keys(files).length,
  });

  await page.route('**/api/projects', (route) => {
    const json = (status: number, b: unknown) =>
      route.fulfill({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(b) });
    if (route.request().method() !== 'GET') return json(405, { error: 'METHOD_NOT_ALLOWED', message: 'метод не поддерживается' });
    const projects = [info(name), ...(opts.extraProjects ?? []).map(info)];
    return json(200, { projects });
  });

  await page.route(/\/api\/projects\/[^/]+\/file(\?|$)/, (route) => {
    const file = new URL(route.request().url()).searchParams.get('name') ?? '';
    if (Object.prototype.hasOwnProperty.call(files, file)) {
      return route.fulfill({ contentType: 'text/plain; charset=utf-8', body: files[file] });
    }
    return route.fulfill({
      status: 404,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ error: 'FILE_NOT_FOUND', message: `Файл «${file}» не найден` }),
    });
  });

  await page.route(/\/api\/projects\/[^/]+\/files/, (route) => {
    const json = (status: number, body: unknown) =>
      route.fulfill({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) });
    if (route.request().method() !== 'PUT') return json(405, { error: 'METHOD_NOT_ALLOWED', message: 'метод не поддерживается' });
    // postDataJSON() уже возвращает распарсенный объект.
    const body = (route.request().postDataJSON() ?? {}) as { files?: Record<string, string> };
    captured.puts.push(body.files ?? {});
    captured.events.push('put');
    return json(200, { saved: Object.keys(body.files ?? {}), deleted: [] });
  });

  await page.route(/\/api\/projects\/[^/]+\/results/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ results: resultsList }),
    }),
  );

  // ── LLM-эндпоинты (docs-llm/06 §1.1–§1.5) ─────────────────────────────────────
  await page.route('**/api/llm/providers', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(llm.providers ?? { configured: false, reason: 'мок' }),
    }),
  );

  await page.route(/\/api\/projects\/[^/]+\/llm-generate/, (route) => {
    captured.llmGenerateBodies.push(route.request().postDataJSON() ?? {});
    const resp = llm.generate ? llm.generate(captured.llmGenerateBodies.length - 1) : { status: 202, body: { sessionId: '20260913-120000' } };
    return route.fulfill({
      status: resp.status ?? 202,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(resp.body),
    });
  });

  await page.route(/\/api\/projects\/[^/]+\/llm-status/, (route) => {
    const i = llmStatusCalls++;
    return route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(llmStatusFn(i)),
    });
  });

  await page.route(/\/api\/projects\/[^/]+\/llm-stop/, (route) => {
    const resp = llm.stop ? llm.stop(llmStopCalls++) : { status: 200, body: { state: 'stopping' } };
    captured.llmStops += 1;
    return route.fulfill({
      status: resp.status ?? 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(resp.body),
    });
  });

  await page.route(/\/api\/projects\/[^/]+\/llm-sessions\/[^/]+$/, (route) => {
    const id = route.request().url().split('/').pop() ?? '';
    const details = llm.sessionDetails ?? {};
    if (Object.prototype.hasOwnProperty.call(details, id)) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify(details[id]),
      });
    }
    return route.fulfill({
      status: 404,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ error: 'LLM_NO_SESSION', message: `Сессия «${id}» не найдена` }),
    });
  });

  await page.route(/\/api\/projects\/[^/]+\/llm-sessions$/, (route) => {
    const list = typeof llm.sessions === 'function' ? llm.sessions(captured.llmSessionsCalls) : (llm.sessions ?? []);
    captured.llmSessionsCalls += 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ sessions: list }),
    });
  });

  // Общий список типов (ST-2): глобальный каталог, по умолчанию пустой.
  await page.route('**/api/types-catalog', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ types: opts.catalog ?? {} }),
    }),
  );

  // Мутации каталога (ST-4): PATCH/DELETE /api/types-catalog/:id.
  await page.route(/\/api\/types-catalog\/[^/]+$/, (route) => {
    const req = route.request();
    const method = req.method() as 'PATCH' | 'DELETE';
    if (method !== 'PATCH' && method !== 'DELETE') {
      return route.fulfill({
        status: 405,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ error: 'METHOD_NOT_ALLOWED', message: 'метод не поддерживается' }),
      });
    }
    const id = req.url().split('/').pop() ?? '';
    const body = method === 'PATCH' ? (req.postDataJSON() ?? {}) : undefined;
    const resp = opts.catalogMutate
      ? opts.catalogMutate(method, id, body)
      : { status: 200, body: { types: opts.catalog ?? {} } };
    return route.fulfill({
      status: resp.status ?? 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(resp.body),
    });
  });

  await page.route(/\/api\/projects\/[^/]+\/generate/, (route) => {
    const i = captured.events.filter((e) => e === 'generate').length;
    captured.events.push('generate');
    captured.generateBodies.push(route.request().postDataJSON() ?? {});
    const resp = opts.generate
      ? opts.generate(i)
      : { status: 200, body: { resultFile: RESULT_FILE, exitCode: 0, feasible: true, report: REPORT_OK } };
    // Успешная генерация (HTTP 200 + resultFile) → новая ревизия наверху списка.
    const body = resp.body as { resultFile?: unknown };
    if ((resp.status ?? 200) === 200 && typeof body.resultFile === 'string') {
      resultsList = [
        { name: body.resultFile, mtimeIso: '2026-09-13T12:05:00.000Z' },
        ...resultsList.filter((r) => r.name !== body.resultFile),
      ];
    }
    return route.fulfill({
      status: resp.status ?? 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(resp.body),
    });
  });

  return captured;
}

/** Выбор проекта в селекторе панели (aria-label «Проект»). */
export async function selectProject(page: Page, name: string): Promise<void> {
  const select = page.getByRole('combobox', { name: 'Проект' });
  await expect(select).toBeEnabled({ timeout: 10_000 }); // список проектов подгрузился
  await select.selectOption(name);
}

/** Дождаться загрузки проекта (кластеры появились в панели) — прокси индикатора. */
export function projectLoaded(page: Page, clusterId: string): Promise<void> {
  const clustersPanel = page.locator('section.panel', { has: page.getByRole('heading', { name: 'Кластеры' }) });
  return expect(clustersPanel.getByText(clusterId, { exact: true })).toBeVisible({ timeout: 10_000 });
}

/** Кнопка «💾 Сохранить в проект». */
export function saveBtn(page: Page) {
  return page.getByRole('button', { name: /Сохранить в проект/ });
}

/** Кнопка «⚡ Генерировать размещение». */
export function generateBtn(page: Page) {
  return page.getByRole('button', { name: /Генерировать размещение/ });
}

// ── Canvas (без изменений — ТЗ 06 §3) ───────────────────────────────────────────

/** Главный canvas сетки (первый canvas в центральной колонке; второй — миникарта). */
export function mainCanvas(page: Page) {
  return page.locator('main canvas').first();
}

/** Центр клетки (x, y) в координатах canvas при pan=0, zoom=1 (fit): cell = min(w/W, h/H). */
export async function cellCenter(page: Page, x: number, y: number, gridW: number, gridH: number) {
  const box = await mainCanvas(page).boundingBox();
  if (!box) throw new Error('canvas не найден');
  const cell = Math.min(box.width / gridW, box.height / gridH);
  return { x: (x + 0.5) * cell, y: (y + 0.5) * cell };
}

/** Клик по клетке (кисть/ластик — pointerdown, stroke flush через rAF). */
export async function clickCell(page: Page, x: number, y: number, gridW: number, gridH: number) {
  const pos = await cellCenter(page, x, y, gridW, gridH);
  await mainCanvas(page).click({ position: pos });
}

/** Дождаться сброса stroke'а в rAF и перерисовки. */
export function afterDraw(page: Page) {
  return page.waitForTimeout(250);
}

// ── Диалоги (confirm/alert) ─────────────────────────────────────────────────────

interface DialogPlan {
  /** 'accept' | 'dismiss' | null = не ожидается; при ожидании — проверка текста. */
  action: 'accept' | 'dismiss' | null;
  textContains?: string;
}

/**
 * Управляет диалогами страницы. plan.textContains — последовательно ожидаемые фрагменты
 * (shift из очереди); остальные confirm'ы обрабатываются по plan.action (по умолчанию accept).
 */
export function manageDialogs(page: Page, plan: DialogPlan = { action: 'accept' }) {
  const queue: string[] = plan.textContains ? [plan.textContains] : [];
  let seen: string[] = [];
  page.on('dialog', (d) => {
    seen.push(d.message());
    if (queue.length > 0) {
      const expected = queue.shift()!;
      expect(d.message()).toContain(expected);
      void d.accept();
      return;
    }
    if (plan.action === 'accept') void d.accept();
    else if (plan.action === 'dismiss') void d.dismiss();
  });
  return () => seen;
}

/** Строка статуса GridCanvas («x=… y=… · zoom …× · клеток всего W×H»). */
export function statusLine(page: Page) {
  return page.locator('main .panel > div:last-child span').first();
}
