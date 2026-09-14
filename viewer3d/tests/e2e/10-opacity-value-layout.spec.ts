// ST-2 (раунд 4): числовой показатель слайдера «Прозрачность стен» (.opacity-value)
// должен быть целиком ВНУТРИ контейнера «Параметры» (.panel-params) при любом
// значении 0–1 — раньше значение выходило за правый край панели (intrinsic-ширина
// range + min-width значения не сжимались). Регрессия: bounding box показателя
// ⊆ bounding box панели при opacity = 0 / 0.5 / 1, ширина показателя постоянна
// (фикс width + tabular-nums — без скачков вёрстки при изменении значения).
import { test, expect } from '@playwright/test';
import { mockViewerApi, statusLine } from './helpers';

const RESULT = 'result-20260913-000000.txt';

/** Bounding box элемента в координатах viewport (boundingBox → x/y ⇒ left/right). */
async function box(page: import('@playwright/test').Page, selector: string) {
  const b = (await page.locator(selector).boundingBox())!;
  return { left: b.x, right: b.x + b.width, width: b.width };
}

test('показатель «Прозрачность стен» целиком внутри панели «Параметры» (0 / 0.5 / 1)', async ({
  page,
}) => {
  await mockViewerApi(page, 'demo', [{ name: RESULT, fixture: 'report_basic.txt' }]);
  await page.goto(`/?project=demo&result=${RESULT}`);
  await expect(statusLine(page)).toContainText(/клеток · S = /);

  let firstWidth: number | null = null;
  for (const value of ['0', '0.5', '1']) {
    await page.locator('#param-opacity').fill(value);
    // Формат значения в панели — toFixed(2) (ParamsPanel.tsx).
    await expect(page.locator('.opacity-value')).toHaveText(`${Number.parseFloat(value).toFixed(2)}`);

    const panel = (await box(page, '.panel-params'))!;
    const val = (await box(page, '.opacity-value'))!;
    // Показатель полностью внутри контейнера «Параметры» (субпиксельный допуск 0.5px).
    expect(val.left, `left@${value}`).toBeGreaterThanOrEqual(panel.left - 0.5);
    expect(val.right, `right@${value}`).toBeLessThanOrEqual(panel.right + 0.5);

    // Без скачков: ширина поля числа одинакова при всех значениях (фикс width).
    if (firstWidth === null) {
      firstWidth = val.width;
    } else {
      expect(val.width, `width@${value}`).toBeCloseTo(firstWidth, 1);
    }
  }
});
