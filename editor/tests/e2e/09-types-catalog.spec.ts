// ST-2: секция «Общий список типов» в панели Типы (глобальный каталог
// GET /api/types-catalog — мок через mockProject). Сценарий:
// - каталог {A, B, C}; проект с типами A (привязан к кластеру a1) и D (вне каталога);
// - чекбоксы A/D отмечены, D помечен «вне общего списка»;
// - снятие A → сообщение о блоке кластерами, состояние не меняется;
// - отметка B → B появляется в селекторе типов при создании кластера (ClustersPanel);
// - C с занятым символом («D» — у типа D проекта) → чекбокс disabled с подсказкой.
import { expect, test } from '@playwright/test';
import * as yaml from 'js-yaml';
import { mockProject, projectLoaded, saveBtn, selectProject } from './helpers';
import { ru } from '../../src/i18n/ru';

const SPEC_CATALOG = `grid:
  width: 10
  height: 10

blockedFile: null
presetFile: null

types:
  A: { symbol: "A", name: Тип A }
  D: { symbol: "D", name: Тип D }

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

// C намеренно с символом «D» — занят типом D проекта (V-TYPE-SYMDUP).
const CATALOG = {
  A: { symbol: 'A', name: 'Тип A (каталог)' },
  B: { symbol: 'B', name: 'Тип B' },
  C: { symbol: 'D', name: 'Тип C' },
};

test('общий список типов: отметки, блок по кластеру, добавление в селектор, дубль symbol', async ({ page }) => {
  const cap = await mockProject(page, 'demo', { 'spec.yaml': SPEC_CATALOG }, { catalog: CATALOG });
  await page.goto('/');
  await selectProject(page, 'demo');
  await projectLoaded(page, 'a1');

  // ── Секция «Общий список типов» в панели Типы ────────────────────────────────
  await page.getByRole('button', { name: ru.panels.types, exact: true }).first().click();
  const typesPanel = page.locator('section.panel', { has: page.getByRole('heading', { name: ru.panels.types }) });
  const sec = typesPanel.locator('.types-catalog');
  await expect(sec.getByText(ru.types.catalogTitle, { exact: true })).toBeVisible({ timeout: 10_000 });

  // Каталог {A,B,C} + D из проекта (вне каталога) — 4 строки в порядке каталога+дополнения.
  await expect(sec.getByRole('checkbox', { name: 'A' })).toBeChecked(); // в проекте, из каталога
  await expect(sec.getByRole('checkbox', { name: 'D' })).toBeChecked(); // в проекте, НЕТ в каталоге
  await expect(sec.getByText(ru.types.outsideCatalog)).toBeVisible(); // D — «вне общего списка»
  await expect(sec.getByRole('checkbox', { name: 'B' })).not.toBeChecked();

  // C: символ «D» занят типом D проекта → чекбокс недоступен с подсказкой.
  const cbC = sec.getByRole('checkbox', { name: 'C' });
  await expect(cbC).toBeDisabled();
  await expect(cbC).toHaveAttribute(
    'title',
    ru.types.symbolUsedBy.replace('{symbol}', 'D').replace('{id}', 'D'),
  );

  // ── Снятие A (привязан к кластеру a1) → блок с сообщением, состояние не меняется ─
  const cbA = sec.getByRole('checkbox', { name: 'A' });
  await cbA.click();
  await expect(sec.getByText(ru.types.catalogBlockedClusters.replace('{list}', 'a1'))).toBeVisible();
  await expect(cbA).toBeChecked(); // отметка не снялась

  // Кластер a1 на месте (вкладка Кластеры), в проект ничего не сохранено.
  await page.getByRole('button', { name: ru.panels.clusters, exact: true }).first().click();
  const clustersPanel = page.locator('section.panel', { has: page.getByRole('heading', { name: ru.panels.clusters }) });
  await expect(clustersPanel.getByText('a1', { exact: true })).toBeVisible();
  expect(cap.puts.length).toBe(0);

  // ── Отметка B → тип добавлен в spec.types, доступен в селекторе кластера ─────
  await page.getByRole('button', { name: ru.panels.types, exact: true }).first().click();
  const sec2 = typesPanel.locator('.types-catalog');
  await expect(sec2.getByText(ru.types.catalogBlockedClusters.replace('{list}', 'a1'))).toHaveCount(0); // сообщение сброшено
  await sec2.getByRole('checkbox', { name: 'B' }).check();

  // B появился в реестре панели (строка с бейджем) и в селекторе формы «Добавить кластер».
  await expect(typesPanel.getByText('Тип B').first()).toBeVisible();
  await page.getByRole('button', { name: ru.panels.clusters, exact: true }).first().click();
  const cp = page.locator('section.panel', { has: page.getByRole('heading', { name: ru.panels.clusters }) });
  await cp.getByRole('button', { name: '＋ Добавить' }).click();
  const form = page.locator('div', { has: page.getByText(ru.clusters.addTitle, { exact: true }) }).last();
  await expect(form.locator('select option[value="B"]')).toHaveCount(1);

  // ── Сохранение: B записан в spec.yaml PUT-а (A/D на месте) ───────────────────
  await saveBtn(page).click();
  await expect.poll(() => cap.puts.length, { timeout: 10_000 }).toBe(1);
  const model = yaml.load(cap.puts[0]['spec.yaml']) as { types: Record<string, unknown> };
  expect(Object.keys(model.types)).toEqual(['A', 'D', 'B']);
});
