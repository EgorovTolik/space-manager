// ST-2: raw-ответы LLM в журнале сессии (LlmPanel, секция «LLM-сессии»).
// Каждый шаг журнала с полем `raw` получает раскрывающийся блок «сырой ответ»
// (details/summary, monospace pre-wrap); шагов без raw блока нет.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { mockProject, selectProject } from './helpers';
import { EXAMPLES, SPEC_10X10_MASKED } from './fixtures';
import { ru } from '../../src/i18n/ru';

const FILES = {
  'spec.yaml': SPEC_10X10_MASKED,
  'blocked.txt': readFileSync(EXAMPLES.blockedBasic, 'utf8'),
};

const PROVIDERS = {
  configured: true,
  defaultModel: 'p/m',
  providers: [{ id: 'p', models: [{ id: 'm', label: null }] }],
};

// Дословный ответ модели (в реале усечён до 8000 символов с суффиксом «…(N символов)»).
const RAW_TEXT = [
  '{',
  '  "action": "run_generation",',
  '  "args": { "seed": 7 },',
  '  "comment": "уменьшил долю коридора до 6%"',
  '}',
  '',
  '// …(4321 символов)',
].join('\n');

const SESSION_ID = '20260914-100000';
const JOURNAL = {
  prompt: 'сделай коридор поуже',
  modelId: 'p/m',
  limits: {},
  iterations: [
    // шаг С raw → раскрывающийся блок обязателен;
    { n: 1, action: 'run_generation', args: { seed: 7 }, ok: true, summary: 'result-llm-a.txt (exit 0)', raw: RAW_TEXT },
    // шаг БЕЗ raw → блока нет;
    { n: 2, action: 'finish', args: {}, ok: true, summary: 'кандидаты выбраны' },
  ],
  candidates: [{ file: 'result-llm-a.txt', comment: 'лучший вариант' }],
  recommended: 'result-llm-a.txt',
  status: 'done',
  startedAt: '2026-09-14T10:00:00.000Z',
  finishedAt: '2026-09-14T10:02:00.000Z',
};

test('журнал сессии: шаг с raw → раскрывающийся блок «сырой ответ», без raw — блока нет', async ({ page }) => {
  await mockProject(page, 'demo', FILES, {
    llm: {
      providers: PROVIDERS,
      sessions: [
        {
          sessionId: SESSION_ID,
          status: 'done',
          modelId: 'p/m',
          promptPreview: 'сделай коридор поуже',
          startedAt: JOURNAL.startedAt,
          finishedAt: JOURNAL.finishedAt,
        },
      ],
      sessionDetails: { [SESSION_ID]: JOURNAL },
    },
  });
  await page.goto('/');
  await selectProject(page, 'demo');

  // Последняя сессия раскрывается автоматически (журнал загружен).
  await expect(page.getByText('1. run_generation — result-llm-a.txt (exit 0) (ок)')).toBeVisible({ timeout: 10_000 });

  // Блок «сырой ответ» есть, закрыт по умолчанию; .llm-raw (текст) ещё не в DOM.
  const summary = page.locator('summary', { hasText: ru.llm.rawAnswer });
  await expect(summary).toHaveCount(1); // ровно у одного шага (второй без raw)
  await expect(page.locator('.llm-raw')).not.toBeVisible(); // закрытый <details> не рендерится

  // Раскрыть → monospace pre-wrap с дословным текстом.
  await summary.click();
  const pre = page.locator('.llm-raw');
  await expect(pre).toBeVisible();
  await expect(pre).toHaveText(RAW_TEXT);
  const css = await pre.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { whiteSpace: cs.whiteSpace, fontFamily: cs.fontFamily };
  });
  expect(css.whiteSpace).toBe('pre-wrap');
  expect(css.fontFamily.toLowerCase()).toContain('mono');
});
