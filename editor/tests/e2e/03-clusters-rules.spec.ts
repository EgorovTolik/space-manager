// docs-unified/06 §3.4: CRUD кластеров (добавить/изменить/удалить), правила (fillAll,
// запрещённая пара типов) — изменения видны в UI и попадают в PUT …/files (spec.yaml).
import { expect, test } from '@playwright/test';
import * as yaml from 'js-yaml';
import { manageDialogs, mockProject, saveBtn, selectProject } from './helpers';
import { SPEC_50X50 } from './fixtures';

interface SpecModel {
  clusters: { id: string; type: string; areaPercent: number; shape: string }[];
  rules: { fillAll: boolean; adjacency: { forbidden: [string, string][] } };
}

test.describe('CRUD кластеров и правил (docs-unified/06 §3.4)', () => {
  test('добавить/изменить/удалить кластер; fillAll и forbidden-пара → PUT spec.yaml', async ({ page }) => {
    manageDialogs(page, { action: 'accept' });
    const cap = await mockProject(page, 'demo', { 'spec.yaml': SPEC_50X50 });
    await page.goto('/');
    await selectProject(page, 'demo');

    const clustersPanel = page.locator('section.panel', { has: page.getByRole('heading', { name: 'Кластеры' }) });
    await expect(clustersPanel.getByText('Сумма долей: 51 %')).toBeVisible();

    // ── Добавить кластер room9 (ROOM2, 10%, rectangle) ─────────────────────────
    await clustersPanel.getByRole('button', { name: '＋ Добавить' }).click();
    const form = page.locator('div', { has: page.getByText('Добавить кластер', { exact: true }) }).last();
    await form.locator('input').first().fill('room9'); // id
    await form.locator('select').selectOption('ROOM2');
    await form.locator('input').nth(1).fill('10'); // areaPercent (второй input формы)
    await form.getByLabel(/rectangle/).check();
    await form.getByRole('button', { name: 'Сохранить' }).click();

    await expect(clustersPanel.getByText('room9', { exact: true })).toBeVisible();
    await expect(clustersPanel.getByText('Сумма долей: 61 %')).toBeVisible(); // 51 + 10

    // ── Изменить room9: areaPercent → 20 ───────────────────────────────────────
    // Кнопки ✎/✕ имеют текстовое содержимое — имя из title не работает, берём по атрибуту.
    const row = clustersPanel.locator('div', { has: page.getByText('room9', { exact: true }) }).last();
    await row.locator('button[title="Редактировать"]').click();
    const editForm = page.locator('div', { has: page.getByText('Редактировать кластер', { exact: true }) }).last();
    await editForm.locator('input').nth(1).fill('20');
    await editForm.getByRole('button', { name: 'Сохранить' }).click();
    await expect(clustersPanel.getByText('Сумма долей: 71 %')).toBeVisible(); // 51 + 20

    // ── Удалить room9 (с подтверждением) ───────────────────────────────────────
    const row2 = clustersPanel.locator('div', { has: page.getByText('room9', { exact: true }) }).last();
    await row2.locator('button[title="Удалить"]').click();
    await expect(clustersPanel.getByText('room9', { exact: true })).toHaveCount(0);
    await expect(clustersPanel.getByText('Сумма долей: 51 %')).toBeVisible();

    // ── Правила: fillAll = true; запрещённая пара ROOM1 × ROOM2 ────────────────
    await page.getByRole('button', { name: 'Правила', exact: true }).first().click();
    const rulesPanel = page.locator('section.panel', { has: page.getByRole('heading', { name: 'Правила' }) });
    await rulesPanel.locator('input[type=checkbox]').nth(1).check(); // fillAll

    const selects = rulesPanel.locator('select');
    await selects.nth(0).selectOption('ROOM1');
    await selects.nth(1).selectOption('ROOM2');
    await rulesPanel.getByRole('button', { name: 'Добавить' }).first().click();
    await expect(rulesPanel.getByText('ROOM1 × ROOM2')).toBeVisible();

    // ── Сохранить в проект и сверить PUT spec.yaml ──────────────────────────────
    await saveBtn(page).click();
    await expect.poll(() => cap.puts.length).toBe(1);
    const model = yaml.load(cap.puts[0]['spec.yaml']) as SpecModel;
    expect(model.rules.fillAll).toBe(true);
    expect(model.rules.adjacency.forbidden).toEqual([['ROOM1', 'ROOM2']]);
    // room9 удалён: в speке его нет. Масок в проекте не было — файлов масок в PUT тоже нет.
    expect(model.clusters.map((c) => c.id)).toEqual(['room1', 'room2', 'corridor1']);
    expect(Object.keys(cap.puts[0]).sort()).toEqual(['spec.yaml']);
  });

  test('hint свободной площади у areaPercent: live-пересчёт, свойство «не вычитать себя» (ST-3)', async ({ page }) => {
    await mockProject(page, 'demo', { 'spec.yaml': SPEC_50X50 }); // кластеры 30 + 15 + 6 = 51
    await page.goto('/');
    await selectProject(page, 'demo');

    const clustersPanel = page.locator('section.panel', { has: page.getByRole('heading', { name: 'Кластеры' }) });

    // ── Форма добавления: пусто = 100 − 51; ввод 10 → 39 ───────────────────────
    await clustersPanel.getByRole('button', { name: '＋ Добавить' }).click();
    const form = page.locator('div', { has: page.getByText('Добавить кластер', { exact: true }) }).last();
    await expect(form.getByText('Свободна ещё 49 % доступной площади.')).toBeVisible();
    await form.locator('input').nth(1).fill('10'); // areaPercent
    await expect(form.getByText('Свободна ещё 39 % доступной площади.')).toBeVisible();
    // Некорректный ввод — без вычета текущего (как при пустом).
    await form.locator('input').nth(1).fill('abc');
    await expect(form.getByText('Свободна ещё 49 % доступной площади.')).toBeVisible();
    // Отрицательное значение показывается как есть: 100 − 51 − 60 = −11.
    await form.locator('input').nth(1).fill('60');
    await expect(form.getByText('Свободна ещё -11 % доступной площади.')).toBeVisible();

    // ── Форма редактирования room2 (доля 15): сохранённая доля НЕ вычитается, но
    // текущий ввод формы («15» — корректен) учитывается: 100 − 36 − 15 = 49 ──
    await form.getByRole('button', { name: 'Отмена' }).click();
    const row = clustersPanel.locator('div', { has: page.getByText('room2', { exact: true }) }).last();
    await row.locator('button[title="Редактировать"]').click();
    const editForm = page.locator('div', { has: page.getByText('Редактировать кластер', { exact: true }) }).last();
    await expect(editForm.getByText('Свободна ещё 49 % доступной площади.')).toBeVisible();
    // Ввод 20 → 100 − 36 − 20 = 44.
    await editForm.locator('input').nth(1).fill('20');
    await expect(editForm.getByText('Свободна ещё 44 % доступной площади.')).toBeVisible();
    // Пустой (некорректный) ввод — без вычета текущего: «свободно относительно
    // остальных» = 100 − 36 = 64 (собственная сохранённая доля не вычитается).
    await editForm.locator('input').nth(1).fill('');
    await expect(editForm.getByText('Свободна ещё 64 % доступной площади.')).toBeVisible();
  });
});
