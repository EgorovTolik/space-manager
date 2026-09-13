// Регрессия «Прозрачность стен не работает при ПЕРВОЙ загрузке страницы»:
// стены (InstancedMesh) создавались с opaque-материалом (wallsOpacity=1), и
// движение слайдера без пересоздания меша визуально игнорировалось three.js —
// «чинилось» только сменой проекта (key по count → ремонтаж). E2E проверяет ровно
// воспроизведение симптома: загрузка ?project=&result= БЕЗ смены проекта + движение
// слайдера #param-opacity. Видимость/прозрачность стен — пиксельным «отпечатком»
// canvas (метод 08-fixes.spec.ts, рендер детерминирован: камера неподвижна).
import { test, expect, type Page } from '@playwright/test';
import { mockViewerApi, statusLine } from './helpers';

const RESULT = 'result-20260913-000000.txt';

/** Пиксельный «отпечаток» canvas: подсэмплированный 32-битный хеш RGBA. */
async function canvasFingerprint(page: Page): Promise<string> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    const tmp = document.createElement('canvas');
    tmp.width = canvas.width;
    tmp.height = canvas.height;
    const ctx = tmp.getContext('2d') as CanvasRenderingContext2D;
    ctx.drawImage(canvas, 0, 0);
    const data = ctx.getImageData(0, 0, tmp.width, tmp.height).data;
    let hash = 0;
    for (let i = 0; i < data.length; i += 97) {
      hash = (hash * 31 + data[i]) | 0;
    }
    return `${data.length}:${hash}`;
  });
}

test('слайдер «Прозрачность стен» работает сразу после первой загрузки (без смены проекта)', async ({
  page,
}) => {
  // Первая загрузка страницы с параметрами: проект и ревизия по URL — без ручного
  // выбора в панели «Проект» (в баге именно этот путь был сломан).
  await mockViewerApi(page, 'demo', [{ name: RESULT, fixture: 'report_basic.txt' }]);
  await page.goto(`/?project=demo&result=${RESULT}`);
  await expect(statusLine(page)).toContainText(/клеток · S = /);
  // Стабилизация WebGL (см. loadProjectReport в helpers.ts).
  await page.waitForTimeout(600);

  const opaqueFp = await canvasFingerprint(page);

  // Движение слайдера прозрачности БЕЗ смены проекта.
  await page.locator('#param-opacity').fill('0.3');
  await expect(page.locator('.opacity-value')).toHaveText('0.30');
  // needsUpdate → пересборка шейдера + кадр рендера.
  await page.waitForTimeout(600);

  const transparentFp = await canvasFingerprint(page);
  // В баге кадр НЕ менялся (opaque-пасс, NoBlending): стены оставались непрозрачными.
  expect(transparentFp).not.toBe(opaqueFp);

  // Возврат в 1.0 — невидимый (детерминированный) исходный кадр снова.
  await page.locator('#param-opacity').fill('1');
  await page.waitForTimeout(600);
  expect(await canvasFingerprint(page)).toBe(opaqueFp);
});
