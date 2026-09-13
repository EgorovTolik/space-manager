// ST-2: новые инструменты canvas «Заливка» (4) и «Линия» (5).
// Проверка результатов — через сериализацию маски в PUT …/files (как в 02-roundtrip-edit):
// клик/drag по canvas → saveBtn → тело put сверяется с исходной маской побайтово.
import { expect, test, type Page } from '@playwright/test';
import { afterDraw, clickCell, mainCanvas, mockProject, saveBtn, selectProject } from './helpers';
import { SPEC_10X10_MASKED } from './fixtures';

const W = 10;
const H = 10;

// 10×10 с кольцом блокировок (строки 1–3, колонки 2–6) и «дырой» из 3 клеток (3..5, 2):
// дыра отрезана от внешнего свободного пространства по всем 8 соседям.
const BLOCKED_RING = [
  '..........',
  '..*****...',
  '..*...*...',
  '..*****...',
  '..........',
  '..........',
  '..........',
  '..........',
  '..........',
  '..........',
].join('\n');

const FILES = { 'spec.yaml': SPEC_10X10_MASKED, 'blocked.txt': BLOCKED_RING };

function textAt(text: string, x: number, y: number): string {
  return (text.split('\n')[y] ?? '')[x];
}

/** Drag линии по canvas (pointerdown → движение с промежуточными шагами → pointerup). */
async function dragLine(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  const box = (await mainCanvas(page).boundingBox())!;
  const cell = Math.min(box.width / W, box.height / H); // fit: pan=0, zoom=1
  const p = (x: number, y: number) => ({ x: box.x + (x + 0.5) * cell, y: box.y + (y + 0.5) * cell });
  const a = p(x0, y0);
  const b = p(x1, y1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 3 }); // предпросмотр по пути
  await page.mouse.move(b.x, b.y, { steps: 3 });
  await page.mouse.up();
}

test.describe('Инструмент «Заливка» (ST-2)', () => {
  test('клик по дыре кольца: залита только связная область (3 клетки), остальное без изменений', async ({ page }) => {
    const cap = await mockProject(page, 'demo', FILES);
    await page.goto('/');
    await selectProject(page, 'demo');
    await expect(page.getByText('Ошибок валидации нет')).toBeVisible();

    // Инструмент «Заливка» — горячей клавишей 4 (тот же switch, что 1/2/3).
    await page.keyboard.press('4');
    await expect(page.getByRole('button', { name: /^Заливка \(4\)/ })).toHaveCSS('font-weight', '700');

    // Клик в дыру (4,2): область = ровно 3 клетки (3..5, 2) → все становятся '*'.
    await clickCell(page, 4, 2, W, H);
    await afterDraw(page);

    await saveBtn(page).click();
    await expect.poll(() => cap.puts.length).toBe(1);
    const out = cap.puts[0]['blocked.txt'];
    for (const x of [3, 4, 5]) expect(textAt(out, x, 2), `дыра (${x},2)`).toBe('*');
    // Все остальные клетки — побайтово без изменений.
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (y === 2 && x >= 3 && x <= 5) continue;
        expect(textAt(out, x, y), `клетка (${x},${y})`).toBe(BLOCKED_RING.split('\n')[y][x]);
      }
    }
  });

  test('клик во внешнюю область: залита вся большая связная область (все free кроме кольца и дыры)', async ({ page }) => {
    const cap = await mockProject(page, 'demo', FILES);
    await page.goto('/');
    await selectProject(page, 'demo');
    await expect(page.getByText('Ошибок валидации нет')).toBeVisible();

    // Кнопка тулбара (после «Ластик»).
    await page.getByRole('button', { name: /^Заливка \(4\)/ }).click();
    await clickCell(page, 9, 0, W, H);
    await afterDraw(page);

    await saveBtn(page).click();
    await expect.poll(() => cap.puts.length).toBe(1);
    const out = cap.puts[0]['blocked.txt'];
    // Кольцо и углы уже были '*' / стали '*'; дыра (3..5,2) осталась '.'.
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const inHole = y === 2 && x >= 3 && x <= 5;
        expect(textAt(out, x, y), `клетка (${x},${y})`).toBe(inHole ? '.' : '*');
      }
    }
  });

  test('preset-режим: без символа палитры — подсказка; с символом B область A залита целиком', async ({ page }) => {
    // Маски из examples: A = блок 2×4 (строки 0–1, колонки 2–5), B = строка 5 (колонки 0–2).
    const blocked = ['**........', '**........', '..........', '..........', '..........', '..........', '..........', '..........', '..........', '..........'].join('\n');
    const preset = ['..AAAA....', '..AAAA....', '..........', '..........', '..........', 'BBB.......', '..........', '..........', '..........', '..........'].join('\n');
    const cap = await mockProject(page, 'demo', { 'spec.yaml': SPEC_10X10_MASKED, 'blocked.txt': blocked, 'preset.txt': preset });
    await page.goto('/');
    await selectProject(page, 'demo');
    await expect(page.getByText('Ошибок валидации нет')).toBeVisible();

    // Preset-режим + Заливка. Без выбранного символа — подсказка палитры, маска не изменилась.
    await page.getByRole('button', { name: /^Preset-кластеры/ }).click();
    await page.getByRole('button', { name: /^Заливка \(4\)/ }).click();
    await clickCell(page, 3, 0, W, H); // область A
    await afterDraw(page);
    await expect(page.getByText('Выберите символ типа в палитре')).toBeVisible();

    // Выбираем B из палитры и заливаем ту же область: все 8 клеток A становятся B.
    await page.locator('button[title="B · B"]').click();
    await clickCell(page, 3, 0, W, H);
    await afterDraw(page);

    // Повторный клик по уже залитой области — noop (Paint-семантика).
    await clickCell(page, 5, 1, W, H);
    await afterDraw(page);

    await saveBtn(page).click();
    await expect.poll(() => cap.puts.length).toBe(1);
    const out = cap.puts[0]['preset.txt'];
    for (let y = 0; y <= 1; y++) {
      for (let x = 2; x <= 5; x++) expect(textAt(out, x, y), `клетка A (${x},${y})`).toBe('B');
    }
    // Всё остальное без изменений (область B и free-клетки).
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (y <= 1 && x >= 2 && x <= 5) continue;
        expect(textAt(out, x, y), `клетка (${x},${y})`).toBe(preset.split('\n')[y][x]);
      }
    }
  });
});

test.describe('Инструмент «Линия» (ST-2)', () => {
  test('drag по диагонали: клетки линии Брезенхэма (включая концы) стали заблокированными', async ({ page }) => {
    const cap = await mockProject(page, 'demo', FILES);
    await page.goto('/');
    await selectProject(page, 'demo');
    await expect(page.getByText('Ошибок валидации нет')).toBeVisible();

    // Инструмент «Линия» — клавишей 5.
    await page.keyboard.press('5');
    await expect(page.getByRole('button', { name: /^Линия \(5\)/ })).toHaveCSS('font-weight', '700');

    // Диагональ (0,9) → (4,5): ровно (0,9),(1,8),(2,7),(3,6),(4,5).
    await dragLine(page, 0, 9, 4, 5);
    await afterDraw(page);

    await saveBtn(page).click();
    await expect.poll(() => cap.puts.length).toBe(1);
    const out = cap.puts[0]['blocked.txt'];
    for (const [x, y] of [[0, 9], [1, 8], [2, 7], [3, 6], [4, 5]]) {
      expect(textAt(out, x, y), `линия (${x},${y})`).toBe('*');
    }
    // Остальные клетки — побайтово без изменений.
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (y === 9 - x && x >= 0 && x <= 4) continue; // клетки диагонали
        expect(textAt(out, x, y), `клетка (${x},${y})`).toBe(BLOCKED_RING.split('\n')[y][x]);
      }
    }
  });

  test('клик без движения: линия из одной клетки', async ({ page }) => {
    const cap = await mockProject(page, 'demo', FILES);
    await page.goto('/');
    await selectProject(page, 'demo');
    await expect(page.getByText('Ошибок валидации нет')).toBeVisible();

    await page.getByRole('button', { name: /^Линия \(5\)/ }).click();
    await clickCell(page, 8, 4, W, H); // одна free-клетка справа от кольца
    await afterDraw(page);

    await saveBtn(page).click();
    await expect.poll(() => cap.puts.length).toBe(1);
    const out = cap.puts[0]['blocked.txt'];
    expect(textAt(out, 8, 4)).toBe('*');
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (x === 8 && y === 4) continue;
        expect(textAt(out, x, y), `клетка (${x},${y})`).toBe(BLOCKED_RING.split('\n')[y][x]);
      }
    }
  });
});
