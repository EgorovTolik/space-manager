// Общие помощники e2e-сценариев (ТЗ 05 §4).
// Загрузка отчёта — setInputFiles на скрытый input[type=file] FilePanel (тот же
// механизм, что у editor/). Все ожидания — по состоянию DOM, не по таймерам.

import { expect, type Page } from '@playwright/test';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Каталог tests/e2e (specs исполняются как ESM — __dirname недоступен). */
export const E2E_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Фикстура отчёта: путь относительно корня viewer3d/. */
export function fixturePath(name: string): string {
  return path.join(E2E_DIR, '..', 'fixtures', name);
}

/** Скрытый file-input FilePanel (accept=".txt,text/plain"). */
export function reportFileInput(page: Page) {
  return page.locator('input[type=file][accept*=".txt"]');
}

/** Строка статуса сцены («50×50 клеток · S = … комнат: N · стен: M боксов»). */
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
 * Загрузить отчёт и дождаться, пока состояние UI станет стабильным по его данным:
 * статус-список FilePanel (сетка/комнат) + строка статуса сцены.
 */
export async function loadReport(page: Page, fileName: string): Promise<void> {
  await reportFileInput(page).setInputFiles(fixturePath(fileName));
  // FilePanel переключается из «файл не загружен» в статус-список.
  await expect(page.locator('.panel-files .file-status')).toBeVisible();
  // Сцена построилась: строка статуса с размерами сетки и комнатами.
  await expect(statusLine(page)).toContainText(/клеток · S = /);
}

/** Строчка таблицы комнат по метке (первая колонка — label). */
export function roomRow(page: Page, label: string) {
  return page.locator('.rooms-table tbody tr', { hasText: label }).first();
}
