// E5 (docs-unified/04 §2.3): ошибки загрузки — баннер, состояние не меняется:
// а) битый текст ревизии → баннер «Ошибка разбора отчёта» с кодом;
// б) ошибка API (HTTP 500 на file) → баннер с сообщением из JSON; сцена прежняя.

import { test, expect } from '@playwright/test';
import { mockViewerApi, selectProject, statusLine } from './helpers';

const GOOD = 'result-20260913-000000.txt';
const BAD = 'result-20260901-000000.txt';

test('E5a: битая ревизия — баннер разбора, прежняя сцена не теряется', async ({ page }) => {
  await mockViewerApi(page, 'demo', [
    { name: GOOD, fixture: 'report_basic.txt' },
    { name: BAD, text: 'просто текст без секций' },
  ]);
  await page.goto('/');
  await selectProject(page, 'demo');

  // Свежая (корректная) ревизия загружена.
  await expect(statusLine(page)).toContainText(`файл: ${GOOD}`);

  // Переключаемся на битую ревизию → баннер ошибки разбора.
  const revSelect = page.getByRole('combobox', { name: 'Файл результата (ревизия)' });
  await revSelect.selectOption(BAD);
  await expect(page.locator('.file-error')).toContainText('Ошибка разбора отчёта');

  // Сцена НЕ сброшена — прежняя корректная ревизия на месте (§2.3: состояние не сбрасывается).
  await expect(statusLine(page)).toContainText(`файл: ${GOOD}`);
  await expect(page.locator('.rooms-table tbody tr')).toHaveCount(3);
});

test('E5b: ошибка API при чтении файла — баннер с сообщением, состояние не сбрасывается', async ({ page }) => {
  // Мок: список содержит GOOD и ERR, но файл ERR отдаётся с HTTP 500.
  await mockViewerApi(page, 'demo', [
    { name: GOOD, fixture: 'report_basic.txt' },
    { name: BAD, text: 'заменено ошибкой' },
  ]);
  // Догружаем перехват ошибки ТОЛЬКО для файла ERR (поздний route = больший приоритет).
  await page.route(/\/api\/projects\/demo\/file\?name=result-20260901-000000\.txt$/, (route) => {
    return route.fulfill({
      status: 500,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ error: 'INTERNAL', message: 'Внутренняя ошибка сервера' }),
    });
  });

  await page.goto('/');
  await selectProject(page, 'demo');
  await expect(statusLine(page)).toContainText(`файл: ${GOOD}`);

  const revSelect = page.getByRole('combobox', { name: 'Файл результата (ревизия)' });
  await revSelect.selectOption(BAD);

  // Баннер с сообщением из JSON-ошибки API.
  await expect(page.locator('.file-error')).toContainText('Внутренняя ошибка сервера');

  // Прежняя сцена не потеряна.
  await expect(statusLine(page)).toContainText(`файл: ${GOOD}`);
});
