// E6 (ТЗ 05 §4): горячие клавиши «2», затем «1» — без исключений в консоли браузера.
// Дополнительно (состояние UI, не позиция камеры): активный пресет на тулбаре
// меняется «Сверху» → «Изометрия».

import { test, expect } from '@playwright/test';
import { loadProjectReport } from './helpers';

/** Консольные сообщения WebGL/ANGLE/SwiftShader — штатный шум headless-рендера. */
const HARMLESS_CONSOLE = /WebGL|ANGLE|swiftshader|SwiftShader|three|THREE|drei|GPU|gl_loseContext|Vulkan/i;

test('E6: горячие клавиши 2 → 1', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !HARMLESS_CONSOLE.test(msg.text())) {
      consoleErrors.push(msg.text());
    }
  });

  // Проектный режим (docs-unified/04 §2): отчёт подгружается из mock API.
  await loadProjectReport(page, 'demo', [
    { name: 'result-20260913-000000.txt', fixture: 'report_basic.txt' },
  ]);

  const topBtn = page.getByRole('button', { name: 'Сверху', exact: true });
  const isoBtn = page.getByRole('button', { name: 'Изометрия', exact: true });

  // «2» — пресет «Сверху».
  await page.keyboard.press('2');
  await expect(topBtn).toHaveClass(/active/);
  await expect(isoBtn).not.toHaveClass(/active/);

  // «1» — обратно на изометрию.
  await page.keyboard.press('1');
  await expect(isoBtn).toHaveClass(/active/);
  await expect(topBtn).not.toHaveClass(/active/);

  // Исключений в консоли браузера нет.
  expect(pageErrors, `pageerror: ${pageErrors.join(' | ')}`).toEqual([]);
  expect(consoleErrors, `console.error: ${consoleErrors.join(' | ')}`).toEqual([]);
});
