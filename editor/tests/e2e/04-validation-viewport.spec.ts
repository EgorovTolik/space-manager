// docs-unified/06 §3.5: валидация на лету (V-CLUST-SUM в баннере; V-MASK-PRESET —
// подсветка клеток красным пунктиром) для проекта, загруженного с мок-API.
// docs-unified/06 §3.6: viewport сетки 200×200 — fit, зум колесом, координаты, панорамирование.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { mainCanvas, mockProject, selectProject, statusLine } from './helpers';
import { EXAMPLES, SPEC_SUM_110, SPEC_TYPE_A_ONLY } from './fixtures';

test.describe('Валидация на лету (docs-unified/06 §3.5)', () => {
  test('сумма долей > 100 → V-CLUST-SUM в баннере и подсказке панели кластеров', async ({ page }) => {
    await mockProject(page, 'demo', { 'spec.yaml': SPEC_SUM_110 });
    await page.goto('/');
    await selectProject(page, 'demo');

    // Debounce валидации 300 мс — баннер обновится сам.
    const banner = page.getByRole('button', { name: /Ошибки валидации \(1\)/ });
    await expect(banner).toBeVisible({ timeout: 5000 });
    await banner.click();
    await expect(page.locator('code').getByText('V-CLUST-SUM')).toBeVisible();

    // Панель кластеров тоже показывает превышение суммы.
    const clustersPanel = page.locator('section.panel', { has: page.getByRole('heading', { name: 'Кластеры' }) });
    await expect(clustersPanel.getByText(/Сумма долей: 110 % \(/)).toBeVisible();
  });

  test('preset с чужим символом → V-MASK-PRESET, клетки подсвечены красным пунктиром', async ({ page }) => {
    await mockProject(page, 'demo', {
      'spec.yaml': SPEC_TYPE_A_ONLY, // только тип A; в preset_example есть B
      'preset.txt': readFileSync(EXAMPLES.presetExample, 'utf8'),
    });
    await page.goto('/');
    await selectProject(page, 'demo');

    const banner = page.getByRole('button', { name: /Ошибки валидации \(1\)/ });
    await expect(banner).toBeVisible({ timeout: 5000 });
    await banner.click();
    await expect(page.locator('code').getByText('V-MASK-PRESET')).toBeVisible();

    // Подсветка клеток на canvas: красный пунктир (C_ERROR #e53935) вокруг клетки (1,5),
    // занятой чужим символом B. Проверяем именно этот region: заполнение A-клеток
    // палитрой может содержать похожие цвета, а B-клетка отрисована как свободная.
    const box = (await mainCanvas(page).boundingBox())!;
    const cell = Math.min(box.width / 10, box.height / 10);
    await page.waitForTimeout(400); // перерисовка после UI_SET_ERRORS
    const redPixels = await page.evaluate(
      ({ x0, y0, x1, y1 }) => {
        const canvas = document.querySelector<HTMLCanvasElement>('main canvas');
        if (!canvas) return -1;
        const off = document.createElement('canvas');
        off.width = Math.max(1, x1 - x0);
        off.height = Math.max(1, y1 - y0);
        const ctx = off.getContext('2d')!;
        // Канвас same-origin (без внешних изображений) — копирование синхронное.
        ctx.drawImage(canvas, x0, y0, off.width, off.height, 0, 0, off.width, off.height);
        const data = ctx.getImageData(0, 0, off.width, off.height).data;
        let n = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i] > 180 && data[i + 1] < 90 && data[i + 2] < 90) n++;
        }
        return n;
      },
      {
        x0: Math.floor(1 * cell),
        y0: Math.floor(5 * cell),
        x1: Math.ceil(2 * cell),
        y1: Math.ceil(6 * cell),
      },
    );
    expect(redPixels, 'красная пунктирная подсветка клетки (1,5) V-MASK-PRESET').toBeGreaterThan(5);
  });
});

test.describe('Viewport сетки 200×200 (docs-unified/06 §3.6)', () => {
  test('создание спеки с нуля, fit, зум колесом, координаты курсора, панорамирование', async ({ page }) => {
    await mockProject(page, 'demo', { 'spec.yaml': SPEC_50X50_FOR_VIEWPORT });
    await page.goto('/');

    // «＋ Создать спеку…» → 200×200 (Решение Б: вместе со спекой — две пустые маски).
    await page.getByRole('button', { name: '＋ Создать спеку…' }).click();
    await page.getByLabel(/ширина/).fill('200');
    await page.getByLabel(/высота/).fill('200');
    // Кнопка «Применить» в диалоге создания (до применения других W×H-полей нет).
    await page.getByRole('button', { name: 'Применить' }).click();

    const canvas = mainCanvas(page);
    await expect(statusLine(page)).toContainText('клеток всего 200×200');
    // Две пустые маски созданы — режимы активны.
    await expect(page.getByRole('button', { name: /^Маска блокировок/ })).toBeEnabled();
    await expect(page.getByRole('button', { name: /^Preset-кластеры/ })).toBeEnabled();

    // Fit: zoom = 1.00×; миникарта присутствует (второй canvas).
    await expect(statusLine(page)).toContainText('zoom 1.00×');
    expect(await page.locator('main canvas').count()).toBe(2);

    // Координаты курсора в строке статуса (fit: pan=0, zoom=1).
    const box = (await canvas.boundingBox())!;
    const baseCell = Math.min(box.width / 200, box.height / 200);
    await canvas.hover({ position: { x: (50 + 0.5) * baseCell, y: (70 + 0.5) * baseCell } });
    await expect(statusLine(page)).toContainText('x=50 y=70');

    // Зум колесом к курсору: deltaY < 0 → ×1.25.
    await canvas.dispatchEvent('wheel', { deltaY: -120, clientX: box.width / 2, clientY: box.height / 2 });
    await page.waitForTimeout(200);
    await expect(statusLine(page)).toContainText('zoom 1.25×');

    // Панорамирование средней кнопкой: viewport сместился → координаты той же точки изменились.
    await page.mouse.move(box.width / 2, box.height / 2);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(box.width / 2 - 60, box.height / 2 - 40, { steps: 5 });
    await page.mouse.up({ button: 'middle' });
    await page.waitForTimeout(200);
    await canvas.hover({ position: { x: (50 + 0.5) * baseCell, y: (70 + 0.5) * baseCell } });
    const status = await statusLine(page).textContent();
    expect(status).toMatch(/x=\d+ y=\d+/);
    // После панорамирования та же экранный точка — уже не клетка (50, 70): смещение произошло.
    expect(status).not.toContain('x=50 y=70');

    // Сброс зума клавишей «0» → fit.
    await page.keyboard.press('0');
    await page.waitForTimeout(200);
    await expect(statusLine(page)).toContainText('zoom 1.00×');
  });
});

// Минимальная спека для мока списка проектов (в сценарии viewport проект не выбирается).
const SPEC_50X50_FOR_VIEWPORT = `grid:
  width: 10
  height: 10
blockedFile: null
presetFile: null
types:
  A: { symbol: "A", name: null }
rules:
  connectivity: 8
  adjacency: { forbidden: [], allow: null }
  size: { min: null, max: null }
  convexity: { weight: soft }
  fillAll: false
  touchAll: false
clusters:
  - id: a1
    type: A
    areaPercent: 50
    shape: free
`;
