// ST-2: секция «Общий список типов» в панели Типы (глобальный каталог
// GET /api/types-catalog — мок через mockProject). Сценарий:
// - каталог {A, B, C}; проект с типами A (привязан к кластеру a1) и D (вне каталога);
// - чекбоксы A/D отмечены, D помечен «вне общего списка»;
// - снятие A → сообщение о блоке кластерами, состояние не меняется;
// - отметка B → B появляется в селекторе типов при создании кластера (ClustersPanel);
// - C с занятым символом («D» — у типа D проекта) → чекбокс disabled с подсказкой.
import { expect, test, type Page } from '@playwright/test';
import * as yaml from 'js-yaml';
import { manageDialogs, mockProject, projectLoaded, saveBtn, selectProject } from './helpers';
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

// ── ST-4: редактирование/удаление типов ОБЩЕГО списка (PATCH/DELETE) ────────────

const SPEC_EDIT = `grid:
  width: 10
  height: 10

blockedFile: null
presetFile: null

types:
  A: { symbol: "A", name: Тип A }

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

// Каталог {A, B, D}: B — редактируем; D — владелец символа «D» (конфликт 422).
const CATALOG_EDIT: Record<string, { symbol: string; name: string | null }> = {
  A: { symbol: 'A', name: 'Тип A (каталог)' },
  B: { symbol: 'B', name: 'Тип B' },
  D: { symbol: 'D', name: null },
};

async function openCatalogSec(page: Page) {
  await page.getByRole('button', { name: ru.panels.types, exact: true }).first().click();
  const typesPanel = page.locator('section.panel', { has: page.getByRole('heading', { name: ru.panels.types }) });
  const sec = typesPanel.locator('.types-catalog');
  await expect(sec.getByText(ru.types.catalogTitle, { exact: true })).toBeVisible({ timeout: 10_000 });
  return sec;
}

test('редактирование каталога: инлайн-форма → PATCH с телом, строка обновилась; 422 → сообщение с владельцем', async ({ page }) => {
  const patchCalls: { id: string; body?: Record<string, unknown> }[] = [];
  await mockProject(page, 'demo', { 'spec.yaml': SPEC_EDIT }, {
    catalog: CATALOG_EDIT,
    catalogMutate: (method, id, body) => {
      if (method !== 'PATCH') return { status: 405, body: { error: 'METHOD_NOT_ALLOWED' } };
      patchCalls.push({ id, body });
      // Серверный конфликт 422: символ «Q» занят другим типом (владелец — Z).
      // (Дубль из локального каталога «D» не долетает до сервера — его ловит
      //  клиентская валидация symbolError, что проверяется ниже отдельно.)
      if (id === 'B' && body?.symbol === 'Q') {
        return {
          status: 422,
          body: { error: 'SYMBOL_TAKEN', message: 'символ «Q» уже используется типом Z' },
        };
      }
      const def = CATALOG_EDIT[id];
      if (def === undefined) return { status: 404, body: { error: 'NOT_FOUND', message: `тип «${id}» не найден` } };
      const types = {
        ...CATALOG_EDIT,
        [id]: {
          symbol: typeof body?.symbol === 'string' ? (body.symbol as string) : def.symbol,
          name: typeof body?.name === 'string' || body?.name === null
            ? ((body?.name as string | null) ?? null)
            : def.name,
        },
      };
      return { status: 200, body: { types } };
    },
  });
  await page.goto('/');
  await selectProject(page, 'demo');
  await projectLoaded(page, 'a1');

  const sec = await openCatalogSec(page);
  // Служебная строка под секцией (ST-4) — видна сразу.
  await expect(sec.getByText(ru.types.catalogNote)).toBeVisible();

  // ── Инлайн-форма: ✎ на строке B → PATCH с телом {symbol, name} ────────────────
  const rowB = sec.locator('[data-catalog-row="B"]');
  await rowB.locator(`button[title="${ru.types.catalogEditBtn}"]`).click();
  const form = page.locator('[data-catalog-form="B"]');
  await expect(form).toBeVisible();

  // symbol не трогаем (B), меняем name; сохранить → PATCH.
  const inputs = form.locator('input');
  await expect(inputs.nth(0)).toHaveValue('B');
  await inputs.nth(1).fill('тетра');
  await form.getByRole('button', { name: ru.common.save }).click();

  // Форма закрылась, строка B обновилась по ответу сервера (сессионный кэш).
  await expect(form).toHaveCount(0);
  await expect(rowB.getByText('тетра')).toBeVisible();
  expect(patchCalls.length).toBe(1);
  expect(patchCalls[0].id).toBe('B');
  expect(patchCalls[0].body).toEqual({ symbol: 'B', name: 'тетра' });

  // ── Клиентская валидация: symbol «D» занят типом D каталога → ошибка под полем,
  //     запрос не уходит (локальный дубль ловит symbolError до PATCH).
  await rowB.locator(`button[title="${ru.types.catalogEditBtn}"]`).click();
  const form2 = page.locator('[data-catalog-form="B"]');
  await expect(form2).toBeVisible();
  await form2.locator('input').nth(0).fill('D');
  await form2.getByRole('button', { name: ru.common.save }).click();
  await expect(form2.getByText(ru.types.symbolDup)).toBeVisible();
  await expect(form2).toBeVisible(); // форма не закрыта, запрос не ушёл
  expect(patchCalls.length).toBe(1);

  // ── 422 от сервера: symbol «Q» проходит локальную проверку, но занят типом Z ──
  await form2.locator('input').nth(0).fill('Q');
  await form2.getByRole('button', { name: ru.common.save }).click();

  // Ошибка под секцией (текст из ответа сервера, id владельца в сообщении);
  // форма остаётся открытой для правки.
  const msg422 = 'символ «Q» уже используется типом Z';
  await expect(sec.getByText(ru.types.catalogActionError + ' ' + msg422)).toBeVisible();
  await expect(form2).toBeVisible();
  // Отмена — форма закрыта, сообщение сброшено.
  await form2.getByRole('button', { name: ru.common.cancel }).click();
  await expect(form2).toHaveCount(0);
  await expect(sec.getByText(ru.types.catalogActionError)).toHaveCount(0);

  // Строка B не изменилась после 422.
  await expect(rowB.getByText('тетра')).toBeVisible();
});

test('удаление из каталога: confirm → DELETE → строки нет', async ({ page }) => {
  const calls: string[] = [];
  await mockProject(page, 'demo', { 'spec.yaml': SPEC_EDIT }, {
    catalog: CATALOG_EDIT,
    catalogMutate: (method, id) => {
      calls.push(`${method}:${id}`);
      if (method === 'DELETE') {
        const types = { ...CATALOG_EDIT };
        delete types[id];
        return { status: 200, body: { types } };
      }
      return { status: 405, body: { error: 'METHOD_NOT_ALLOWED' } };
    },
  });
  await page.goto('/');
  await selectProject(page, 'demo');
  await projectLoaded(page, 'a1');

  const sec = await openCatalogSec(page);
  await expect(sec.locator('[data-catalog-row="B"]')).toBeVisible();

  // Единый механизм confirm панели (window.confirm).
  manageDialogs(page, { action: 'accept', textContains: ru.types.catalogRemoveConfirm.replace('{id}', 'B') });
  await sec.locator('[data-catalog-row="B"]').locator(`button[title="${ru.types.catalogDeleteBtn}"]`).click();

  // DELETE ушёл, строка B исчезла из секции (кэш обновлён ответом).
  await expect.poll(() => calls.includes('DELETE:B')).toBe(true);
  await expect(sec.locator('[data-catalog-row="B"]')).toHaveCount(0);
  await expect(sec.getByRole('checkbox', { name: 'B' })).toHaveCount(0);
  // Остальные строки на месте.
  await expect(sec.locator('[data-catalog-row="A"]')).toBeVisible();
  await expect(sec.locator('[data-catalog-row="D"]')).toBeVisible();
});
