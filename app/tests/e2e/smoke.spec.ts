// Smoke-e2e менеджера проектов (реальный браузер, реальный сервер + tmp-workspace):
// загрузка страницы → создание проекта через UI → карточка с метриками и ссылками
// → переименование → удаление с подтверждением. Полный набор сценариев — подзадача 6.
import { expect, test } from '@playwright/test';

const CREATE_BTN = '＋ Создать проект';
// Замечание 2: произвольные display-name (кириллица/пробелы/регистр);
// slug генерирует сервер — ссылки используют его.
const NAME_PLACEHOLDER = 'имя проекта (напр., «Офис Б», до 64 символов)';

test('smoke: создание → карточка → переименование → удаление', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Space Manager · проекты' })).toBeVisible();
  await expect(page.getByText(/Проектов пока нет/)).toBeVisible();

  // --- Создание -------------------------------------------------------------
  await page.getByRole('button', { name: CREATE_BTN }).first().click();
  await page.getByPlaceholder(NAME_PLACEHOLDER).fill('smoke-p1');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();

  const card = page.locator('.card', { hasText: 'smoke-p1' });
  await expect(card).toBeVisible();
  // Новый проект: spec.yaml + blocked.txt + preset.txt (ТЗ 02 §4)
  await expect(card.getByText('файлов: 3 · результатов: 0')).toBeVisible();
  await expect(card.getByRole('link', { name: 'Редактор' })).toHaveAttribute(
    'href',
    '/editor?project=smoke-p1',
  );
  await expect(card.getByRole('link', { name: 'Viewer3D' })).toHaveAttribute(
    'href',
    '/viewer3d?project=smoke-p1',
  );
  await expect(card.getByRole('link', { name: '⬇ Архив' })).toHaveAttribute(
    'href',
    '/api/projects/smoke-p1/archive',
  );

  // --- Валидация имени в форме (замечание 2) ---------------------------------
  // «Пробелы и кириллица» допустимы; запрещён только символ «/».
  await page.getByRole('button', { name: CREATE_BTN }).click();
  await page.getByPlaceholder(NAME_PLACEHOLDER).fill('Bad/Name');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.getByText(/запрещён символ/)).toBeVisible();
  await page.getByRole('button', { name: 'Отмена' }).click();

  // --- Переименование (замечание 2) -------------------------------------------
  // Меняется только display-name; slug стабилен — ссылки сохраняют проект smoke-p1.
  const renamed = page.locator('.card', { hasText: 'smoke-p2' });
  await card.getByRole('button', { name: 'Переименовать проект smoke-p1' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await page.getByLabel('новое имя проекта').fill('smoke-p2');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(renamed).toBeVisible();
  await expect(dialog).toHaveCount(0);
  // Ссылки по-прежнему используют исходный slug.
  await expect(renamed.getByRole('link', { name: 'Редактор' })).toHaveAttribute(
    'href',
    '/editor?project=smoke-p1',
  );
  await expect(renamed.getByRole('link', { name: '⬇ Архив' })).toHaveAttribute(
    'href',
    '/api/projects/smoke-p1/archive',
  );

  // --- Удаление с подтверждением ----------------------------------------------
  await page.getByRole('button', { name: 'Удалить проект smoke-p2' }).click();
  const confirm = page.getByRole('dialog');
  await expect(confirm.getByText(/Действие необратимо/)).toBeVisible();
  await confirm.getByRole('button', { name: 'Отмена' }).click(); // сначала отменяем — карточка осталась
  await expect(page.locator('.card', { hasText: 'smoke-p2' })).toBeVisible();

  await page.getByRole('button', { name: 'Удалить проект smoke-p2' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(page.getByText(/Проектов пока нет/)).toBeVisible();
});
