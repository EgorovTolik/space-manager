// E4 (docs-unified/04 §2.4): PNG — НЕ скачивание на диск, а POST в preview/ проекта:
// перехватываем …/preview (page.route), проверяем тело запроса (PNG magic + размер),
// и статус-строку «Предпросмотр сохранён в проект: preview-<ts>.png» (5 с).

import { test, expect } from '@playwright/test';
import { loadProjectReport } from './helpers';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // \x89PNG

test('E4: PNG → POST …/preview (тело — валидный PNG), статус «Предпросмотр сохранён»', async ({ page }) => {
  const captured = await loadProjectReport(page, 'demo', [
    { name: 'result-20260913-000000.txt', fixture: 'report_basic.txt' },
  ]);

  // Скачиваний на диск быть НЕ должно (в проектном режиме fallback не используется).
  const downloads = new Set<string>();
  page.on('download', (d) => downloads.add(d.suggestedFilename()));

  await page.getByRole('button', { name: 'PNG' }).click();

  // POST preview выполнен ровно один раз, проект верный.
  await expect.poll(() => captured.previews.length).toBe(1);
  expect(captured.previews[0].project).toBe('demo');

  // Тело — валидный PNG (magic) с реальными размерами кадра.
  const body = captured.previews[0].body;
  expect(body.subarray(0, 4).equals(PNG_MAGIC)).toBe(true);
  expect(body.length).toBeGreaterThan(1024);

  // Статус в панели: «Предпросмотр сохранён в проект: preview-<ts>.png» (§2.4).
  const status = page.locator('.panel-files', { hasText: 'Предпросмотр сохранён в проект' }).first();
  await expect(status).toContainText('preview-20260913-000000.png');

  // …и исчезает через ~5 с («строка статуса на 5 секунд»).
  await expect(status).toHaveCount(0, { timeout: 8000 });

  // На диск ничего не скачалось.
  expect(downloads.size).toBe(0);
});

test('E4b: повторный PNG — новый POST (каждая кнопка = один предпросмотр)', async ({ page }) => {
  const captured = await loadProjectReport(page, 'demo', [
    { name: 'result-20260913-000000.txt', fixture: 'report_basic.txt' },
  ]);

  await page.getByRole('button', { name: 'PNG' }).click();
  await expect.poll(() => captured.previews.length).toBe(1);

  // Снимаем повторно — второй POST.
  await page.getByRole('button', { name: 'PNG' }).click();
  await expect.poll(() => captured.previews.length).toBe(2);
});
