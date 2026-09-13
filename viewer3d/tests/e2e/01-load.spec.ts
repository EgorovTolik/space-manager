// E1 (ТЗ 05 §4, docs-unified/04 §2.3): выбор проекта → свежая ревизия подгружается
// с API-мока: список комнат, типы, клетки, строка статуса «проект · файл», canvas,
// отсутствие баннеров ошибок.

import { test, expect } from '@playwright/test';
import { loadProjectReport, statusLine } from './helpers';

const RESULT_NAME = 'result-20260913-000000.txt';

test('E1: выбор проекта → ревизия report_basic', async ({ page }) => {
  await loadProjectReport(page, 'demo', [{ name: RESULT_NAME, fixture: 'report_basic.txt' }]);

  // В списке комнат ровно 3 строки.
  const rows = page.locator('.rooms-table tbody tr');
  await expect(rows).toHaveCount(3);

  // Метки / клетки / типы — как в ТЗ (компоненты R/W/C → room1/room2/corridor1).
  const expected: Array<{ label: string; cells: string; type: string }> = [
    { label: 'room1', cells: '650', type: 'ROOM1' },
    { label: 'room2', cells: '375', type: 'ROOM2' },
    { label: 'corridor1', cells: '225', type: 'CORRIDOR' },
  ];
  const actual = await rows.evaluateAll((trs) =>
    trs.map((tr) => {
      const tds = Array.from(tr.querySelectorAll('td'));
      return {
        label: tds[0]?.textContent?.trim() ?? '',
        cells: tds[3]?.textContent?.trim() ?? '',
        type: tds[2]?.textContent?.trim() ?? '',
      };
    }),
  );
  expect(actual).toEqual(expected);

  // Строка статуса: префикс проект/файл (docs-unified/04 §2.2) + «50×50 … комнат: 3».
  await expect(statusLine(page)).toContainText(`проект: demo · файл: ${RESULT_NAME}`);
  await expect(statusLine(page)).toContainText('50×50');
  await expect(statusLine(page)).toContainText('комнат: 3');

  // Статус панели «Проект»: имя файла (docs-unified/04 §2.3).
  await expect(page.locator('.panel-files .file-status')).toContainText(RESULT_NAME);

  // Canvas сцены существует.
  await expect(page.locator('main canvas').first()).toBeVisible();

  // Баннеров ошибок и предупреждений нет (issues пуст, «ПРЕДУПРЕЖДЕНИЯ: нет»).
  await expect(page.locator('.file-error')).toHaveCount(0);
  await expect(page.locator('.warnings-banner')).toHaveCount(0);
});
