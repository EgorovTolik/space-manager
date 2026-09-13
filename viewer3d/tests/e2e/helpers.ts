// Общие помощники e2e в проектном режиме (docs-unified/04-integrations.md §4):
// API единого сервиса мокнется через page.route('/api/**') — реальный сервер не
// нужен; файлы result-* отдаются из tests/fixtures. Все ожидания — по состоянию
// DOM, не по таймерам.

import { expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Каталог tests/e2e (specs исполняются как ESM — __dirname недоступен). */
export const E2E_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Фикстура отчёта: путь относительно корня viewer3d/. */
export function fixturePath(name: string): string {
  return path.join(E2E_DIR, '..', 'fixtures', name);
}

/** Содержимое фикстуры отчёта как текст. */
export function fixtureText(name: string): string {
  return fs.readFileSync(fixturePath(name), 'utf8');
}

// ── Мок API (docs-unified/02 §6) ────────────────────────────────────────────────

/** Ревизия проекта: имя result-* + текст отчёта. Порядок = порядок списка (свежая первая). */
export interface MockResult {
  name: string;
  text?: string; // если не задан — читается из фикстуры с тем же именем
  fixture?: string;
}

export interface MockViewerApi {
  /** Перехваченные POST …/preview (порядок вызовов): имя + тело PNG. */
  previews: Array<{ project: string; file: string; body: Buffer }>;
}

/**
 * Мок проектного API viewer3d: GET /api/projects, GET …/results,
 * GET …/file?name=result-*.txt, POST …/preview (201 {file}).
 */
export async function mockViewerApi(
  page: Page,
  projectName: string,
  results: MockResult[],
  extraProjects: string[] = [],
): Promise<MockViewerApi> {
  const captured: MockViewerApi = { previews: [] };
  const info = (n: string) => ({
    id: `id-${n}`,
    name: n,
    createdAt: '2026-09-13T12:00:00.000Z',
    updatedAt: '2026-09-13T12:00:00.000Z',
    latestResult: results[0]?.name ?? null,
    sizeBytes: 123,
    resultsCount: results.length,
    previewsCount: 0,
    filesCount: results.length + 1,
  });
  const textOf = (r: MockResult): string => r.text ?? fixtureText(r.fixture ?? r.name);

  await page.route('**/api/projects', (route) => {
    if (route.request().method() !== 'GET') {
      return route.fulfill({ status: 405, contentType: 'application/json', body: '{}' });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ projects: [info(projectName), ...extraProjects.map(info)] }),
    });
  });

  await page.route(/\/api\/projects\/[^/]+\/results/, (route) => {
    if (route.request().method() !== 'GET') {
      return route.fulfill({ status: 405, contentType: 'application/json', body: '{}' });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({
        results: results.map((r) => ({
          name: r.name,
          sizeBytes: textOf(r).length,
          mtimeIso: '2026-09-13T12:00:00.000Z',
        })),
      }),
    });
  });

  await page.route(/\/api\/projects\/[^/]+\/file(\?|$)/, (route) => {
    const file = new URL(route.request().url()).searchParams.get('name') ?? '';
    const found = results.find((r) => r.name === file);
    if (found !== undefined) {
      return route.fulfill({ contentType: 'text/plain; charset=utf-8', body: textOf(found) });
    }
    return route.fulfill({
      status: 404,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ error: 'FILE_NOT_FOUND', message: `Файл «${file}» не найден` }),
    });
  });

  // POST …/preview — сохранение PNG в проект (docs-unified/04 §2.4): 201 {file}.
  await page.route(/\/api\/projects\/([^/]+)\/preview$/, (route) => {
    const url = new URL(route.request().url());
    // …/api/projects/<p>/preview → проект = предпоследний сегмент pathname.
    const segments = url.pathname.split('/');
    const project = decodeURIComponent(segments[segments.length - 2] ?? '');
    const body = route.request().postDataBuffer();
    if (body !== null) {
      captured.previews.push({ project, file: 'preview-20260913-000000.png', body });
    }
    return route.fulfill({
      status: 201,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ file: 'preview-20260913-000000.png' }),
    });
  });

  return captured;
}

/** Выбрать проект в селекторе панели «Проект». */
export async function selectProject(page: Page, name: string): Promise<void> {
  const select = page.getByRole('combobox', { name: 'Проект' });
  await expect(select).toBeEnabled({ timeout: 5000 });
  await select.selectOption(name);
}

/** Выбрать ревизию в селекторе панели «Проект». */
export async function selectResult(page: Page, file: string): Promise<void> {
  const select = page.getByRole('combobox', { name: 'Файл результата (ревизия)' });
  await expect(select).toBeEnabled({ timeout: 5000 });
  await select.selectOption(file);
}

/** Строка статуса сцены («проект: p · файл: f · W×H клеток · S = … комнат: N · стен: M боксов»). */
export function statusLine(page: Page) {
  return page.locator('.status-line');
}

/** Число «стен: N боксов» из строки статуса. */
export async function wallBoxesCount(page: Page): Promise<number> {
  const text = await statusLine(page).textContent();
  const m = /стен: (\d+) боксов?/.exec(text ?? '');
  if (m === null) throw new Error(`в строке статуса нет числа боксов: "${text}"`);
  return Number.parseInt(m[1], 10);
}

/**
 * Мок API + выбор проекта и ожидание стабильного состояния UI по данным ревизии:
 * статус-список панели (сетка/комнат) + строка статуса сцены.
 */
export async function loadProjectReport(
  page: Page,
  projectName: string,
  results: MockResult[],
): Promise<MockViewerApi> {
  const captured = await mockViewerApi(page, projectName, results);
  await page.goto('/');
  await selectProject(page, projectName);
  // Панель переключается из «отчёт не загружен» в статус-список.
  await expect(page.locator('.panel-files .file-status')).toBeVisible();
  // Сцена построилась: строка статуса с размерами сетки и комнатами.
  await expect(statusLine(page)).toContainText(/клеток · S = /);
  // Стабилизация WebGL: R3F монтирует детей <Canvas> (включая SnapshotBinder —
  // регистрацию PNG-обработчика) в effect ПЕРВОЙ отрисовки, на ~десятки мс позже
  // появления строки статуса. Без паузы клик по «PNG» попадает до регистрации.
  await page.waitForTimeout(300);
  return captured;
}

/** Строчка таблицы комнат по метке (первая колонка — label). */
export function roomRow(page: Page, label: string) {
  return page.locator('.rooms-table tbody tr', { hasText: label }).first();
}
