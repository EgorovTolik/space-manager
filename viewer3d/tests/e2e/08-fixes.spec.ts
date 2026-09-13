// Замечания к единому сервису (viewer3d):
// - 5: «Скрыть стены» — при скрытии стены исчезают из сцены, а при повторном
//   показе ВОССТАНАВЛИВАЮТСЯ (регрессия: после unmount/remount InstancedMesh
//   матрицы инстансов не пересетивались — новый mesh оставался невидимым);
// - 6: подписи комнат в сцене показывают площадь (size · S², формат как в
//   таблице КОМНАТЫ);
// - 2: ?project=<slug> с name ≠ slug — автозагрузка; статусы — человекочитаемое
//   имя, URL — slug.
// Видимость стен проверяется пиксельным «отпечатком» canvas (WebGL не в DOM):
// кадры «стены есть»/«стен нет» должны отличаться, а после повторного показа —
// совпасть с исходным кадром (рендер детерминирован: камера неподвижна).
import { test, expect, type Page } from '@playwright/test';
import { loadProjectReport, mockViewerApi, statusLine } from './helpers';

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

async function toggleWalls(page: Page): Promise<void> {
  await page.locator('#param-hide-walls').click({ force: true });
  // debounce стен 200 мс + кадр рендера.
  await page.waitForTimeout(600);
}

test.describe('Замечания к единому сервису (viewer3d)', () => {
  test('5: «Скрыть стены» — стены исчезают и восстанавливаются при повторном показе', async ({
    page,
  }) => {
    // loadProjectReport: mock API + выбор проекта + ожидание сцены/стабилизации.
    await loadProjectReport(page, 'demo', [
      { name: RESULT, fixture: 'report_basic.txt' },
    ]);
    await page.waitForTimeout(500);

    const onFp = await canvasFingerprint(page);

    await toggleWalls(page);
    const offFp = await canvasFingerprint(page);
    // Кадр без стен отличается от кадра со стенами.
    expect(offFp).not.toBe(onFp);

    await toggleWalls(page);
    const onAgainFp = await canvasFingerprint(page);
    // Стены вернулись: кадр снова совпадает с исходным (регрессия замечания 5).
    expect(onAgainFp).toBe(onFp);
  });

  test('6: подписи комнат в сцене показывают площадь, как в таблице КОМНАТЫ', async ({
    page,
  }) => {
    await loadProjectReport(page, 'demo', [
      { name: RESULT, fixture: 'report_basic.txt' },
    ]);

    // Каждая подпись в сцене: метка + площадь (td[4] таблицы КОМНАТЫ).
    const rows = await page.locator('.rooms-table tbody tr').evaluateAll((trs) =>
      trs.map((tr) => {
        const tds = Array.from(tr.querySelectorAll('td'));
        return { label: tds[0]?.textContent?.trim() ?? '', area: tds[4]?.textContent?.trim() ?? '' };
      }),
    );
    // В report_basic все комнаты ≥ 4 клеток → подписи есть.
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const row of rows) {
      const label = page.locator('.room-label', { hasText: row.label });
      await expect(label).toBeVisible();
      await expect(label.locator('.room-label-area')).toHaveText(row.area);
    }
  });

  test('2: ?project=<slug> при name ≠ slug — автозагрузка; статус — имя, URL — slug', async ({
    page,
  }) => {
    const NAME = 'Демо офис';
    const SLUG = 'demo-office';
    await mockViewerApi(
      page,
      NAME,
      [{ name: RESULT, fixture: 'report_basic.txt' }],
      [],
      SLUG,
    );
    await page.goto(`/?project=${SLUG}`);

    // Сцена построилась по slug.
    await expect(statusLine(page)).toContainText(/клеток · S = /);
    // Статусы — человекочитаемое имя (панель и строка статуса сцены).
    await expect(
      page.locator('.panel-files li').filter({ hasText: `проект: ${NAME}` }),
    ).toBeVisible();
    await expect(statusLine(page)).toContainText(`проект: ${NAME}`);
    // URL — slug + автовыбранная ревизия.
    await expect
      .poll(() => page.evaluate(() => window.location.search))
      .toBe(`?project=${SLUG}&result=${RESULT}`);
  });
});
