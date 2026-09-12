// E2 (ТЗ 05 §4): клик по строке room1 — подсветка строки, InfoPanel с 650/ROOM1;
// повторный клик — выделение снято, InfoPanel скрыт («комната не выбрана»).

import { test, expect } from '@playwright/test';
import { loadReport, roomRow } from './helpers';

test('E2: выбор комнаты в списке', async ({ page }) => {
  await page.goto('/');
  await loadReport(page, 'report_basic.txt');

  const infoPanel = page.locator('.panel-info');
  // До выбора — заглушка.
  await expect(infoPanel).toContainText('комната не выбрана');

  const row = roomRow(page, 'room1');
  await row.click();

  // Строка подсвечена (class selected).
  await expect(row).toHaveClass(/selected/);

  // InfoPanel: метка, тип ROOM1 и «650» клеток.
  await expect(infoPanel.locator('strong')).toHaveText('room1');
  await expect(infoPanel).toContainText('тип ROOM1');
  await expect(infoPanel).toContainText('клеток: 650');

  // Повторный клик — выделение снято, InfoPanel возвращается в заглушку.
  await row.click();
  await expect(row).not.toHaveClass(/selected/);
  await expect(infoPanel).toContainText('комната не выбрана');
});
