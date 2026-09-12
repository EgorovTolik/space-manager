// ТЗ 06 §3: загрузка спеки → панели заполнились (типы/кластеры/правила), canvas отрисовал
// сетку, ошибок валидации нет. Плюс базовые проверки «спека первой» (ТЗ 05 §1).
import { expect, test } from '@playwright/test';
import { APP_TITLE, blockedFileInput, mainCanvas, specFileInput, statusLine } from './helpers';
import { EXAMPLES } from './fixtures';

test.describe('Загрузка спеки (examples/spec_basic.yaml)', () => {
  test('панели заполнились, canvas отрисован, ошибок нет', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/.+/);
    await expect(page.getByRole('heading', { name: APP_TITLE })).toBeVisible();

    // До спеки: правые панели заблокированы, подпись «Сначала загрузите спекацию».
    await expect(page.getByText('Сначала загрузите спекацию').first()).toBeVisible();

    await specFileInput(page).setInputFiles(EXAMPLES.specBasic);

    // Табы появились.
    for (const tab of ['Кластеры', 'Типы', 'Правила']) {
      await expect(page.getByRole('button', { name: tab, exact: true }).first()).toBeVisible();
    }

    // Кластеры: 3 строки из spec_basic.yaml (room1/room2/corridor1), сумма долей 51%.
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

    // Canvas: сетка отрисована, строка статуса — «клеток всего 50×50».
    const canvas = mainCanvas(page);
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box && box.width > 100 && box.height > 100).toBeTruthy();
    await expect(statusLine(page)).toContainText('клеток всего 50×50');

    // Ошибок валидации нет (баннер зелёный).
    await page.waitForTimeout(400); // debounce валидации 300 мс
    await expect(page.getByText('Ошибок валидации нет')).toBeVisible();

    // Маска 10×10 к сетке 50×50 → V-MASK-DIM: файл загружается, ошибка — в баннере (ТЗ 05 §2.2).
    await blockedFileInput(page).setInputFiles(EXAMPLES.blockedBasic);
    await expect(page.getByText('размер ≠ сетка ⚠')).toBeVisible();
    const banner = page.getByRole('button', { name: /Ошибки валидации \(1\)/ });
    await expect(banner).toBeVisible();
    await banner.click();
    await expect(page.locator('code').getByText('V-MASK-DIM')).toBeVisible();
  });
});
