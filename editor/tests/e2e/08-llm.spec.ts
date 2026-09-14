// docs-llm/06 §2: раздел «LLM-генерация» в панели Файлы.
// - список моделей из /api/llm/providers (optgroup по провайдерам, defaultModel выбран);
// - запуск: тело POST llm-generate (prompt/modelId/limits; пустые лимиты — не передаются),
//   лог обновляется опросом ~1.5 c, кандидаты с «рекомендовано» и ссылками Viewer3D;
// - «Стоп» → POST llm-stop, состояние stopped + error из ответа;
// - totalTimeoutSec больше нет в UI: в тело POST llm-generate поле не попадает (LST-8);
// - лог шагов — блоки-строки с отступом в контейнере с max-height/overflow-y (LST-8);
// - note из статуса/журнала (авто-завершение по стагнации) показан под логом (LST-8);
// - configured=false → блок «LLM не настроен», элементы disabled, обычная генерация работает;
// - 409 LLM_SESSION_ACTIVE → «Уже идёт LLM-прогон» + наблюдение за активной сессией.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { generateBtn, mockProject, selectProject } from './helpers';
import type { MockLlmSessionSummary } from './helpers';
import { EXAMPLES, RESULT_FILE, SPEC_10X10_MASKED } from './fixtures';
import { ru } from '../../src/i18n/ru';

const FILES = {
  'spec.yaml': SPEC_10X10_MASKED,
  'blocked.txt': readFileSync(EXAMPLES.blockedBasic, 'utf8'),
};

// ── Фикстуры LLM (форматы docs-llm/06 §1) ────────────────────────────────────────

const PROVIDERS = {
  configured: true,
  defaultModel: 'eac-mac-ai/qwen.gguf',
  providers: [
    {
      id: 'eac-mac-ai',
      models: [
        { id: 'qwen.gguf', label: 'лучшая локальная' },
        { id: 'small.gguf', label: null },
      ],
    },
    { id: 'eac-home-ai', models: [{ id: 'home.gguf', label: 'домашняя' }] },
  ],
};

const LOG_1 = [
  { n: 1, action: 'run_generation', ok: true, summary: 'result-llm-a.txt (exit 0)' },
];
const LOG_2 = [
  ...LOG_1,
  { n: 2, action: 'read_result', ok: true, summary: 'отчёт: feasible, отклонения в норме' },
];

const STATUS_RUNNING_1 = { state: 'running', log: LOG_1, error: null, startedAt: 't0', finishedAt: null };
const STATUS_RUNNING_2 = { state: 'running', log: LOG_2, error: null, startedAt: 't0', finishedAt: null };
const STATUS_DONE = {
  state: 'done',
  log: [
    ...LOG_2,
    { n: 3, action: 'finish', ok: true, summary: 'кандидаты выбраны' },
  ],
  candidates: [
    { file: 'result-llm-a.txt', comment: 'лучшая раскладка: комнаты ближе к целям' },
    { file: 'result-llm-b.txt', comment: 'вариант с шире коридором' },
  ],
  recommended: 'result-llm-a.txt',
  error: null,
  startedAt: 't0',
  finishedAt: 't1',
};
const STATUS_STOPPED = {
  state: 'stopped',
  log: LOG_1,
  error: 'остановлено пользователем',
  startedAt: 't0',
  finishedAt: 't1',
};
// Авто-завершение по стагнации: статус возвращает note (LST-8).
const STAGNATION_NOTE = 'Стагнация: последние итерации не улучшали результат — прогон завершён автоматически';
const STATUS_STOPPED_NOTED = {
  ...STATUS_STOPPED,
  note: STAGNATION_NOTE,
};

const MODEL_SELECT = (page: import('@playwright/test').Page) => page.getByRole('combobox', { name: ru.llm.modelLabel });
const PROMPT_AREA = (page: import('@playwright/test').Page) => page.getByRole('textbox', { name: ru.llm.promptLabel });
const START_BTN = (page: import('@playwright/test').Page) => page.getByRole('button', { name: /Запустить LLM-прогон/ });
const STOP_BTN = (page: import('@playwright/test').Page) => page.getByRole('button', { name: /Стоп/ });

test.describe('LLM-генерация (docs-llm/06 §2)', () => {
  test('запуск: тело запроса с лимитами, лог обновляется опросом, кандидаты + «рекомендовано» + ссылки Viewer3D', async ({ page }) => {
    const cap = await mockProject(page, 'demo', FILES, {
      llm: { providers: PROVIDERS, status: [STATUS_RUNNING_1, STATUS_RUNNING_2, STATUS_DONE] },
    });
    await page.goto('/');
    await selectProject(page, 'demo');

    // Модели подтянулись: defaultModel выбран; группировка по провайдерам (optgroup).
    const model = MODEL_SELECT(page);
    await expect(model).toBeEnabled({ timeout: 10_000 });
    await expect(model).toHaveValue('eac-mac-ai/qwen.gguf');
    await expect(model.locator('option[value="eac-home-ai/home.gguf"]')).toHaveText('home.gguf (домашняя)');

    // Заполняем форму: запрос + оба лимита (totalTimeoutSec в UI больше нет, LST-8).
    await PROMPT_AREA(page).fill('сделай коридор поменьше');
    await page.getByRole('textbox', { name: ru.llm.limitIterations }).fill('7');
    await page.getByRole('textbox', { name: ru.llm.limitTimeBudget }).fill('3.5');

    // До запуска «Стоп» недоступен.
    await expect(STOP_BTN(page)).toBeDisabled();
    await START_BTN(page).click();

    // Тело POST llm-generate: prompt/modelId/limits (числами) — БЕЗ totalTimeoutSec (LST-8).
    await expect.poll(() => cap.llmGenerateBodies.length, { timeout: 10_000 }).toBe(1);
    expect(cap.llmGenerateBodies[0]).toEqual({
      prompt: 'сделай коридор поменьше',
      modelId: 'eac-mac-ai/qwen.gguf',
      limits: { maxIterations: 7, timeBudgetPerRun: 3.5 },
    });
    expect('totalTimeoutSec' in (cap.llmGenerateBodies[0] as { totalTimeoutSec?: unknown })).toBe(false);
    expect(
      'totalTimeoutSec' in ((cap.llmGenerateBodies[0] as { limits?: Record<string, unknown> }).limits ?? {}),
    ).toBe(false);

    // Во время прогона: строка состояния, «Стоп» активен, «Запустить» заблокирована.
    await expect(page.getByText(ru.llm.stateRunning)).toBeVisible({ timeout: 10_000 });
    await expect(STOP_BTN(page)).toBeEnabled();
    await expect(START_BTN(page)).toBeDisabled();

    // Лог шагов обновляется опросом (~1.5 c): появляется второй шаг.
    await expect(page.getByText('2. read_result — отчёт: feasible, отклонения в норме (ок)')).toBeVisible({ timeout: 15_000 });

    // LST-8: строки лога — блоки с вертикальным отступом; контейнер — max-height + overflow-y.
    const logBox = page.locator('.llm-log');
    await expect(logBox).toBeVisible();
    const boxCss = await logBox.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { maxHeight: cs.maxHeight, overflowY: cs.overflowY };
    });
    expect(boxCss).toEqual({ maxHeight: '300px', overflowY: 'auto' });
    const lineCss = await page
      .locator('.llm-log-line')
      .first()
      .evaluate((el) => getComputedStyle(el).marginBottom);
    expect(lineCss).toBe('8px');

    // Done: кандидаты с комментариями, «рекомендовано» у recommended, ссылки Viewer3D.
    await expect(page.getByText(ru.llm.stateDone)).toBeVisible({ timeout: 15_000 });
    // exact: имя файла дублируется в строке лога (pre), кандидат — отдельный <code>.
    await expect(page.getByText('result-llm-a.txt', { exact: true })).toBeVisible();
    await expect(page.getByText('лучшая раскладка: комнаты ближе к целям')).toBeVisible();
    await expect(page.getByText(/★.*рекомендовано/)).toBeVisible();

    const links = page.getByRole('link', { name: ru.llm.openViewer3d });
    await expect(links.first()).toHaveAttribute('href', '/viewer3d?project=demo&result=result-llm-a.txt');
    const hrefs = (await links.count()) >= 2 ? await links.nth(1).getAttribute('href') : null;
    expect(hrefs).toBe('/viewer3d?project=demo&result=result-llm-b.txt');

    // Терминальное состояние: «Стоп» недоступен; «Запустить» снова активна (новый прогон).
    await expect(STOP_BTN(page)).toBeDisabled();
    await expect(START_BTN(page)).toBeEnabled();
  });

  test('пустые поля лимитов = дефолты сервера: ключ limits в тело НЕ передаётся', async ({ page }) => {
    const cap = await mockProject(page, 'demo', FILES, {
      llm: { providers: PROVIDERS, status: [STATUS_DONE] },
    });
    await page.goto('/');
    await selectProject(page, 'demo');

    // Плейсхолдеры-дефолты видны в полях.
    await expect(page.getByRole('textbox', { name: ru.llm.limitIterations })).toHaveAttribute(
      'placeholder',
      LIMIT_DEFAULT_ITER,
    );
    await PROMPT_AREA(page).fill('больше свободной площади у входа');
    await START_BTN(page).click();

    await expect.poll(() => cap.llmGenerateBodies.length, { timeout: 10_000 }).toBe(1);
    expect(cap.llmGenerateBodies[0]).toEqual({
      prompt: 'больше свободной площади у входа',
      modelId: 'eac-mac-ai/qwen.gguf',
    });
    // Лимиты из плейсхолдеров в тело не попали.
    expect((cap.llmGenerateBodies[0] as { limits?: unknown }).limits).toBeUndefined();

    await expect(page.getByText(ru.llm.stateDone)).toBeVisible({ timeout: 15_000 });
  });

  test('«Стоп»: POST llm-stop, состояние stopped + error из ответа', async ({ page }) => {
    const cap = await mockProject(page, 'demo', FILES, {
      llm: {
        providers: PROVIDERS,
        // два тика running → после стопа stopped.
        status: (i) => (i < 2 ? STATUS_RUNNING_1 : STATUS_STOPPED),
      },
    });
    await page.goto('/');
    await selectProject(page, 'demo');

    await PROMPT_AREA(page).fill('попробуй другой seed');
    await START_BTN(page).click();
    await expect(page.getByText(ru.llm.stateRunning)).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByText('1. run_generation — result-llm-a.txt (exit 0) (ок)'),
    ).toBeVisible({ timeout: 15_000 });

    // Жмём «Стоп» во время прогона.
    await STOP_BTN(page).click();
    await expect.poll(() => cap.llmStops, { timeout: 10_000 }).toBe(1);

    // Терминальное состояние stopped + причина из error ответа.
    await expect(page.getByText(ru.llm.stateStopped)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('остановлено пользователем')).toBeVisible();
    await expect(STOP_BTN(page)).toBeDisabled();
  });

  test('configured=false: блок «LLM не настроен», элементы disabled; обычная генерация работает', async ({ page }) => {
    // llm-опции нет — mockProject отдаёт { configured: false, reason: 'мок' }.
    const cap = await mockProject(page, 'demo', FILES);
    await page.goto('/');
    await selectProject(page, 'demo');

    await expect(page.getByText(ru.llm.notConfigured)).toBeVisible({ timeout: 10_000 });
    await expect(START_BTN(page)).toBeDisabled();
    await expect(STOP_BTN(page)).toBeDisabled();
    await expect(PROMPT_AREA(page)).toBeDisabled();
    await expect(MODEL_SELECT(page)).toBeDisabled();

    // Остальной редактор работает: обычная генерация без LLM проходит как раньше.
    await generateBtn(page).click();
    await expect(page.getByText(`Размещение найдено: ${RESULT_FILE}`)).toBeVisible({ timeout: 10_000 });

    // При configured=false сессии LLM не запрашиваются (только providers-опрос).
    expect(cap.llmSessionsCalls).toBe(0);
  });

  test('409 LLM_SESSION_ACTIVE: «Уже идёт LLM-прогон» + наблюдение за активной сессией', async ({ page }) => {
    const active: MockLlmSessionSummary = {
      sessionId: '20260913-180000',
      status: 'running',
      modelId: 'eac-mac-ai/qwen.gguf',
      promptPreview: 'прогретая сессия',
      startedAt: 't0',
      finishedAt: null,
    };
    const cap = await mockProject(page, 'demo', FILES, {
      llm: {
        providers: PROVIDERS,
        // первая попытка старта — 409.
        generate: (i) =>
          i === 0
            ? { status: 409, body: { error: 'LLM_SESSION_ACTIVE', message: 'У проекта уже есть активная LLM-сессия' } }
            : { status: 202, body: { sessionId: '20260913-180001' } },
        // при загрузке активных сессий нет; после 409 — есть (панель переходит в наблюдение).
        sessions: (i) => (i === 0 ? [] : [active]),
        status: [STATUS_RUNNING_1, STATUS_RUNNING_2],
      },
    });
    await page.goto('/');
    await selectProject(page, 'demo');

    // На момент загрузки активной сессии нет — можно жать «Запустить».
    await PROMPT_AREA(page).fill('ещё один запрос');
    await START_BTN(page).click();

    // 409 → понятное сообщение (не сырой текст API), POST был ровно один.
    await expect(page.getByText(ru.llm.sessionActive)).toBeVisible({ timeout: 10_000 });
    expect(cap.llmGenerateBodies).toHaveLength(1);

    // Панель перешла в наблюдение за активной сессией: лог её шагов виден.
    await expect(page.getByText('1. run_generation — result-llm-a.txt (exit 0) (ок)')).toBeVisible({ timeout: 15_000 });
    await expect(STOP_BTN(page)).toBeEnabled();
  });

  test('история: последние сессии; при загрузке без активной раскрывается последняя (журнал: лог + кандидаты)', async ({ page }) => {
    const lastId = '20260913-175900';
    const summary: MockLlmSessionSummary = {
      sessionId: lastId,
      status: 'done',
      modelId: 'eac-mac-ai/qwen.gguf',
      promptPreview: 'предыдущий запрос',
      startedAt: '2026-09-13T17:59:00.000Z',
      finishedAt: '2026-09-13T18:01:00.000Z',
    };
    await mockProject(page, 'demo', FILES, {
      llm: {
        providers: PROVIDERS,
        sessions: [summary],
        sessionDetails: {
          [lastId]: {
            prompt: 'предыдущий запрос',
            modelId: 'eac-mac-ai/qwen.gguf',
            // legacy-запись с totalTimeoutSec — в строке лимитов не отображается (LST-8).
            limits: { maxIterations: 5, timeBudgetPerRun: 2, totalTimeoutSec: 180 },
            iterations: LOG_2,
            candidates: [{ file: 'result-old.txt', comment: 'прошлый вариант' }],
            recommended: 'result-old.txt',
            status: 'done',
            startedAt: summary.startedAt,
            finishedAt: summary.finishedAt,
          },
        },
      },
    });
    await page.goto('/');
    await selectProject(page, 'demo');

    // Строка сессии: id · статус · модель.
    await expect(page.getByText(/20260913-175900.*завершена.*eac-mac-ai\/qwen\.gguf/)).toBeVisible({ timeout: 10_000 });

    // Последняя сессия раскрывается автоматически: лимиты (без legacy-totalTimeoutSec), лог, кандидаты.
    await expect(page.getByText('Лимиты: maxIterations=5 · timeBudgetPerRun=2')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('2. read_result — отчёт: feasible, отклонения в норме (ок)')).toBeVisible();
    await expect(page.getByText('result-old.txt', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('link', { name: ru.llm.openViewer3d }).first(),
    ).toHaveAttribute('href', '/viewer3d?project=demo&result=result-old.txt');
  });

  test('note из статуса (авто-завершение по стагнации) — заметный блок под логом (LST-8)', async ({ page }) => {
    const cap = await mockProject(page, 'demo', FILES, {
      llm: {
        providers: PROVIDERS,
        // два тика running → stopped с note.
        status: (i) => (i < 2 ? STATUS_RUNNING_1 : STATUS_STOPPED_NOTED),
      },
    });
    await page.goto('/');
    await selectProject(page, 'demo');

    await PROMPT_AREA(page).fill('разнеси рабочие места по углам');
    await START_BTN(page).click();
    await expect(page.getByText(ru.llm.stateStopped)).toBeVisible({ timeout: 15_000 });

    // note — самодостаточный текст в выделенном (accent-фон) блоке под логом.
    const noteEl = page.getByText(STAGNATION_NOTE, { exact: true });
    await expect(noteEl).toBeVisible({ timeout: 10_000 });
    const bg = await noteEl.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');

    // Сам статус-ответ с note был (мок вернёт его вторым тиком).
    expect(cap.llmGenerateBodies).toHaveLength(1);
  });

  test('длинный лог в журнале: контейнер ограничен по вертикали со своей прокруткой; note из журнала виден (LST-8)', async ({ page }) => {
    const lastId = '20260913-175500';
    // 40 шагов — контент заметно выше max-height контейнера (300 px).
    const longLog = Array.from({ length: 40 }, (_, i) => ({
      n: i + 1,
      action: 'run_generation',
      args: { seed: i },
      ok: true,
      summary: `итерация ${i + 1}: result-llm-${String.fromCharCode(97 + (i % 26))}.txt (exit 0)`,
    }));
    await mockProject(page, 'demo', FILES, {
      llm: {
        providers: PROVIDERS,
        sessions: [
          {
            sessionId: lastId,
            status: 'stopped',
            modelId: 'eac-mac-ai/qwen.gguf',
            promptPreview: 'длинный прогон',
            startedAt: '2026-09-13T17:55:00.000Z',
            finishedAt: '2026-09-13T18:40:00.000Z',
          },
        ],
        sessionDetails: {
          [lastId]: {
            prompt: 'длинный прогон',
            modelId: 'eac-mac-ai/qwen.gguf',
            limits: {},
            iterations: longLog,
            status: 'stopped',
            note: STAGNATION_NOTE,
            startedAt: '2026-09-13T17:55:00.000Z',
            finishedAt: '2026-09-13T18:40:00.000Z',
          },
        },
      },
    });
    await page.goto('/');
    await selectProject(page, 'demo');

    // Последняя сессия раскрывается автоматически — 40 блоков-строк.
    const lines = page.locator('.llm-log-line');
    await expect(lines.first()).toBeVisible({ timeout: 10_000 });
    await expect.poll(() => lines.count(), { timeout: 5_000 }).toBe(40);

    // Контейнер: max-height 300 + своя прокрутка; видимая высота < высоты контента.
    const box = page.locator('.llm-log');
    const dims = await box.evaluate((el) => ({
      maxHeight: getComputedStyle(el).maxHeight,
      overflowY: getComputedStyle(el).overflowY,
      visibleH: el.clientHeight,
      contentH: el.scrollHeight,
    }));
    expect(dims.maxHeight).toBe('300px');
    expect(dims.overflowY).toBe('auto');
    expect(dims.contentH).toBeGreaterThan(40 * 15); // 40 строк × ~15 px — контента больше, чем видно
    const bb = await box.boundingBox();
    expect(bb !== null && bb.height <= 300 + 2).toBe(true);
    expect(dims.visibleH).toBeLessThan(dims.contentH);

    // note из журнала (авто-завершение по стагнации) виден под логом.
    await expect(page.getByText(STAGNATION_NOTE, { exact: true })).toBeVisible();
  });
});

// Значение плейсхолдера maxIterations (5 / 2.0 — docs-llm/05 §2; totalTimeoutSec убран, LST-8).
const LIMIT_DEFAULT_ITER = '5';
