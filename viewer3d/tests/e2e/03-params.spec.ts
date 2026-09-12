// E3 (ТЗ 05 §4): смена параметров (толщина → 0.5, масштаб → 2) — после debounce
// нет ошибок в UI, список комнат не изменился, число боксов стен в строке статуса
// не изменилось (от T/S зависит размер боксов, не их количество — ТЗ 03 §6).

import { test, expect } from '@playwright/test';
import { loadReport, statusLine, wallBoxesCount } from './helpers';

test('E3: смена толщины и масштаба', async ({ page }) => {
  await page.goto('/');
  await loadReport(page, 'report_basic.txt');

  const rows = page.locator('.rooms-table tbody tr');
  const before = await rows.evaluateAll((trs) =>
    trs.map((tr) => {
      const tds = Array.from(tr.querySelectorAll('td'));
      return [tds[0]?.textContent?.trim(), tds[3]?.textContent?.trim()];
    }),
  );
  const boxesBefore = await wallBoxesCount(page);

  // id'ы инпутов ParamsPanel: param-scale / param-wallHeight / param-wallThickness.
  await page.locator('#param-wallThickness').fill('0.5');
  await page.locator('#param-scale').fill('2');

  // Строка статуса отражает новый масштаб (состояние UI стабильно).
  await expect(statusLine(page)).toContainText('S = 2 м/клетку');

  // Ошибок в UI нет.
  await expect(page.locator('.file-error')).toHaveCount(0);
  await expect(page.locator('.warnings-banner')).toHaveCount(0);

  // Список комнат не изменился (параметры отображения не меняют отчёт).
  const after = await rows.evaluateAll((trs) =>
    trs.map((tr) => {
      const tds = Array.from(tr.querySelectorAll('td'));
      return [tds[0]?.textContent?.trim(), tds[3]?.textContent?.trim()];
    }),
  );
  expect(after).toEqual(before);

  // Число боксов не изменилось (только размеры — ТЗ 03 §6).
  expect(await wallBoxesCount(page)).toBe(boxesBefore);
});
