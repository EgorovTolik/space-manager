// docs-unified/06 §3.1: выбор проекта → панели заполнились (типы/кластеры/правила),
// canvas отрисовал сетку; V-MASK-DIM при размере маски ≠ сетке; URL ?project= (§1.8).
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { APP_TITLE, generateBtn, mainCanvas, mockProject, selectProject, statusLine } from './helpers';
import { EXAMPLES, SPEC_50X50 } from './fixtures';

const FILES = {
  'spec.yaml': SPEC_50X50,
  // маска 10×10 к сетке 50×50 → V-MASK-DIM (docs-unified/04 §1.3)
  'blocked.txt': readFileSync(EXAMPLES.blockedBasic, 'utf8'),
};

test.describe('Загрузка проекта (docs-unified/04 §1.3)', () => {
  test('выбор проекта → панели заполнились, canvas отрисован, V-MASK-DIM в баннере', async ({ page }) => {
    await mockProject(page, 'demo', FILES);
    await page.goto('/');
    await expect(page).toHaveTitle(/.+/);
    await expect(page.getByRole('heading', { name: APP_TITLE })).toBeVisible();

    // Тулбар: самая левая кнопка — зелёная «К проектам» (менеджер, /) — замечание 1.
    const toProjects = page.getByRole('link', { name: 'К проектам' });
    await expect(toProjects).toHaveAttribute('href', '/');
    // Кнопка левее заголовка (порядок элементов тулбара).
    await expect(toProjects.evaluate((el) => el.parentElement!.firstElementChild === el)).toBeTruthy();

    // До проекта: правые панели заблокированы, подпись «Сначала загрузите спекацию».
    await expect(page.getByText('Сначала загрузите спекацию').first()).toBeVisible();

    await selectProject(page, 'demo');

    // Табы появились.
    for (const tab of ['Кластеры', 'Типы', 'Правила']) {
      await expect(page.getByRole('button', { name: tab, exact: true }).first()).toBeVisible();
    }

    // Кластеры: 3 строки спеки (room1/room2/corridor1), сумма долей 51 %.
    const clustersPanel = page.locator('section.panel', { has: page.getByRole('heading', { name: 'Кластеры' }) });
    for (const id of ['room1', 'room2', 'corridor1']) {
      await expect(clustersPanel.getByText(id, { exact: true })).toBeVisible();
    }
    await expect(clustersPanel.getByText('Сумма долей: 51 %')).toBeVisible();

    // Типы: 3 типа (ROOM1/ROOM2/CORRIDOR).
    await page.getByRole('button', { name: 'Типы', exact: true }).first().click();
    const typesPanel = page.locator('section.panel', { has: page.getByRole('heading', { name: 'Типы' }) });
    for (const id of ['ROOM1', 'ROOM2', 'CORRIDOR']) {
      await expect(typesPanel.getByText(id, { exact: true })).toBeVisible();
    }

    // Правила: fillAll и touchAll выключены; запрещённых пар нет.
    await page.getByRole('button', { name: 'Правила', exact: true }).first().click();
    const rulesPanel = page.locator('section.panel', { has: page.getByRole('heading', { name: 'Правила' }) });
    // Чекбоксы в порядке DOM: [0] allow, [1] fillAll, [2] touchAll.
    await expect(rulesPanel.locator('input[type=checkbox]').nth(1)).not.toBeChecked();
    await expect(rulesPanel.locator('input[type=checkbox]').nth(2)).not.toBeChecked();

    // Маска загружена с сервера: имя каноническое, размер ≠ сетка → пометка в панели.
    await expect(page.getByText(/имя: blocked\.txt/)).toContainText('размер ≠ сетка ⚠');

    // Canvas: сетка отрисована, строка статуса — «клеток всего 50×50».
    const canvas = mainCanvas(page);
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box && box.width > 100 && box.height > 100).toBeTruthy();
    await expect(statusLine(page)).toContainText('клеток всего 50×50');

    // Маска 10×10 к сетке 50×50 → V-MASK-DIM: файл загружается, ошибка — в баннере (ТЗ 05 §2.2).
    const banner = page.getByRole('button', { name: /Ошибки валидации \(1\)/ });
    await expect(banner).toBeVisible({ timeout: 5000 }); // debounce валидации 300 мс
    await banner.click();
    await expect(page.locator('code').getByText('V-MASK-DIM')).toBeVisible();

    // URL обогатился ?project=demo (replaceState, docs-unified/04 §1.8).
    await expect.poll(() => page.evaluate(() => window.location.search)).toBe('?project=demo');

    // Кнопки сохранения/генерации активны (проект выбран, спека загружена).
    await expect(generateBtn(page)).toBeEnabled();
  });

  test('URL ?project=<name> — проект подгружается автоматически', async ({ page }) => {
    await mockProject(page, 'demo', FILES);
    await page.goto('/?project=demo');
    await expect(page.getByRole('combobox', { name: 'Проект' })).toHaveValue('demo', { timeout: 10_000 });
    const clustersPanel = page.locator('section.panel', { has: page.getByRole('heading', { name: 'Кластеры' }) });
    await expect(clustersPanel.getByText('room1', { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  test('URL ?project=<нет в списке> — баннер «не найден», список подгружен', async ({ page }) => {
    await mockProject(page, 'demo', FILES);
    await page.goto('/?project=missing');
    await expect(page.getByText(/Проект «missing» не найден/)).toBeVisible({ timeout: 10_000 });
    // Селектор заполнился списком (просто проект с таким именем отсутствует).
    const select = page.getByRole('combobox', { name: 'Проект' });
    await expect(select).toBeEnabled();
    await expect(select.locator('option')).toHaveCount(2); // «— выберите —» + demo
  });
});
