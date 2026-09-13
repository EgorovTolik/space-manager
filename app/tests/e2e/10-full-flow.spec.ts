// Сквозной e2e единого сервиса (ТЗ docs-unified/05 §4): 11 шагов НА РЕАЛЬНОМ
// сервере (webServer из playwright.config.ts, tmp-workspace) и настоящем Python-солвере.
//
//   менеджер: создание проекта → редактор: правки + генерация (×2 ревизии) →
//   viewer3d: сцена, переключение ревизий, PNG в preview/ → менеджер: превью/модалка,
//   состав архива (zip), импорт архива обратно как новый проект.
//
// Детерминизм: ожидания по состоянию UI/диска (без «просто подождать»); генерация
// 20×20 занимает доли секунды, таймаут теста — с большим запасом.

import { test as base, expect } from '@playwright/test';
import AdmZip from 'adm-zip';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { e2eWorkspace } from './workspace';

// При отсутствии venv — пропуск файла (ТЗ 05 §8 п.3), а не падение.
const VENV_PYTHON = fileURLToPath(new URL('../../../.venv/bin/python', import.meta.url));
base.skip(!fs.existsSync(VENV_PYTHON), 'нет .venv/bin/python — реальный солвер недоступен (ТЗ 05 §8)');
const test = base;

const PROJECT = 'e2e-demo';
const IMPORTED = 'imported'; // плоский архив → имя выводит сервер (ТЗ 02 §6.6)

// ── Диск: tmp-workspace, тот же, что у webServer (env SPACEMGR_WORKSPACE) ────────
const projDir = (name: string): string => path.join(e2eWorkspace, name);
const resultFiles = (name: string): string[] =>
  fs
    .readdirSync(projDir(name))
    .filter((f) => /^result-.*\.txt$/.test(f))
    .sort()
    .reverse(); // desc — свежая первая (как в GET …/results)

// ── Canvas редактора: клик по клетке при fit (pan=0, zoom=1) ─────────────────────
function mainCanvas(page: import('@playwright/test').Page) {
  return page.locator('main canvas').first();
}
async function clickCell(
  page: import('@playwright/test').Page,
  x: number,
  y: number,
  gridW: number,
  gridH: number,
): Promise<void> {
  const box = await mainCanvas(page).boundingBox();
  if (!box) throw new Error('canvas редактора не найден');
  const cell = Math.min(box.width / gridW, box.height / gridH);
  await mainCanvas(page).click({ position: { x: (x + 0.5) * cell, y: (y + 0.5) * cell } });
}

test.describe.serial('сквозной сценарий: проект → редактор → генерация → viewer3d → архив', () => {
  test.setTimeout(180_000);

  // Self-cleaning: после прогона удаляем созданные проекты, чтобы другие спеки файла
  // (smoke ожидает пустой список) не зависели от порядка исполнения.
  test.afterAll(() => {
    for (const name of [PROJECT, IMPORTED]) {
      fs.rmSync(projDir(name), { recursive: true, force: true });
    }
  });

  let firstResult = ''; // имя result-файла первой ревизии (для шагов 6–7)

  test('шаги 1–5: создание проекта, правки в редакторе, генерация, проверка диска', async ({ page }) => {
    // ── Шаг 1: менеджер → создать проект e2e-demo ────────────────────────────────
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Space Manager · проекты' })).toBeVisible();
    await page.getByRole('button', { name: '＋ Создать проект' }).first().click();
    await page.getByPlaceholder('имя проекта (напр., «Офис Б», до 64 символов)').fill(PROJECT);
    await page.getByRole('button', { name: 'Создать', exact: true }).click();

    const card = page.locator('.card', { hasText: PROJECT });
    await expect(card).toBeVisible();
    // Скелет (ТЗ 02 §4): spec.yaml + blocked.txt + preset.txt (+ project.json служебный).
    for (const f of ['project.json', 'spec.yaml', 'blocked.txt', 'preset.txt']) {
      expect(fs.existsSync(path.join(projDir(PROJECT), f)), `на диске должен быть ${f}`).toBe(true);
    }

    // ── Шаг 2: открыть редактор по ссылке карточки ───────────────────────────────
    await card.getByRole('link', { name: 'Редактор' }).click();
    // vite base '/editor/' → URL с trailing slash: /editor/?project=…
    await expect(page).toHaveURL(/\/editor\/?\?project=e2e-demo/);
    // Спека загружена: W×H = 20×20, кластер room1 в панели, ошибок валидации НЕТ.
    await expect(page.getByRole('combobox', { name: 'Проект' })).toHaveValue(PROJECT, { timeout: 15_000 });
    await expect(page.getByRole('textbox', { name: 'ширина' })).toHaveValue('20');
    await expect(page.getByRole('textbox', { name: 'высота' })).toHaveValue('20');
    const clustersPanel = page.locator('section.panel', {
      has: page.getByRole('heading', { name: 'Кластеры' }),
    });
    await expect(clustersPanel.getByText('room1', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Ошибок валидации нет')).toBeVisible({ timeout: 15_000 });

    // ── Шаг 3: кистью 2 blocked-клетки + второй кластер (Σ долей = 100 %) ────────
    await clickCell(page, 9, 10, 20, 20);
    await page.waitForTimeout(250); // сброс stroke в rAF (паттерн editor e2e)
    await clickCell(page, 10, 10, 20, 20);
    await page.waitForTimeout(250);

    // room1: 100 % → 70 % (строка списка кластеров с id room1 → кнопка ✎).
    const roomRow = clustersPanel.locator('div').filter({ has: page.getByText('room1', { exact: true }) }).last();
    // Доступное имя кнопки — её текст «✎» (title не участвует, когда есть контент).
    await roomRow.getByRole('button', { name: '✎' }).click();
    const editForm = page.locator('div').filter({ has: page.getByText('Редактировать кластер', { exact: true }) }).last();
    await expect(editForm).toBeVisible();
    await editForm.getByLabel('areaPercent (%)').fill('70');
    await editForm.getByRole('button', { name: 'Сохранить' }).click();
    await expect(editForm).toHaveCount(0);

    // room2: новый кластер, тип ROOM (единственный в реестре шаблона), 30 %, free.
    await clustersPanel.getByRole('button', { name: '＋ Добавить' }).click();
    const addForm = page.locator('div').filter({ has: page.getByText('Добавить кластер', { exact: true }) }).last();
    await expect(addForm).toBeVisible();
    await addForm.getByLabel('id').fill('room2');
    await addForm.getByLabel('areaPercent (%)').fill('30');
    await expect(addForm.getByLabel('type')).toHaveValue('ROOM'); // дефолт — первый тип реестра
    await addForm.getByRole('button', { name: 'Сохранить' }).click();
    await expect(addForm).toHaveCount(0);
    await expect(clustersPanel.getByText('room2', { exact: true })).toBeVisible();
    // Σ = 100 % — строка подсказки без «больше 100».
    await expect(clustersPanel.getByText(/Сумма долей: 100 ?%/)).toBeVisible();

    // Dirty ● на «Сохранить в проект» (редактирование ещё не сохранено).
    await expect(page.getByRole('button', { name: /Сохранить в проект.*●/ })).toBeVisible();

    // ── Шаг 4: [Генерировать размещение] → автосохранение + зелёная строка ───────
    await page.getByRole('button', { name: /Генерировать размещение/ }).click();
    const success = page.getByText(/Размещение найдено: result-.*\.txt/);
    await expect(success).toBeVisible({ timeout: 60_000 }); // индикатор «занимается» → результат
    firstResult = (await success.textContent())!.match(/result-[\w.-]+\.txt/)![0];
    const viewerLink = page.getByRole('link', { name: 'Открыть в Viewer3D' });
    await expect(viewerLink).toHaveAttribute(
      'href',
      `/viewer3d?project=${PROJECT}&result=${encodeURIComponent(firstResult)}`,
    );

    // ── Шаг 5: проверка диска (node-assert в тесте) ──────────────────────────────
    const onDisk = resultFiles(PROJECT);
    expect(onDisk).toHaveLength(1);
    expect(onDisk[0]).toBe(firstResult);
    const report = fs.readFileSync(path.join(projDir(PROJECT), firstResult), 'utf8');
    for (const marker of [
      '== КАРТА ==',
      '== ТАБЛИЦА: запрошено / фактически / отклонение ==',
      '== ПРЕДУПРЕЖДЕНИЯ ==',
    ]) {
      expect(report, `в отчёте секция «${marker}»`).toContain(marker);
    }
    // Автосохранение перед генерацией: клетки кисти и второй кластер — на диске.
    const blockedOnDisk = fs.readFileSync(path.join(projDir(PROJECT), 'blocked.txt'), 'utf8');
    expect(blockedOnDisk.split('\n')[10]).toContain('**'); // клетки (9,10) и (10,10)
    const specOnDisk = fs.readFileSync(path.join(projDir(PROJECT), 'spec.yaml'), 'utf8');
    expect(specOnDisk).toContain('id: room2');
    const meta = JSON.parse(fs.readFileSync(path.join(projDir(PROJECT), 'project.json'), 'utf8')) as {
      latestResult: string | null;
    };
    expect(meta.latestResult).toBe(firstResult);
  });

  test('шаги 6–8: viewer3d — сцена, вторая ревизия, переключение, PNG в preview/', async ({ page }) => {
    // ── Шаг 6: открыть Viewer3D по канонической ссылке (как из блока результата) ──
    await page.goto(`/viewer3d?project=${PROJECT}&result=${encodeURIComponent(firstResult)}`);

    // Комната(ы) в списке (≥ 1), строка статуса по отчёту, canvas сцены не пуст.
    const rows = page.locator('.rooms-table tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 20_000 });
    expect(await rows.count()).toBeGreaterThanOrEqual(1);
    await expect(page.locator('.status-line')).toContainText(`проект: ${PROJECT} · файл: ${firstResult}`);
    await expect(page.locator('.status-line')).toContainText('комнат:');

    // Canvas «не пустой»: в GL-канвасе больше одного цвета (фон + пол/стены).
    // Polling — ждём состояние (первый кадр), а не разовое чтение по таймеру.
    const distinctColors = () =>
      page.locator('main canvas').first().evaluate((c) => {
        try {
          const tmp = document.createElement('canvas');
          tmp.width = 64;
          tmp.height = 64;
          const ctx = tmp.getContext('2d')!;
          ctx.drawImage(c as HTMLCanvasElement, 0, 0, 64, 64);
          const d = ctx.getImageData(0, 0, 64, 64).data;
          const s = new Set<number>();
          for (let i = 0; i < d.length; i += 16) {
            s.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
          }
          return s.size;
        } catch {
          return -1;
        }
      });
    await expect.poll(distinctColors, { timeout: 20_000 }).toBeGreaterThan(1);

    // ── Шаг 7: вторая ревизия из редактора → переключение в viewer3d ─────────────
    await page.goto(`/editor?project=${PROJECT}`);
    await expect(page.getByRole('combobox', { name: 'Проект' })).toHaveValue(PROJECT, { timeout: 15_000 });
    // Состояние чистое (сохранено при первой генерации) — просто второй запуск.
    await page.getByRole('button', { name: /Генерировать размещение/ }).click();
    const success2 = page.getByText(/Размещение найдено: result-.*\.txt/);
    await expect(success2).toBeVisible({ timeout: 60_000 });
    const secondResult = (await success2.textContent())!.match(/result-[\w.-]+\.txt/)![0];

    const onDisk = resultFiles(PROJECT);
    expect(onDisk).toHaveLength(2); // обе ревизии на диске
    expect(new Set([firstResult, secondResult]).size).toBe(2);

    // Viewer3d без ?result= → автовыбор свежей; селектор показывает ДВА файла.
    await page.goto(`/viewer3d?project=${PROJECT}`);
    const revSelect = page.getByRole('combobox', { name: 'Файл результата (ревизия)' });
    await expect(revSelect).toBeEnabled({ timeout: 20_000 });
    await expect(revSelect.locator('option')).toHaveCount(3); // placeholder + 2 ревизии
    // Placeholder «— выберите файл —» не считается ревизией.
    const options = (await revSelect.locator('option').allTextContents()).filter((t) => t.startsWith('result-'));
    expect(options.sort()).toEqual([firstResult, secondResult].sort());

    // Смена на другую ревизию → сцена перестроена: статус и список комнат по отчёту.
    const current = await revSelect.inputValue();
    const other = options.find((o) => o !== current)!;
    await revSelect.selectOption(other);
    await expect(page.locator('.status-line')).toContainText(`файл: ${other}`, { timeout: 20_000 });
    await expect(rows.first()).toBeVisible({ timeout: 20_000 });
    // Ждём реальный отрисованный кадр новой сцены (R3F монтирует Canvas асинхронно):
    // без этого клик [PNG] в первые мгновения мог попасть до регистрации обработчика.
    await expect.poll(distinctColors, { timeout: 20_000 }).toBeGreaterThan(1);

    // ── Шаг 8: [PNG] → POST preview, файл в preview/ на диске ────────────────────
    await page.getByRole('button', { name: 'PNG', exact: true }).click();
    const saved = page.getByText(/Предпросмотр сохранён в проект: preview-[\w-]+\.png/);
    await expect(saved).toBeVisible({ timeout: 20_000 });
    const pngName = (await saved.textContent())!.match(/preview-[\w-]+\.png/)![0];
    const pngPath = path.join(projDir(PROJECT), 'preview', pngName);
    expect(fs.existsSync(pngPath)).toBe(true);
    expect(fs.statSync(pngPath).size).toBeGreaterThan(100);
  });

  test('шаги 9–11: менеджер — превью/модалка, состав архива, импорт обратно', async ({ page }) => {
    // ── Шаг 8 (продолжение): в менеджере на карточке появилась миниатюра ─────────
    await page.goto('/');
    const card = page.locator('.card', { hasText: PROJECT });
    await expect(card).toBeVisible();
    const thumb = card.locator('.preview-strip img');
    await expect(thumb.first()).toBeVisible({ timeout: 15_000 }); // ленивая подгрузка превью

    // ── Шаг 9: клик по миниатюре → модалка оригинала, Esc закрывает ──────────────
    await thumb.first().click();
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible();
    await expect(modal.locator('img.preview-full')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);

    // ── Шаг 10: [⬇ Архив] → intercept-скачивание, проверка состава zip ───────────
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      card.getByRole('link', { name: '⬇ Архив' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(new RegExp(`^${PROJECT}-\\d{8}-\\d{6}\\.zip$`));
    const zipPath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'sm-e2e-zip-')),
      download.suggestedFilename(),
    );
    await download.saveAs(zipPath);

    const zip = new AdmZip(zipPath);
    const names = zip.getEntries().map((e) => e.entryName).sort();
    const results = resultFiles(PROJECT);
    // Ровно: спека + обе маски + ОБА result-*; без project.json и preview/.
    expect(names).toEqual(['blocked.txt', 'preset.txt', 'spec.yaml', ...results].sort());
    expect(names.some((n) => n === 'project.json' || n.startsWith('preview/'))).toBe(false);

    // ── Шаг 11: импорт скачанного архива → новый проект, спека идентична, генерация OK ──
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: /Импортировать из архива/ }).click(),
    ]);
    await chooser.setFiles(zipPath);
    // Имя выводит сервер: плоский архив → «imported» (коллизий нет).
    await expect(page.getByText(new RegExp(`Проект «${IMPORTED}» импортирован`))).toBeVisible({ timeout: 20_000 });
    const importedCard = page.locator('.card', { hasText: IMPORTED });
    await expect(importedCard).toBeVisible();

    // Спека импортированного проекта побайтово = исходной.
    const specA = fs.readFileSync(path.join(projDir(PROJECT), 'spec.yaml'), 'utf8');
    const specB = fs.readFileSync(path.join(projDir(IMPORTED), 'spec.yaml'), 'utf8');
    expect(specB).toBe(specA);

    // Генерация в импортированном проекте проходит (exit 0) — через API того же сервера.
    const genRes = await page.request.post(`/api/projects/${IMPORTED}/generate`);
    expect(genRes.status()).toBe(200);
    const body = (await genRes.json()) as { exitCode: number; feasible: boolean; resultFile: string };
    expect(body.exitCode).toBe(0);
    expect(body.feasible).toBe(true);
    expect(fs.existsSync(path.join(projDir(IMPORTED), body.resultFile))).toBe(true);
  });
});
