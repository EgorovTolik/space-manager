// OpenAI-совместимый вызов LLM: POST {url}/v1/chat/completions (ТЗ docs-llm/02 §6).
// Один запрос-ответ; выполнения действий здесь НЕТ (агентный цикл — LST-4).
// Прочие параметры запроса (temperature и т.п.) НЕ задаются — дефолты провайдера (02 §6).
import { LLM_CALL_TIMEOUT_MS } from './config.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type LlmClientErrorCode = 'LLM_NETWORK' | 'LLM_TIMEOUT' | 'LLM_HTTP' | 'LLM_BAD_RESPONSE';

/** Типизированная ошибка обращения к провайдеру (сеть / таймаут / HTTP / формат ответа). */
export class LlmClientError extends Error {
  readonly code: LlmClientErrorCode;
  /** HTTP-статус провайдера (только для code = 'LLM_HTTP'). */
  readonly status?: number;

  constructor(code: LlmClientErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'LlmClientError';
    this.code = code;
    this.status = status;
  }
}

export interface ChatOptions {
  /** Base URL провайдера (запрос идёт на {url}/v1/chat/completions). */
  url: string;
  /** Bearer-токен (Authorization header). */
  apiKey: string;
  /** Строка модели "<provider>/<modelId>". */
  model: string;
  /** История сообщений в формате OpenAI chat. */
  messages: ChatMessage[];
  /** Таймаут, мс (дефолт LLM_CALL_TIMEOUT_MS = 120 c, 02 §6). */
  timeoutMs?: number;
}

/**
 * Один запрос к chat/completions; возвращает content первого choice.
 * Ошибки сети/таймаута/HTTP → LlmClientError (повторных вызовов по шагу НЕ делается, 02 §6).
 */
export async function chatCompletion(opts: ChatOptions): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? LLM_CALL_TIMEOUT_MS);

  let resp: Response;
  try {
    resp = await fetch(`${opts.url.replace(/\/+$/, '')}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: opts.model, messages: opts.messages }),
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new LlmClientError('LLM_TIMEOUT', `Вызов LLM превысил таймаут и был остановлен`);
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new LlmClientError('LLM_NETWORK', `Сетевая ошибка при обращении к провайдеру: ${message}`);
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    let snippet = '';
    try {
      snippet = (await resp.text()).slice(0, 500);
    } catch {
      // тело ответа недоступно — не критично
    }
    throw new LlmClientError(
      'LLM_HTTP',
      `Провайдер вернул HTTP ${resp.status}${snippet ? `: ${snippet}` : ''}`,
      resp.status,
    );
  }

  let data: unknown;
  try {
    data = await resp.json();
  } catch (err) {
    throw new LlmClientError('LLM_BAD_RESPONSE', `Ответ провайдера не является корректным JSON: ${(err as Error).message}`);
  }
  const choice = (data as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0];
  if (typeof choice?.message?.content !== 'string') {
    throw new LlmClientError('LLM_BAD_RESPONSE', 'Ответ провайдера не содержит choices[0].message.content');
  }
  return choice.message.content;
}
