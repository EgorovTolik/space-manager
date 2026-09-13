// E7 (docs-unified/04 §2.1/§2.5): КЛЮЧЕВАЯ фича проектного режима — переключение
// между ревизиями генерации: селектор result-* подгружает другой файл, сцена
// перестраивается; URL ?project=&result= — автовыбор конкретной ревизии.

import { test, expect } from '@playwright/test';
import { fixtureText, mockViewerApi, selectProject, selectResult, statusLine } from './helpers';

const NEW_RESULT = 'result-20260913-000000.txt';
const OLD_RESULT = 'result-20260901-000000.txt';

const REV_RESULTS = [
  { name: NEW_RESULT, fixture: 'report_basic.txt' }, // 50×50, 3 комнаты (room1/room2/corridor1)
  { name: OLD_RESULT, fixture: 'report_minimal.txt' }, // 4×3, 4 комнаты (ra/rb/rc/rd)
];

test('E7a: переключение ревизии — сцена перестраивается без потери работы', async ({ page }) => {
  await mockViewerApi(page, 'demo', REV_RESULTS);
  await page.goto('/');
  await selectProject(page, 'demo');

  // Автовыбор — свежая ревизия (первая в списке).
  await expect(statusLine(page)).toContainText(`файл: ${NEW_RESULT}`);
  await expect(statusLine(page)).toContainText('50×50');
  await expect(statusLine(page)).toContainText('комнат: 3');
  const rowsNew = page.locator('.rooms-table tbody tr');
  await expect(rowsNew).toHaveCount(3);

  // Переключаемся на старую ревизию.
  await selectResult(page, OLD_RESULT);
  await expect(statusLine(page)).toContainText(`файл: ${OLD_RESULT}`);
  await expect(statusLine(page)).toContainText('4×3');
  await expect(statusLine(page)).toContainText('комнат: 4');

  // Список комнат перестроился под новые данные (ra/rb/rc/rd, без room1).
  const rowsOld = page.locator('.rooms-table tbody tr');
  await expect(rowsOld).toHaveCount(4);
  await expect(rowsOld.first()).toContainText('ra');
  await expect(page.locator('.rooms-table tbody tr', { hasText: 'room1' })).toHaveCount(0);

  // И обратно — свежая ревизия снова на месте (ничего не потеряно).
  await selectResult(page, NEW_RESULT);
  await expect(statusLine(page)).toContainText(`файл: ${NEW_RESULT}`);
  await expect(rowsNew).toHaveCount(3);

  // URL обогатился ?project=&result= текущей ревизией (replaceState, §2.5).
  await expect.poll(() => page.evaluate(() => window.location.search)).toBe(
    `?project=demo&result=${NEW_RESULT}`,
  );
});

test('E7b: URL ?project=&result= — автовыбор конкретной ревизии', async ({ page }) => {
  await mockViewerApi(page, 'demo', REV_RESULTS);
  await page.goto(`/?project=demo&result=${OLD_RESULT}`);

  // Старая (не первая) ревизия выбрана автоматически.
  await expect(statusLine(page)).toContainText(`файл: ${OLD_RESULT}`);
  await expect(statusLine(page)).toContainText('4×3');
  await expect(statusLine(page)).toContainText('комнат: 4');

  // Селектор ревизий показывает выбранную.
  const revSelect = page.getByRole('combobox', { name: 'Файл результата (ревизия)' });
  await expect(revSelect).toHaveValue(OLD_RESULT);
});

test('E7c: ?result= отсутствует в списке — игнорируется, берётся свежая (§2.5)', async ({ page }) => {
  await mockViewerApi(page, 'demo', REV_RESULTS);
  await page.goto('/?project=demo&result=result-19990101-000000.txt');

  await expect(statusLine(page)).toContainText(`файл: ${NEW_RESULT}`);
  await expect(statusLine(page)).toContainText('50×50');

  // Баннера «не найдено» нет — неизвестная ревизия молча игнорируется.
  await expect(page.locator('.file-error')).toHaveCount(0);
});

test('E7d: проект из URL не существует → баннер, сцена пуста', async ({ page }) => {
  await mockViewerApi(page, 'demo', REV_RESULTS, ['other']);
  // fixtureText подтянут для полноты мока (содержимое не используется).
  void fixtureText('report_minimal.txt');
  await page.goto('/?project=missing&result=x.txt');

  await expect(page.locator('.file-error')).toContainText('Проект «missing» не найден');
  await expect(page.locator('.scene-placeholder')).toBeVisible();
});
