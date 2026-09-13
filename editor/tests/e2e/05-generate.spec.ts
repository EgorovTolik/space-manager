// docs-unified/06 §3.7 + 04-integrations.md §1.6: «⚡ Генерировать размещение».
// - exit 0: зелёная строка с resultFile, ссылка Viewer3D (?project=&result=), details отчёта;
//   чистое состояние — POST без автосохранения (PUT не идёт);
// - dirty: сначала автосохранение (PUT до POST в порядке событий);
// - exit 1 (infeasible): красный заголовок + причина из блока до «== КАРТА ==»;
// - HTTP 422 SOLVER_INPUT: красный баннер с сообщением + подсказка про валидацию.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {
  afterDraw,
  clickCell,
  generateBtn,
  mockProject,
  saveBtn,
  selectProject,
} from './helpers';
import { EXAMPLES, REPORT_INFEASIBLE, RESULT_FILE, SPEC_10X10_MASKED } from './fixtures';
import { ru } from '../../src/i18n/ru';

const FILES = {
  'spec.yaml': SPEC_10X10_MASKED,
  'blocked.txt': readFileSync(EXAMPLES.blockedBasic, 'utf8'),
};

test.describe('Генерация размещения (docs-unified/04 §1.6)', () => {
  test('exit 0: зелёная строка, ссылка Viewer3D, details отчёта; PUT без автосохранения не идёт', async ({ page }) => {
    const cap = await mockProject(page, 'demo', FILES);
    await page.goto('/');
    await selectProject(page, 'demo');
    await expect(page.getByText('Ошибок валидации нет')).toBeVisible();

    await generateBtn(page).click();
    await expect(page.getByText(`Размещение найдено: ${RESULT_FILE}`)).toBeVisible({ timeout: 10_000 });

    // Чистое состояние — автосохранения не было.
    expect(cap.puts).toHaveLength(0);
    expect(cap.events).toEqual(['generate']);

    // Ссылка Viewer3D (docs-unified/04 §1.6): /viewer3d?project=demo&result=<file>.
    const link = page.getByRole('link', { name: 'Открыть в Viewer3D' });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', `/viewer3d?project=demo&result=${RESULT_FILE}`);

    // Details-блок отчёта солвера.
    await page.getByText('Отчёт солвера').click();
    await expect(page.locator('pre').getByText(/== ТАБЛИЦА/)).toBeVisible();
  });

  test('seed: ввод передаётся в тело POST; пустой seed → тело {} (ST-3)', async ({ page }) => {
    const cap = await mockProject(page, 'demo', FILES);
    await page.goto('/');
    await selectProject(page, 'demo');
    await expect(page.getByText('Ошибок валидации нет')).toBeVisible();

    // Пустой seed — флаг не передаётся (тело {}). 
    await generateBtn(page).click();
    await expect(page.getByText(`Размещение найдено: ${RESULT_FILE}`)).toBeVisible({ timeout: 10_000 });
    expect(cap.generateBodies[0]).toEqual({});

    // Введённый seed — в теле POST как число (genResult — единое состояние: ждём второй вызов).
    await page.getByRole('textbox', { name: 'Seed' }).fill('7');
    await generateBtn(page).click();
    await expect.poll(() => cap.events.filter((e) => e === 'generate').length, { timeout: 10_000 }).toBe(2);
    expect(cap.generateBodies[1]).toEqual({ seed: 7 });

    // Некорректный seed — локальная ошибка, POST не идёт.
    await page.getByRole('textbox', { name: 'Seed' }).fill('abc');
    await generateBtn(page).click();
    await expect(page.getByText(ru.project.seedInvalid)).toBeVisible();
    expect(cap.generateBodies.length).toBe(2);
  });

  test('dirty: автосохранение до POST (PUT → generate), изменение попало в PUT', async ({ page }) => {
    const cap = await mockProject(page, 'demo', FILES);
    await page.goto('/');
    await selectProject(page, 'demo');
    await expect(page.getByText('Ошибок валидации нет')).toBeVisible();

    // Загрязняем состояние: блокируем клетку (5,5).
    const W = 10,
      H = 10;
    await clickCell(page, 5, 5, W, H);
    await afterDraw(page);
    await expect(saveBtn(page)).toHaveText(/●/);

    await generateBtn(page).click();
    await expect(page.getByText(`Размещение найдено: ${RESULT_FILE}`)).toBeVisible({ timeout: 10_000 });

    // Автосохранение шло ПЕРЕД генерацией.
    expect(cap.events).toEqual(['put', 'generate']);
    const saved = cap.puts[0]['blocked.txt'];
    expect((saved.split('\n')[5] ?? '')[5]).toBe('*');

    // После автосохранения+генерации — чистое состояние.
    await expect(saveBtn(page)).not.toHaveText('●');
  });

  test('exit 1 (infeasible): красный заголовок + причина из блока до «== КАРТА ==»', async ({ page }) => {
    await mockProject(
      page,
      'demo',
      FILES,
      {
        generate: () => ({
          status: 200,
          body: { resultFile: RESULT_FILE, exitCode: 1, feasible: false, report: REPORT_INFEASIBLE },
        }),
      },
    );
    await page.goto('/');
    await selectProject(page, 'demo');
    await expect(page.getByText('Ошибок валидации нет')).toBeVisible();

    await generateBtn(page).click();

    // Красный заголовок + причина (строки отчёта до маркера «== КАРТА ==», без первой строки).
    // exact — полный отчёт в details содержит ту же фразу заглавными.
    await expect(
      page.getByText('Не удалось разместить все кластеры.', { exact: true }),
    ).toBeVisible({ timeout: 10_000 });
    // .first() — та же фраза есть и в details с полным отчётом.
    await expect(page.getByText(/Причина: не хватает места для кластера c2/).first()).toBeVisible();
    // Основной блок — только причина; карта остаётся в details с полным отчётом.
    const reasonPre = page.locator('pre').first();
    await expect(reasonPre).toContainText(/Причина:/);
    await expect(reasonPre).not.toContainText('== КАРТА ==');
  });

  test('HTTP 422 SOLVER_INPUT: баннер с сообщением + подсказка про валидацию', async ({ page }) => {
    await mockProject(
      page,
      'demo',
      FILES,
      {
        generate: () => ({
          status: 422,
          body: { error: 'SOLVER_INPUT', message: 'ОШИБКА ВХОДНЫХ ДАННЫХ: V-CLUST-SUM — сумма долей кластеров 110 %' },
        }),
      },
    );
    await page.goto('/');
    await selectProject(page, 'demo');

    await generateBtn(page).click();

    await expect(page.getByText(/Ошибка генерации:/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/ОШИБКА ВХОДНЫХ ДАННЫХ: V-CLUST-SUM/)).toBeVisible();
    await expect(page.getByText('Исправьте ошибки валидации и повторите')).toBeVisible();
  });
});
