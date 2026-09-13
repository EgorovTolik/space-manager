// docs-unified/06 §3.1–§3.2 + 04-integrations.md §1.5: сохранение в проект — PUT полным
// состоянием канонической тройки (маски побайтово, спека — эквивалентность данных);
// редактирование маски кликами по canvas и рисование preset'а символом из палитры.
import { expect, test } from '@playwright/test';
import * as yaml from 'js-yaml';
import { readFileSync } from 'node:fs';
import { afterDraw, clickCell, mockProject, saveBtn, selectProject } from './helpers';
import { EXAMPLES, SPEC_10X10_MASKED } from './fixtures';

const originalBlocked = readFileSync(EXAMPLES.blockedBasic, 'utf8');
const originalPreset = readFileSync(EXAMPLES.presetExample, 'utf8');
const FILES = {
  'spec.yaml': SPEC_10X10_MASKED,
  'blocked.txt': originalBlocked,
  'preset.txt': originalPreset,
};

function textAt(text: string, x: number, y: number): string {
  return (text.split('\n')[y] ?? '')[x];
}

test.describe('Сохранение в проект и редактирование масок (10×10)', () => {
  test('сохранение без правок: PUT = каноническая тройка, маски побайтово', async ({ page }) => {
    const cap = await mockProject(page, 'demo', FILES);
    await page.goto('/');
    await selectProject(page, 'demo');
    await expect(page.getByText('Ошибок валидации нет')).toBeVisible(); // debounce 300 мс

    await saveBtn(page).click();
    await expect.poll(() => cap.puts.length).toBe(1);
    const files = cap.puts[0];
    expect(Object.keys(files).sort()).toEqual(['blocked.txt', 'preset.txt', 'spec.yaml']);

    // Маски — побайтовое совпадение с исходниками проекта.
    expect(files['blocked.txt']).toBe(originalBlocked);
    expect(files['preset.txt']).toBe(originalPreset);

    // Спека — эквивалентность данных; имена масок канонические (docs-unified/04 §1.3).
    const loaded = yaml.load(files['spec.yaml']) as Record<string, unknown>;
    expect(loaded.blockedFile).toBe('blocked.txt');
    expect(loaded.presetFile).toBe('preset.txt');
    expect(loaded.grid).toEqual({ width: 10, height: 10 });
    expect(loaded.clusters).toEqual([
      { id: 'a1', type: 'A', areaPercent: 40, shape: 'free' },
      { id: 'b1', type: 'B', areaPercent: 30, shape: 'free' },
    ]);
    expect(loaded.rules).toEqual({
      connectivity: 8,
      adjacency: { forbidden: [], allow: null },
      size: { min: null, max: null },
      convexity: { weight: 'soft' },
      fillAll: false,
      touchAll: false,
    });
    const types = loaded.types as Record<string, { symbol: string; name?: unknown }>;
    expect(Object.keys(types).sort()).toEqual(['A', 'B']);
    expect(types.A.symbol).toBe('A');
    expect(types.B.symbol).toBe('B');

    // После сохранения: индикатор «Сохранено в …», точки ● нет.
    await expect(saveBtn(page)).not.toHaveText('●');
    await expect(page.getByText(/Сохранено в/)).toBeVisible();
  });

  test('кисть: заблокировать (5,5), снять (0,0); preset A в (5,7) — PUT с точечными изменениями', async ({ page }) => {
    const cap = await mockProject(page, 'demo', FILES);
    await page.goto('/');
    await selectProject(page, 'demo');
    await expect(page.getByText('Ошибок валидации нет')).toBeVisible();

    // Режим «Маска блокировок» активен по умолчанию; кисть — toggle.
    const W = 10,
      H = 10;
    await clickCell(page, 5, 5, W, H); // была '.' → '*'
    await afterDraw(page);
    await clickCell(page, 0, 0, W, H); // была '*' → '.'
    await afterDraw(page);

    // Есть несохранённые изменения — точка ● на кнопке (docs-unified/04 §1.5).
    await expect(saveBtn(page)).toHaveText(/●/);

    await saveBtn(page).click();
    await expect.poll(() => cap.puts.length).toBe(1);
    const blockedOut = cap.puts[0]['blocked.txt'];
    expect(textAt(blockedOut, 5, 5)).toBe('*');
    expect(textAt(blockedOut, 0, 0)).toBe('.');
    // Остальные клетки — без изменений.
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if ((x === 5 && y === 5) || (x === 0 && y === 0)) continue;
        expect(textAt(blockedOut, x, y), `клетка (${x},${y})`).toBe(originalBlocked.split('\n')[y][x]);
      }
    }

    // Preset-режим: палитра = типы спеки (A/B); выбираем A и рисуем в свободной клетке (5,7).
    await page.getByRole('button', { name: /^Preset-кластеры/ }).click();
    await page.locator('button[title="A · A"]').click();
    await clickCell(page, 5, 7, W, H);
    await afterDraw(page);

    // Запрет рисования «поверх» (§3.6 ТЗ 04): blocked-кисть по клетке preset'а (1,5 → B) — noop.
    await page.getByRole('button', { name: /^Маска блокировок/ }).click();
    await clickCell(page, 1, 5, W, H); // занято B в preset — подсказка, клетка не меняется
    await afterDraw(page);

    await saveBtn(page).click();
    await expect.poll(() => cap.puts.length).toBe(2);
    const presetOut = cap.puts[1]['preset.txt'];
    expect(textAt(presetOut, 5, 7)).toBe('A');
    expect(textAt(presetOut, 1, 5)).toBe('B'); // blocked-кисть не затёрла preset
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (x === 5 && y === 7) continue;
        expect(textAt(presetOut, x, y), `клетка (${x},${y})`).toBe(originalPreset.split('\n')[y][x]);
      }
    }

    // После второго сохранения — снова чистое состояние.
    await expect(saveBtn(page)).not.toHaveText('●');
  });
});
