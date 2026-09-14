// Чистые помощники панели «LLM-генерация» (docs-llm/06 §2): форматирование лог-строк,
// ссылки Viewer3D, разбор текстовых полей лимитов. Без React и fetch — unit-тестируемо.
import type { LlmJournalRecord, LlmLimits, LlmLogEntry, LlmStatusView } from './api';

/** Единое представление «итог/текущее состояние» для live-опроса и журнала истории.
 * `raw` у шага есть только в полном журнале (llm-sessions/<id>); live-опрос его не даёт. */
export interface LlmOutcome {
  state: 'running' | 'done' | 'stopped' | 'error';
  log: Array<LlmLogEntry & { raw?: string }>;
  /** null — кандидатов ещё нет (не done). */
  candidates: { file: string; comment: string }[] | null;
  recommended: string | null;
  error: string | null;
  /** Пояснение при авто-завершении по стагнации (LST-8); null — нет. */
  note: string | null;
}

/** Live-вид статуса → итог (кандидаты/рекомендация — только при done, 06 §1.3). */
export function outcomeFromStatus(v: LlmStatusView): LlmOutcome {
  return {
    state: v.state,
    log: v.log,
    candidates: v.state === 'done' ? v.candidates ?? [] : null,
    recommended: v.state === 'done' ? (v.recommended ?? null) : null,
    error: v.error ?? null,
    note: typeof v.note === 'string' && v.note.length > 0 ? v.note : null,
  };
}

/** Полный журнал сессии (05 §5) → тот же итог. */
export function outcomeFromRecord(r: LlmJournalRecord): LlmOutcome {
  return {
    state: r.status,
    log: r.iterations,
    candidates: r.status === 'done' ? (r.candidates ?? []) : null,
    recommended: r.status === 'done' ? (r.recommended ?? null) : null,
    error: typeof r.error === 'string' ? r.error : null,
    note: typeof r.note === 'string' && r.note.length > 0 ? r.note : null,
  };
}

/** Текстовые фрагменты строки лога (из i18n ru.llm). */
export interface LlmLogTexts {
  ok: string; // «ок»
  failed: string; // «ошибка»
  noAction: string; // действие не распознано (action = null)
}

/** Строка шага лога: «N. action — summary (ок|ошибка)» (06 §2.2).
 * `action === null` — неверный ответ протокола, подставляется noAction. */
export function formatLlmLogLine(entry: LlmLogEntry, t: LlmLogTexts): string {
  const action = entry.action ?? t.noAction;
  const verdict = entry.ok ? t.ok : t.failed;
  return `${entry.n}. ${action} — ${entry.summary} (${verdict})`;
}

/** Ссылка «Открыть в Viewer3D» — тот же формат, что у существующей генерации (04 §1.6). */
export function viewer3dHref(slug: string, file: string): string {
  return `/viewer3d?project=${encodeURIComponent(slug)}&result=${encodeURIComponent(file)}`;
}

/** Текстовые поля полей лимитов UI; пустое поле = не передаётся (дефолт сервера).
 * `totalTimeoutSec` больше нет в UI — сервер игнорирует поле (LST-8). */
export interface LlmLimitInputs {
  maxIterations: string;
  timeBudgetPerRun: string;
}

export type LlmLimitFieldError = 'maxIterations' | 'timeBudgetPerRun' | null;

/** Разбор полей лимитов: пустые поля пропускаются (в тело `limits` не попадают).
 * Валидация — как на сервере (05 §2): maxIterations — целое 1..50, остальные — число > 0.
 * Legacy-поле `totalTimeoutSec` во входных данных игнорируется (LST-8). */
/** Строка лимитов журнала («maxIterations=5 · timeBudgetPerRun=2»);
 * незаданные значения помечаются `t.defaultMark` (из i18n).
 * Legacy-поле totalTimeoutSec в старых записях журнала не отображается (LST-8). */
export function formatLlmLimits(limits: LlmLimits, t: { defaultMark: string }): string {
  return [
    `maxIterations=${limits.maxIterations ?? t.defaultMark}`,
    `timeBudgetPerRun=${limits.timeBudgetPerRun ?? t.defaultMark}`,
  ].join(' · ');
}

export function parseLlmLimits(
  inputs: LlmLimitInputs,
): { limits: LlmLimits; error: LlmLimitFieldError } {
  const limits: LlmLimits = {};

  const it = inputs.maxIterations.trim();
  if (it !== '') {
    const n = Number(it);
    if (!Number.isInteger(n) || n < 1 || n > 50) return { limits, error: 'maxIterations' };
    limits.maxIterations = n;
  }
  {
    const t = inputs.timeBudgetPerRun.trim();
    if (t !== '') {
      const n = Number(t);
      if (!Number.isFinite(n) || n <= 0) return { limits, error: 'timeBudgetPerRun' };
      limits.timeBudgetPerRun = n;
    }
  }
  return { limits, error: null };
}
