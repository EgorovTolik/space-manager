// Агентный цикл LLM-прогона (ТЗ docs-llm/05 §1–§4): система+история сообщений,
// шаги «LLM → {action,args} → выполнение → результат в историю», лимиты,
// состояния running → done | stopped | error, журнал на каждом шаге.
import fsp from 'node:fs/promises';
import path from 'node:path';

import type { LlmProvider } from './config.js';
import { chatCompletion, type ChatMessage, type ChatOptions } from './client.js';
import { FOLLOWUP_MESSAGE, MAX_PROTOCOL_RETRIES, parseActionMessage, ProtocolError } from './protocol.js';
import { buildSystemPrompt, maskPaths } from './session.js';
import {
  buildActionEnv,
  correctResult,
  finish,
  readResult,
  runGeneration,
  SessionFatalError,
  type ActionEnv,
  type LlmLimits,
} from './actions.js';
import {
  nextSessionId,
  readJournalRecord,
  writeJournalRecord,
  type LlmJournalRecord,
  type LlmSessionStatus,
} from './journal.js';
import type { Clock } from '../workspace.js';

// ---------------------------------------------------------------------------
// Контроллер остановки: флаг + SIGKILL child-процесса текущего запуска (05 §4)
// ---------------------------------------------------------------------------

export interface LlmSessionController {
  /** true после «Стопа» от пользователя. */
  isStopped: () => boolean;
  /** Поставить флаг и остановить (SIGKILL) текущий child-процесс солвера/валидатора. */
  stop: () => void;
}

export function createLlmSessionController(): LlmSessionController & { abort: AbortSignal } {
  const controller = new AbortController();
  return {
    isStopped: () => controller.signal.aborted,
    stop: () => {
      if (!controller.signal.aborted) controller.abort();
    },
    abort: controller.signal,
  };
}

// ---------------------------------------------------------------------------
// Запуск сессии
// ---------------------------------------------------------------------------

export interface RunLlmSessionOptions {
  projectDir: string;
  /** id = имя журнала (YYYYMMDD-HHMMSS); null — создать новый. */
  sessionId?: string;
  /**
   * Живая запись журнала, созданная API-слоем (одна на сессию): бегущее
   * состояние видят и llm-status (через ту же ссылку), и записи в файл.
   */
  initialRecord?: LlmJournalRecord;
  prompt: string;
  modelId: string;
  provider: LlmProvider;
  limits: LlmLimits;
  pythonBin: string;
  now: Clock;
  /** Таймаут child-процесса валидатора, мс (дефолт — таймаут генерации). */
  validateTimeoutMs?: number;
  /** Стеновое «сейчас» для totalTimeoutSec (DI для тестов). */
  dateNow?: () => number;
  /** Вызов LLM (DI для тестов; дефолт — chatCompletion из client.ts). */
  chatFn?: (opts: ChatOptions) => Promise<string>;
  controller?: LlmSessionController & { abort: AbortSignal };
}

export interface RunLlmSessionOutcome {
  sessionId: string;
  status: LlmSessionStatus;
  error?: string;
}

const DEFAULT_VALIDATE_TIMEOUT_MS = 60_000;

/**
 * Полный прогон LLM-сессии. Журнал создаётся на старте (status: running),
 * обновляется после каждого шага и в терминальном состоянии. Все сбои цикла
 * фиксируются в журнале — функция НЕ бросает исключений наружу.
 */
export async function runLlmSession(opts: RunLlmSessionOptions): Promise<RunLlmSessionOutcome> {
  const dateNow = opts.dateNow ?? Date.now;
  const chatFn = opts.chatFn ?? chatCompletion;
  const controller = opts.controller ?? createLlmSessionController();
  const validateTimeoutMs = opts.validateTimeoutMs ?? DEFAULT_VALIDATE_TIMEOUT_MS;

  const sessionId = opts.sessionId ?? (await nextSessionId(opts.projectDir, opts.now));
  const record: LlmJournalRecord =
    opts.initialRecord ?? {
      prompt: opts.prompt,
      modelId: opts.modelId,
      limits: { ...opts.limits },
      iterations: [],
      status: 'running',
      startedAt: opts.now().toISOString(),
      finishedAt: null,
    };

  const persist = async (): Promise<void> => {
    await writeJournalRecord(opts.projectDir, sessionId, record).catch(() => undefined);
  };
  if (opts.initialRecord === undefined) {
    // API-слой не создал стартовый журнал — создаём его здесь.
    await fsp.mkdir(path.join(opts.projectDir, 'llm-sessions'), { recursive: true }).catch(() => undefined);
    await persist();
  }

  const finishStatus = async (status: LlmSessionStatus, error?: string): Promise<RunLlmSessionOutcome> => {
    record.status = status;
    record.finishedAt = opts.now().toISOString();
    if (error !== undefined) record.error = error;
    await persist();
    return { sessionId, status, ...(error !== undefined ? { error } : {}) };
  };

  try {
    // --- Входные данные сессии: спека + маски ---------------------------------
    let specText: string;
    try {
      specText = await fsp.readFile(path.join(opts.projectDir, 'spec.yaml'), 'utf8');
    } catch (err) {
      return finishStatus('error', `не удалось прочитать spec.yaml проекта: ${(err as Error).message}`);
    }
    let env: ActionEnv;
    try {
      const parsed = await buildActionEnv(opts.projectDir, specText);
      env = {
        projectDir: opts.projectDir,
        pythonBin: opts.pythonBin,
        now: opts.now,
        specText,
        limits: opts.limits,
        validateTimeoutMs,
        signal: controller.abort,
        isStopped: controller.isStopped,
        ...parsed,
      };
    } catch (err) {
      if (err instanceof SessionFatalError) return finishStatus('error', err.message);
      throw err;
    }

    // Текст масок для системного промпта (05 §3.3).
    const { blockedPath, presetPath } = maskPaths(opts.projectDir, env.spec);
    let blockedText: string | null = null;
    if (blockedPath !== null) {
      try {
        blockedText = await fsp.readFile(blockedPath, 'utf8');
      } catch {
        return finishStatus('error', `маска блокировок «${env.spec.blockedFile}» не читается`);
      }
    }
    let presetText: string | null = null;
    if (presetPath !== null) {
      try {
        presetText = await fsp.readFile(presetPath, 'utf8');
      } catch {
        return finishStatus('error', `маска пресетов «${env.spec.presetFile}» не читается`);
      }
    }

    const systemPrompt = buildSystemPrompt({
      spec: env.spec,
      specText,
      blockedText,
      presetText,
      userPrompt: opts.prompt,
    });

    // --- Цикл ------------------------------------------------------------------
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: opts.prompt },
    ];
    const deadline = dateNow() + opts.limits.totalTimeoutSec * 1000;
    let actionCount = 0; // run_generation + correct_result (05 §2)
    let protocolErrorsInRow = 0;
    let limitRejectionSent = false;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      // Стоп проверяется между шагами (05 §4 п.а).
      if (controller.isStopped()) {
        return finishStatus('stopped', 'остановлено пользователем');
      }
      if (dateNow() > deadline) {
        return finishStatus('stopped', 'превышен общий лимит времени');
      }

      let raw: string;
      try {
        raw = await chatFn({ url: opts.provider.url, apiKey: opts.provider.apiKey, model: opts.modelId, messages });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return finishStatus('error', `LLM-провайдер недоступен: ${message}`);
      }

      // Повторная проверка после ответа LLM: долгий вызов мог пересечь стоп/дедлайн.
      if (controller.isStopped() || dateNow() > deadline) {
        return finishStatus(
          'stopped',
          controller.isStopped() ? 'остановлено пользователем' : 'превышен общий лимит времени',
        );
      }

      const stepN = record.iterations.length + 1;
      let parsed: ReturnType<typeof parseActionMessage>;
      try {
        parsed = parseActionMessage(raw);
      } catch (err) {
        if (!(err instanceof ProtocolError)) throw err;
        protocolErrorsInRow++;
        // Третий неверный ответ подряд — состояние error (03 §2.3).
        if (protocolErrorsInRow > MAX_PROTOCOL_RETRIES) {
          return finishStatus('error', `ошибка протокола: ${MAX_PROTOCOL_RETRIES + 1} неверных ответа LLM подряд`);
        }
        record.iterations.push({
          n: stepN,
          action: null,
          args: {},
          ok: false,
          summary: `ошибка протокола: ${err.message}`,
        });
        await persist();
        messages.push({ role: 'assistant', content: raw }, { role: 'user', content: FOLLOWUP_MESSAGE });
        continue;
      }
      protocolErrorsInRow = 0;

      const { action, args } = parsed;
      const thought = parsed.thought;
      const thoughtPrefix = typeof thought === 'string' && thought.trim() !== '' ? `thought: ${thought.trim()}; ` : '';

      // Лимит maxIterations (05 §2): счётчик двигают только run_generation/correct_result,
      // но после исчерпания любое действие, кроме finish, отвергается; второй отказ → stopped.
      if (action !== 'finish' && actionCount >= opts.limits.maxIterations) {
        if (limitRejectionSent) {
          return finishStatus('stopped', `лимит шагов исчерпан (${opts.limits.maxIterations}) без finish`);
        }
        limitRejectionSent = true;
        const message = `Лимит шагов исчерпан (${opts.limits.maxIterations}). Вызови finish с лучшими кандидатами.`;
        record.iterations.push({ n: stepN, action, args, ok: false, summary: `${thoughtPrefix}${message}` });
        await persist();
        messages.push({ role: 'assistant', content: raw }, { role: 'user', content: message });
        continue;
      }

      let result: Awaited<ReturnType<typeof runGeneration>>;
      try {
        switch (action) {
          case 'run_generation':
            actionCount++;
            result = await runGeneration(env, args);
            break;
          case 'read_result':
            result = await readResult(env, args);
            break;
          case 'correct_result':
            actionCount++;
            result = await correctResult(env, args);
            break;
          case 'finish':
            result = await finish(env, args);
            break;
        }
      } catch (err) {
        if (err instanceof SessionFatalError) return finishStatus('error', err.message);
        throw err;
      }

      // Стоп проверяется после каждого запуска солвера/валидатора (05 §4 п.б).
      if (controller.isStopped()) {
        record.iterations.push({ n: stepN, action, args, ok: result.ok, summary: `${thoughtPrefix}${result.summary}` });
        return finishStatus('stopped', 'остановлено пользователем');
      }

      record.iterations.push({
        n: stepN,
        action,
        args,
        ok: result.ok,
        summary: truncateSummary(`${thoughtPrefix}${result.summary}`),
      });

      if (action === 'finish' && result.ok && result.done !== undefined) {
        record.candidates = result.done.candidates;
        if (result.done.recommended !== undefined) record.recommended = result.done.recommended;
        await persist();
        return finishStatus('done');
      }

      await persist();
      messages.push({ role: 'assistant', content: raw }, { role: 'user', content: result.text });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return finishStatus('error', `непредвиденный сбой цикла: ${message}`);
  }
}

function truncateSummary(text: string): string {
  return text.length > 500 ? `${text.slice(0, 497)}…` : text;
}

/** Статус сессии из живого состояния или журнала (06 §1.3). */
export interface LlmStatusView {
  state: LlmSessionStatus;
  log: Array<{ n: number; action: string | null; ok: boolean; summary: string }>;
  candidates?: Array<{ file: string; comment: string }>;
  recommended?: string;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export function statusViewFromRecord(record: LlmJournalRecord): LlmStatusView {
  const view: LlmStatusView = {
    state: record.status,
    log: record.iterations.map((it) => ({ n: it.n, action: it.action, ok: it.ok, summary: it.summary })),
    error: typeof record.error === 'string' ? record.error : null,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
  };
  if (record.status === 'done') {
    view.candidates = record.candidates ?? [];
    if (record.recommended !== undefined) view.recommended = record.recommended;
  }
  return view;
}

export { readJournalRecord };
