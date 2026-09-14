// Чистые помощники «LLM-генерация» (src/lib/llm.ts): формат лог-строк, ссылки Viewer3D,
// разбор полей лимитов, конвертация статус/журнал → единый LlmOutcome.
import { describe, expect, it } from 'vitest';
import { formatLlmLimits, formatLlmLogLine, outcomeFromRecord, outcomeFromStatus, parseLlmLimits, viewer3dHref } from '../../src/lib/llm';
import type { LlmJournalRecord, LlmStatusView } from '../../src/lib/api';

const T = { ok: 'ок', failed: 'ошибка', noAction: 'неверный ответ протокола' };

describe('formatLlmLogLine (06 §2.2 «N. action — summary (ok/ошибка)»)', () => {
  it('успешный шаг', () => {
    expect(
      formatLlmLogLine({ n: 1, action: 'run_generation', ok: true, summary: 'result-a.txt (exit 0)' }, T),
    ).toBe('1. run_generation — result-a.txt (exit 0) (ок)');
  });

  it('неудачный шаг', () => {
    expect(
      formatLlmLogLine({ n: 3, action: 'correct_result', ok: false, summary: 'validate: V-MASK-DIM' }, T),
    ).toBe('3. correct_result — validate: V-MASK-DIM (ошибка)');
  });

  it('action = null — неверный ответ протокола', () => {
    expect(formatLlmLogLine({ n: 2, action: null, ok: false, summary: 'ответ не JSON' }, T)).toBe(
      '2. неверный ответ протокола — ответ не JSON (ошибка)',
    );
  });
});

describe('viewer3dHref (формат существующей генерации: /viewer3d?project=&result=)', () => {
  it('простые значения', () => {
    expect(viewer3dHref('demo', 'result-1.txt')).toBe('/viewer3d?project=demo&result=result-1.txt');
  });

  it('экранирование slug и имени файла', () => {
    expect(viewer3dHref('my proj/2', 'a b.txt')).toBe('/viewer3d?project=my%20proj%2F2&result=a%20b.txt');
  });
});

describe('parseLlmLimits (пустое поле = дефолт сервера — не передаётся)', () => {
  it('все поля пустые → limits {}, ошибки нет', () => {
    const r = parseLlmLimits({ maxIterations: '', timeBudgetPerRun: '  ' });
    expect(r).toEqual({ limits: {}, error: null });
  });

  it('валидные значения — числа (строка "2.0" → 2)', () => {
    const r = parseLlmLimits({ maxIterations: '7', timeBudgetPerRun: '2.5' });
    expect(r).toEqual({ limits: { maxIterations: 7, timeBudgetPerRun: 2.5 }, error: null });
  });

  it('частично пустые — в limits только заданные', () => {
    const r = parseLlmLimits({ maxIterations: '10', timeBudgetPerRun: '' });
    expect(r).toEqual({ limits: { maxIterations: 10 }, error: null });
  });

  it('legacy-поле totalTimeoutSec игнорируется (сервер не принимает, LST-8)', () => {
    const r = parseLlmLimits({ maxIterations: '7', timeBudgetPerRun: '2.5', totalTimeoutSec: '180' } as Parameters<typeof parseLlmLimits>[0]);
    expect(r).toEqual({ limits: { maxIterations: 7, timeBudgetPerRun: 2.5 }, error: null });
    expect('totalTimeoutSec' in r.limits).toBe(false);
  });

  it('maxIterations: не целое → ошибка', () => {
    expect(parseLlmLimits({ maxIterations: '2.5', timeBudgetPerRun: '' }).error).toBe('maxIterations');
  });

  it('maxIterations: > 50 (защита от «500») → ошибка', () => {
    expect(parseLlmLimits({ maxIterations: '500', timeBudgetPerRun: '' }).error).toBe('maxIterations');
    expect(parseLlmLimits({ maxIterations: '51', timeBudgetPerRun: '' }).error).toBe('maxIterations');
  });

  it('maxIterations: 0 и отрицательные → ошибка; 1 и 50 — ок', () => {
    expect(parseLlmLimits({ maxIterations: '0', timeBudgetPerRun: '' }).error).toBe('maxIterations');
    expect(parseLlmLimits({ maxIterations: '-3', timeBudgetPerRun: '' }).error).toBe('maxIterations');
    expect(parseLlmLimits({ maxIterations: '1', timeBudgetPerRun: '' }).error).toBeNull();
    expect(parseLlmLimits({ maxIterations: '50', timeBudgetPerRun: '' }).error).toBeNull();
  });

  it('maxIterations: нечисловое → ошибка', () => {
    expect(parseLlmLimits({ maxIterations: 'abc', timeBudgetPerRun: '' }).error).toBe('maxIterations');
  });

  it('timeBudgetPerRun: ≤ 0 и нечисловые → ошибка; дробные > 0 — ок', () => {
    expect(parseLlmLimits({ maxIterations: '', timeBudgetPerRun: '0' }).error).toBe('timeBudgetPerRun');
    expect(parseLlmLimits({ maxIterations: '', timeBudgetPerRun: '-1' }).error).toBe('timeBudgetPerRun');
    expect(parseLlmLimits({ maxIterations: '', timeBudgetPerRun: 'x' }).error).toBe('timeBudgetPerRun');
    const r = parseLlmLimits({ maxIterations: '', timeBudgetPerRun: '0.5' });
    expect(r).toEqual({ limits: { timeBudgetPerRun: 0.5 }, error: null });
  });
});

describe('outcomeFromStatus / outcomeFromRecord (единый итог для live-лога и истории)', () => {
  const baseStatus: Omit<LlmStatusView, 'state'> = {
    log: [{ n: 1, action: 'finish', ok: true, summary: 'готово' }],
    error: null,
    startedAt: 't0',
    finishedAt: null,
  };

  it('running — без кандидатов/рекомендации', () => {
    const o = outcomeFromStatus({ ...baseStatus, state: 'running' });
    expect(o).toEqual({
      state: 'running',
      log: baseStatus.log,
      candidates: null,
      recommended: null,
      error: null,
      note: null,
    });
  });

  it('note из статуса (авто-завершение по стагнации) → outcome.note; пустая строка → null', () => {
    const o = outcomeFromStatus({ ...baseStatus, state: 'stopped', note: 'Стагнация: авто-завершение' });
    expect(o.note).toBe('Стагнация: авто-завершение');
    expect(outcomeFromStatus({ ...baseStatus, state: 'stopped', note: '' }).note).toBeNull();
  });

  it('done — кандидаты и рекомендация; пустые массивы/отсутствие → [] / null', () => {
    expect(
      outcomeFromStatus({ ...baseStatus, state: 'done', candidates: [{ file: 'a', comment: 'c' }], recommended: 'a' }),
    ).toMatchObject({ state: 'done', candidates: [{ file: 'a', comment: 'c' }], recommended: 'a' });
    const noCand = outcomeFromStatus({ ...baseStatus, state: 'done' });
    expect(noCand.candidates).toEqual([]);
    expect(noCand.recommended).toBeNull();
  });

  it('stopped/error — кандидаты не показываются, error из ответа', () => {
    const o = outcomeFromStatus({ ...baseStatus, state: 'stopped', error: 'остановлено пользователем' });
    expect(o.candidates).toBeNull();
    expect(o.error).toBe('остановлено пользователем');
  });

  it('журнал (05 §5) → тот же итог; iterations проходят как лог', () => {
    const record: LlmJournalRecord = {
      prompt: 'p',
      modelId: 'p/m',
      limits: {},
      iterations: [{ n: 1, action: 'run_generation', args: {}, ok: true, summary: 's' }],
      candidates: [{ file: 'a.txt', comment: 'c' }],
      recommended: 'a.txt',
      status: 'done',
      startedAt: 't0',
      finishedAt: 't1',
    };
    expect(outcomeFromRecord(record)).toEqual({
      state: 'done',
      log: record.iterations,
      candidates: [{ file: 'a.txt', comment: 'c' }],
      recommended: 'a.txt',
      error: null,
      note: null,
    });
  });

  it('note из журнала сессии → outcome.note', () => {
    const rec: LlmJournalRecord = {
      prompt: 'p',
      modelId: 'p/m',
      limits: {},
      iterations: [],
      status: 'stopped',
      startedAt: 't0',
      finishedAt: 't1',
      note: 'Стагнация: последние итерации не улучшали результат — авто-завершение',
    };
    expect(outcomeFromRecord(rec).note).toBe('Стагнация: последние итерации не улучшали результат — авто-завершение');
  });

  it('журнал stopped без error → error: null', () => {
    const rec: LlmJournalRecord = {
      prompt: 'p',
      modelId: 'p/m',
      limits: {},
      iterations: [],
      status: 'stopped',
      startedAt: 't0',
      finishedAt: 't1',
    };
    expect(outcomeFromRecord(rec).error).toBeNull();
  });
});

describe('formatLlmLimits (строка лимитов журнала; totalTimeoutSec не выводится, LST-8)', () => {
  it('все заданные', () => {
    expect(formatLlmLimits({ maxIterations: 5, timeBudgetPerRun: 2 }, { defaultMark: 'дефолт' })).toBe(
      'maxIterations=5 · timeBudgetPerRun=2',
    );
  });

  it('незаданные — пометка из i18n', () => {
    expect(formatLlmLimits({}, { defaultMark: 'дефолт' })).toBe('maxIterations=дефолт · timeBudgetPerRun=дефолт');
  });

  it('legacy-запись журнала с totalTimeoutSec — поле не отображается', () => {
    expect(
      formatLlmLimits({ maxIterations: 5, timeBudgetPerRun: 2, totalTimeoutSec: 180 } as { maxIterations?: number; timeBudgetPerRun?: number; totalTimeoutSec?: number }, { defaultMark: 'дефолт' }),
    ).toBe('maxIterations=5 · timeBudgetPerRun=2');
  });
});
