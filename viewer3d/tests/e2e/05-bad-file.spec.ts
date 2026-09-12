// E5 (ТЗ 05 §4): загрузка файла с текстом «hello world» — баннер ошибки V-NO-MAP,
// правые панели неактивны, сцена пуста (плейсхолдер, нет подписей/объектов комнат).

import { test, expect } from '@playwright/test';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { E2E_DIR, reportFileInput } from './helpers';

test('E5: невалидный файл → V-NO-MAP', async ({ page }) => {
  // Файл с мусорным содержимым (не отчёт).
  const garbage = path.join(E2E_DIR, 'garbage.txt');
  fs.writeFileSync(garbage, 'hello world\n', 'utf8');

  await page.goto('/');
  await reportFileInput(page).setInputFiles(garbage);

  // Баннер ошибки парсинга с кодом V-NO-MAP и текстом «не найдена секция».
  const error = page.locator('.file-error');
  await expect(error).toBeVisible();
  await expect(error).toContainText('V-NO-MAP');
  await expect(error).toContainText('не найдена секция');

  // Состояние не изменилось: отчёт не загружен.
  await expect(page.locator('.panel-files')).toContainText('файл не загружен');

  // Правые панели неактивны (подсказка «Сначала загрузите отчёт»).
  await expect(page.locator('.panel-rooms')).toContainText('Сначала загрузите отчёт');
  await expect(page.locator('.panel-info')).toContainText('комната не выбрана');

  // Сцена пуста: плейсхолдер виден, объектов комнат в DOM нет.
  await expect(page.locator('.scene-placeholder')).toBeVisible();
  await expect(page.locator('.room-label')).toHaveCount(0);

  fs.rmSync(garbage, { force: true });
});
