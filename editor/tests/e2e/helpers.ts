// Общие помощники e2e в проектном режиме (docs-unified/04-integrations.md §4):
// API единого сервиса мокнутся через page.route('/api/**') — реальный сервер не нужен;
// тела PUT …/files и порядок put/generate перехватываются для сверки.
import { expect, type Page } from '@playwright/test';
import { RESULT_FILE, REPORT_OK } from './fixtures';

export const APP_TITLE = 'Редактор конфигураций spaec-manager';

// ── Мок API (docs-unified/02 §6) ────────────────────────────────────────────────

/** Содержимое файлов проекта: 'spec.yaml' обязателен; маски — по их именам в спеке. */
export type MockFiles = Record<string, string>;

export interface CapturedApi {
  /** Тела PUT …/files (порядок вызовов). */
  puts: Record<string, string>[];
  /** Последовательность вызовов: 'put' | 'generate' (порядок — для проверки автосохранения). */
  events: ('put' | 'generate')[];
}

export interface MockOpts {
  /** Дополнительные имена проектов в списке (для сценариев «не найден»). */
  extraProjects?: string[];
  /** Ответ на N-й POST …/generate. По умолчанию — feasible exit 0 с REPORT_OK. */
  generate?: (i: number) => { status?: number; body: unknown };
}

export async function mockProject(
  page: Page,
  name: string,
  files: MockFiles,
  opts: MockOpts = {},
): Promise<CapturedApi> {
  const captured: CapturedApi = { puts: [], events: [] };
  const info = (n: string) => ({
    id: `id-${n}`,
    name: n,
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

  await page.route(/\/api\/projects\/[^/]+\/generate/, (route) => {
    const i = captured.events.filter((e) => e === 'generate').length;
    captured.events.push('generate');
    const resp = opts.generate
      ? opts.generate(i)
      : { status: 200, body: { resultFile: RESULT_FILE, exitCode: 0, feasible: true, report: REPORT_OK } };
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
