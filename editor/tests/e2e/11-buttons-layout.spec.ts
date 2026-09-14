// Заметка №4 (ручное тестирование, раунд 4): единая система кнопок редактора.
// Правило из src/styles.css:
// - в каждом `.btn-row` высоты всех кнопок равны (align-items: stretch + .btn);
// - одиночная кнопка-ребёнок (`.btn-block`) = 100% ширины контейнера (`.btn-row`);
// - несколько кнопок → ширина auto по тексту.
// Проверки — boundingBox по всем видимым `.btn-row` экрана редактора с загруженным
// проектом (панели Файлы/Кластеры/Типы/Правила + табы + LLM-ряд).
import { expect, test, type Page } from '@playwright/test';
import { mockProject, projectLoaded, selectProject } from './helpers';

const SPEC_FULL = `grid:
  width: 10
  height: 10

blockedFile: null
presetFile: null

types:
  A: { symbol: "A", name: Тип A }
  B: { symbol: "B", name: Тип B }

rules:
  connectivity: 8
  adjacency:
    forbidden: []
    allow: null
  size:
    min: null
    max: null
  convexity:
    weight: soft
  fillAll: false
  touchAll: false

clusters:
  - id: a1
    type: A
    areaPercent: 40
    shape: free
`;

const CATALOG = {
  A: { symbol: 'A', name: 'Тип A (каталог)' },
  B: { symbol: 'B', name: 'Тип B' },
};

const TOL = 1.5; // px — допуск на субпиксельную округровку boundingBox

/** Все видимые `.btn-row`: равные высоты кнопок + `.btn-block` на всю ширину ряда. */
async function assertButtonRows(page: Page): Promise<void> {
  const rows = page.locator('.btn-row');
  const count = await rows.count();
  expect(count, 'на экране нет ни одного .btn-row').toBeGreaterThan(0);

  let checkedRows = 0;
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    if (!(await row.isVisible())) continue;
    const boxRow = await row.boundingBox();
    expect(boxRow, `ряд ${i}: нет boundingBox`).not.toBeNull();

    const btns = row.locator('button:visible');
    const n = await btns.count();
    expect(n, `ряд ${i}: нет видимых кнопок`).toBeGreaterThan(0);

    const heights: number[] = [];
    for (let j = 0; j < n; j++) {
      const box = await btns.nth(j).boundingBox();
      expect(box, `ряд ${i}, кнопка ${j}: нет boundingBox`).not.toBeNull();
      heights.push(box!.height);
    }
    for (let j = 1; j < heights.length; j++) {
      expect(
        Math.abs(heights[j] - heights[0]),
        `ряд ${i}: высоты кнопок не равны: ${JSON.stringify(heights)}`,
      ).toBeLessThanOrEqual(TOL);
    }

    // Одиночные/помеченные кнопки .btn-block — вся ширина контейнера.
    const blocks = row.locator('.btn-block');
    const nb = await blocks.count();
    for (let j = 0; j < nb; j++) {
      const box = await blocks.nth(j).boundingBox();
      expect(box, `ряд ${i}, btn-block ${j}: нет boundingBox`).not.toBeNull();
      expect(
        Math.abs(box!.width - boxRow!.width),
        `ряд ${i}: ширина .btn-block ${box!.width} ≠ контейнер ${boxRow!.width}`,
      ).toBeLessThanOrEqual(TOL);
    }
    checkedRows++;
  }
  expect(checkedRows, 'проверен хотя бы один видимый .btn-row').toBeGreaterThan(0);
}

test('кнопки редактора: в каждом .btn-row высоты равны, одиночные .btn-block = 100% ширины', async ({ page }) => {
  await mockProject(page, 'demo', { 'spec.yaml': SPEC_FULL }, { catalog: CATALOG });
  await page.goto('/');
  await selectProject(page, 'demo');
  await projectLoaded(page, 'a1');

  // Базовый экран: панель Файлы (createSpec/save/маски), табы, LLM-ряд (disabled).
  await assertButtonRows(page);

  // Конкретные одиночные кнопки панели Файлы — .btn-block на всю ширину.
  const filesPanel = page.locator('section.panel', { has: page.getByRole('heading', { name: 'Файлы' }) });
  expect(await filesPanel.locator('.btn-row').count()).toBeGreaterThanOrEqual(4);

  // Форма «Добавить кластер» (ряд Сохранить/Отмена — две кнопки, равные высоты).
  const clustersPanel = page.locator('section.panel', { has: page.getByRole('heading', { name: 'Кластеры' }) });
  await clustersPanel.getByRole('button', { name: '＋ Добавить' }).click();
  await assertButtonRows(page);

  // Закрыть форму кластера (Отмена) — перед переходом на вкладку Типы.
  const formCancel = page.locator('.btn-row button', { hasText: 'Отмена' });
  await expect(formCancel.first()).toBeVisible();
  await formCancel.first().click();
  await page.getByRole('button', { name: 'Типы', exact: true }).first().click();
  await assertButtonRows(page);

  // Панель Правила.
  await page.getByRole('button', { name: 'Правила', exact: true }).first().click();
  await assertButtonRows(page);
});
