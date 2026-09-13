// Замечание 4 (единый сервис): блок «Отчёты генераций» в ProjectFilesPanel —
// история result-* проекта (GET …/results, свежая первая):
// - пустой список → «Результатов пока нет»;
// - строка: имя + дата, «Открыть отчёт» (inline-раскрытие полного текста),
//   ссылка «В 3D» → /viewer3d?project=<slug>&result=<file>;
// - после успешной генерации блок обновляется: новая ревизия наверху.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { generateBtn, mockProject, selectProject } from './helpers';
import { EXAMPLES, REPORT_OK, RESULT_FILE, SPEC_10X10_MASKED } from './fixtures';

const FILES = {
  'spec.yaml': SPEC_10X10_MASKED,
  'blocked.txt': readFileSync(EXAMPLES.blockedBasic, 'utf8'),
};

// mtime — UTC-safe: 00:00Z остаётся «14.09.2026» в любом часовом поясе Земли.
const OLD_RESULT = 'result-20260913-100000.txt';
const OLD_MTIME = '2026-09-14T00:00:00.000Z';

test.describe('Отчёты генераций (замечание 4)', () => {
  test('пустой список → «Результатов пока нет»', async ({ page }) => {
    await mockProject(page, 'demo', FILES, { results: [] });
    await page.goto('/');
    await selectProject(page, 'demo');

    await expect(page.getByText('Отчёты генераций')).toBeVisible();
    await expect(page.getByText('Результатов пока нет')).toBeVisible({ timeout: 10_000 });
  });

  test('заполненный список: имя+дата, «В 3D» со slug в href, «Открыть отчёт» раскрывает текст', async ({ page }) => {
    await mockProject(
      page,
      'demo',
      { ...FILES, [OLD_RESULT]: REPORT_OK },
      { results: [{ name: OLD_RESULT, mtimeIso: OLD_MTIME }] },
    );
    await page.goto('/');
    await selectProject(page, 'demo');

    // Строка ревизии: имя + дата (14.09.2026 в ru-RU).
    const row = page.getByText(`${OLD_RESULT} ·`, { exact: false });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row).toContainText('14.09.2026');

    // Ссылка «В 3D»: slug проекта + имя файла.
    const link = page.getByRole('link', { name: 'В 3D' });
    await expect(link).toHaveAttribute('href', `/viewer3d?project=demo&result=${OLD_RESULT}`);

    // «Открыть отчёт» → inline-раскрытие полного текста (GET …/file?name=…).
    await page.getByRole('button', { name: 'Открыть отчёт' }).click();
    await expect(page.locator('pre').getByText(/== ТАБЛИЦА/)).toBeVisible({ timeout: 10_000 });

    // Повторный клик — сворачивание.
    await page.getByRole('button', { name: 'Свернуть отчёт' }).click();
    await expect(page.locator('pre').getByText(/== ТАБЛИЦА/)).not.toBeVisible();
  });

  test('после успешной генерации новая ревизия — наверху списка, ссылка ведёт в viewer3d', async ({ page }) => {
    await mockProject(
      page,
      'demo',
      FILES,
      { results: [{ name: OLD_RESULT, mtimeIso: OLD_MTIME }] },
    );
    await page.goto('/');
    await selectProject(page, 'demo');
    await expect(page.getByText(OLD_RESULT)).toBeVisible({ timeout: 10_000 });

    await generateBtn(page).click();
    await expect(page.getByText(`Размещение найдено: ${RESULT_FILE}`)).toBeVisible({ timeout: 10_000 });

    // Блок истории — внутренний div с заголовком (внутри общей section.panel);
    // обновился после генерации: новая ревизия выше старой.
    const history = page
      .locator('div')
      .filter({ has: page.getByText('Отчёты генераций', { exact: true }) })
      .last();
    const position = await history.evaluate(
      (sec, names) => {
        const spans = Array.from(sec.querySelectorAll('span')).map((s) => s.textContent ?? '');
        return {
          fresh: spans.findIndex((t) => t.includes(names.fresh)),
          old: spans.findIndex((t) => t.includes(names.old)),
        };
      },
      { fresh: RESULT_FILE, old: OLD_RESULT },
    );
    expect(position.fresh).toBeGreaterThanOrEqual(0);
    expect(position.old).toBeGreaterThanOrEqual(0);
    expect(position.fresh).toBeLessThan(position.old);

    // «В 3D» у свежей ревизии ведёт в viewer3d с её именем файла
    // (внутренняя строка — div, содержащий имя файла).
    const freshRow = history.locator('div').filter({ hasText: RESULT_FILE }).last();
    await expect(freshRow.getByRole('link', { name: 'В 3D' })).toHaveAttribute(
      'href',
      `/viewer3d?project=demo&result=${RESULT_FILE}`,
    );
  });
});
