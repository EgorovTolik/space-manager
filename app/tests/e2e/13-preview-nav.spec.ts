// E2E «превью на карточке + навигация в модалке» (ручное тестирование, раунд 4):
// РЕАЛЬНЫЙ app-сервер (webServer :3212, tmp-workspace) + проект с 8 превью,
// созданный вручную в temp-workspace (каталог preview/ + файлы png).
//   • лента: ВСЕ превью в одну строку, квадраты 64×64, горизонтальная прокрутка, без «+N»;
//   • клик по превью → модалка; «→»/«←» листают коллекцию карточки с wrap-around,
//     счётчик «N / M», подпись текущего изображения; Esc закрывает;
//   • кнопки «Переименовать»/«Удалить» — одинаковые (boundingBox).

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

import { e2eWorkspace } from './workspace';

const PROJECT = 'preview-nav-demo';
const projDir = path.join(e2eWorkspace, PROJECT);

/** 8 превью (asc по имени). Сервер отдаёт список ПО УБЫВАНИЮ — DESC[0] показывается первым. */
const NAMES_ASC = Array.from(
  { length: 8 },
  (_, i) => `preview-20260913-${String(140500 + i).padStart(6, '0')}.png`,
);
const DESC = [...NAMES_ASC].reverse();

// Минимальный валидный PNG 1×1.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test.describe.serial('Превью карточки: лента + навигация в модалке (раунд 4)', () => {
  test.beforeAll(() => {
    fs.rmSync(projDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(projDir, 'preview'), { recursive: true });
    const now = new Date().toISOString();
    fs.writeFileSync(
      path.join(projDir, 'project.json'),
      JSON.stringify({
        id: `id-${PROJECT}`,
        name: PROJECT,
        createdAt: now,
        updatedAt: now,
        latestResult: null,
      }),
      'utf8',
    );
    for (const n of NAMES_ASC) fs.writeFileSync(path.join(projDir, 'preview', n), PNG_1X1);
  });

  test.afterAll(() => {
    fs.rmSync(projDir, { recursive: true, force: true });
  });

  test('лента: все превью в одну строку, квадраты 64×64, горизонтальная прокрутка, без «+N»', async ({
    page,
  }) => {
    // Узкий viewport → лента гарантированно переполняется (8 × ~70px > ширина карточки).
    await page.setViewportSize({ width: 420, height: 900 });
    await page.goto('/');

    const card = page.locator('.card', { hasText: PROJECT });
    await expect(card).toBeVisible();
    const strip = card.locator('.preview-strip');
    const thumbs = strip.locator('img');
    await expect(thumbs).toHaveCount(8); // ВСЕ превью, без усечения

    // Одна строка (нет flex-wrap): все миниатюры на одной высоте.
    const boxes = await thumbs.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()));
    expect(new Set(boxes.map((b) => b.y)).size).toBe(1);
    // Квадраты 64×64 (box-sizing: border-box — border внутри).
    for (const b of boxes) {
      expect(Math.round(b.width)).toBe(64);
      expect(Math.round(b.height)).toBe(64);
    }

    // Горизонтальная прокрутка: содержимое шире видимой области.
    const dims = await strip.evaluate((el) => ({ clientWidth: el.clientWidth, scrollWidth: el.scrollWidth }));
    expect(dims.scrollWidth).toBeGreaterThan(dims.clientWidth);
    // Маркера «+N» нет.
    await expect(strip.locator('.preview-more')).toHaveCount(0);
  });

  test('клик → модалка; «→»/«←» листают коллекцию с wrap-around; счётчик и подпись актуальны', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');

    const card = page.locator('.card', { hasText: PROJECT });
    const thumbs = card.locator('.preview-strip img');
    await expect(thumbs).toHaveCount(8);

    // Клик по первому превью (список — по убыванию имени: DESC[0]).
    await thumbs.first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const img = dialog.locator('.preview-full');
    const srcOf = async (): Promise<string> => (await img.getAttribute('src')) ?? '';
    const counter = dialog.locator('.preview-counter');

    expect(await srcOf()).toContain(`file=${DESC[0]}`);
    await expect(counter).toHaveText('1 / 8');

    // «→» — следующее; подпись показывает имя текущего.
    const next = page.getByRole('button', { name: 'Следующее превью' });
    const prev = page.getByRole('button', { name: 'Предыдущее превью' });
    await next.click();
    expect(await srcOf()).toContain(`file=${DESC[1]}`);
    await expect(counter).toHaveText('2 / 8');
    await expect(dialog.locator('.preview-caption')).toContainText(DESC[1]);

    // «←» — назад.
    await prev.click();
    expect(await srcOf()).toContain(`file=${DESC[0]}`);
    await expect(counter).toHaveText('1 / 8');

    // Долистать до конца: с 8-го «→» — в начало (wrap-around).
    for (let i = 1; i < DESC.length; i++) await next.click();
    await expect(counter).toHaveText('8 / 8');
    expect(await srcOf()).toContain(`file=${DESC[7]}`);
    await next.click();
    await expect(counter).toHaveText('1 / 8');
    expect(await srcOf()).toContain(`file=${DESC[0]}`);

    // Esc закрывает окно.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('кнопки карточки «Переименовать»/«Удалить» — одинаковые (boundingBox)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');

    const card = page.locator('.card', { hasText: PROJECT });
    const rename = card.getByRole('button', { name: `Переименовать проект ${PROJECT}` });
    const del = card.getByRole('button', { name: `Удалить проект ${PROJECT}` });
    await expect(rename).toBeVisible();

    const a = (await rename.boundingBox())!;
    const b = (await del.boundingBox())!;
    expect(a.height).toBe(b.height); // одна высота при любых подписях
    expect(a.width).toBe(b.width); // единый бокс (.icon-btn)
  });
});
