// E4 (ТЗ 05 §4): кнопка PNG-снапшота — событие download, имя
// viewer3d-snapshot-<YYYYmmdd-HHMMSS>.png, файл непустой (валидный PNG).

import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import { loadReport } from './helpers';

test('E4: PNG-снапшот', async ({ page }) => {
  await page.goto('/');
  await loadReport(page, 'report_basic.txt');

  // Дождаться, пока сцена отрисовала хотя бы один кадр (подписи комнат рендерятся
  // в том же проходе): toBlob по canvas без отрисованного кадра вернёт null —
  // детерминированный сигнал «кадр есть» вместо таймера.
  await expect(page.locator('.room-label').first()).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'PNG', exact: true }).click(),
  ]);

  // Имя по формату ТЗ 04 §10.
  expect(download.suggestedFilename()).toMatch(/^viewer3d-snapshot-\d{8}-\d{6}\.png$/);

  // Файл непустой и это PNG (магические байты).
  const filePath = await download.path();
  if (filePath === undefined) throw new Error('download без локального файла');
  const buf = fs.readFileSync(filePath);
  expect(buf.length).toBeGreaterThan(100);
  expect(Array.from(buf.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
});
