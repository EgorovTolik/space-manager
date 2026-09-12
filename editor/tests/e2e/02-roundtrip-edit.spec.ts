// ТЗ 06 §3.1–§3.2: round-trip без изменений (маска — побайтово, спека — эквивалентность
// данных) + редактирование маски кликами по canvas (кисть toggle) и рисование preset'а
// символом из палитры; скачанные файлы сверяются с ожидаемым текстом.
import { expect, test } from '@playwright/test';
import * as yaml from 'js-yaml';
import { readFileSync } from 'node:fs';
import { afterDraw, blockedFileInput, clickCell, downloadButtons, manageDialogs, presetFileInput, specFileInput } from './helpers';
import { EXAMPLES, makeFixturesDir } from './fixtures';

const originalBlocked = readFileSync(EXAMPLES.blockedBasic, 'utf8');
const originalPreset = readFileSync(EXAMPLES.presetExample, 'utf8');

function textAt(text: string, x: number, y: number): string {
  return (text.split('\n')[y] ?? '')[x];
}

test.describe('Round-trip и редактирование масок (10×10)', () => {
  let fix: ReturnType<typeof makeFixturesDir>;

  test.beforeAll(() => {
    fix = makeFixturesDir();
  });

  test('§3.1 загрузка → скачивание без правок: маска побайтово, спека по данным', async ({ page }) => {
    const dialogs = manageDialogs(page, { action: 'accept' });
    await page.goto('/');
    await specFileInput(page).setInputFiles(fix.spec10);
    await blockedFileInput(page).setInputFiles(EXAMPLES.blockedBasic);
    await page.waitForTimeout(400); // debounce валидации
    await expect(page.getByText('Ошибок валидации нет')).toBeVisible();

    // Скачивание маски (без ошибок — без диалога): побайтовое совпадение.
    const [d1] = await Promise.all([
      page.waitForEvent('download'),
      downloadButtons(page).nth(1).click(),
    ]);
    expect(d1.suggestedFilename()).toBe('blocked_basic.txt');
    const maskOut = await d1.path();
    expect(readFileSync(maskOut!, 'utf8')).toBe(originalBlocked);

    // Скачивание спеки (диалог о комментариях — accept): эквивалентность данных.
    const [d2] = await Promise.all([
      page.waitForEvent('download'),
      downloadButtons(page).nth(0).click(),
    ]);
    expect(d2.suggestedFilename()).toBe('spec_10x10.yaml');
    const specOut = readFileSync((await d2.path())!, 'utf8');
    // Эквивалентность данных (ТЗ 06 §3.1) с учётом зафиксированного поведения:
    //  - загрузка маски ставит её basename в blockedFile (ТЗ 02 §6);
    //  - null-name у типов не сериализуется (канонический dump, ТЗ 02 §4).
    const loaded = yaml.load(specOut) as Record<string, unknown>;
    expect(loaded.blockedFile).toBe('blocked_basic.txt');
    expect(loaded.presetFile ?? null).toBeNull();
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

    // Диалог о потере комментариев действительно показывался (первое скачивание изменённой спеки).
    expect(dialogs().some((m) => m.includes('комментарии'))).toBeTruthy();
  });

  test('§3.2 кисть: заблокировать (5,5), снять (0,0); preset-кисть: поставить A в (5,7)', async ({ page }) => {
    manageDialogs(page, { action: 'accept' });
    await page.goto('/');
    await specFileInput(page).setInputFiles(fix.spec10);
    await blockedFileInput(page).setInputFiles(EXAMPLES.blockedBasic);
    await presetFileInput(page).setInputFiles(EXAMPLES.presetExample);
    await page.waitForTimeout(400);
    await expect(page.getByText('Ошибок валидации нет')).toBeVisible();

    // Режим «Маска блокировок» активен по умолчанию; кисть — toggle.
    const W = 10,
      H = 10;
    await clickCell(page, 5, 5, W, H); // была '.' → '*'
    await afterDraw(page);
    await clickCell(page, 0, 0, W, H); // была '*' → '.'
    await afterDraw(page);

    const [d1] = await Promise.all([page.waitForEvent('download'), downloadButtons(page).nth(1).click()]);
    const blockedOut = readFileSync((await d1.path())!, 'utf8');
    expect(textAt(blockedOut, 5, 5)).toBe('*');
    expect(textAt(blockedOut, 0, 0)).toBe('.');
    // Остальные клетки — без изменений.
    const origLines = originalBlocked.split('\n');
    const outLines = blockedOut.split('\n');
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if ((x === 5 && y === 5) || (x === 0 && y === 0)) continue;
        expect(textAt(blockedOut, x, y), `клетка (${x},${y})`).toBe(origLines[y][x]);
      }
    }

    // Preset-режим: палитра = типы спеки (A/B); выбираем A и рисуем в свободной клетке (5,7).
    await page.getByRole('button', { name: /^Preset-кластеры/ }).click();
    await page.locator('button[title="A · A"]').click();
    await clickCell(page, 5, 7, W, H);
    await afterDraw(page);

    const [d2] = await Promise.all([page.waitForEvent('download'), downloadButtons(page).nth(2).click()]);
    const presetOut = readFileSync((await d2.path())!, 'utf8');
    expect(textAt(presetOut, 5, 7)).toBe('A');
    // Остальные клетки — как в исходном эталоне.
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (x === 5 && y === 7) continue;
        expect(textAt(presetOut, x, y), `клетка (${x},${y})`).toBe(originalPreset.split('\n')[y][x]);
      }
    }

    // Запрет рисования «поверх» (§3.6 ТЗ 04): blocked-кисть по клетке preset'а (1,5 → B) — noop.
    await page.getByRole('button', { name: /^Маска блокировок/ }).click();
    await clickCell(page, 1, 5, W, H); // занято B в preset — подсказка, клетка не меняется
    await afterDraw(page);
    const [d3] = await Promise.all([page.waitForEvent('download'), downloadButtons(page).nth(2).click()]);
    const presetOut2 = readFileSync((await d3.path())!, 'utf8');
    expect(textAt(presetOut2, 1, 5)).toBe('B');
  });
});
