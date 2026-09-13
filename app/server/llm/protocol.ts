// Протокол «JSON в тексте» (ТЗ docs-llm/03 §1–2): извлечение ПЕРВОГО {...} блока
// с учётом вложенных скобок и строковых литералов, валидация {action, args[, thought]}.
// Чистые функции без IO.

export type LlmActionName = 'run_generation' | 'read_result' | 'correct_result' | 'finish';

/** Известный набор действий (03 §1; исполнители — LST-4). */
export const KNOWN_ACTIONS: readonly LlmActionName[] = [
  'run_generation',
  'read_result',
  'correct_result',
  'finish',
];

export interface ParsedLlmAction {
  action: LlmActionName;
  /** Объект аргументов (отсутствующий args нормализуется в {}). */
  args: Record<string, unknown>;
  /** Опциональный свободный текст рассуждения LLM (записывается в журнал). */
  thought?: string;
}

export type ProtocolErrorCode = 'invalid_json' | 'unknown_action' | 'schema_violation';

/** Типизированная ошибка протокола: неверный JSON / неизвестное действие / схема. */
export class ProtocolError extends Error {
  readonly code: ProtocolErrorCode;

  constructor(code: ProtocolErrorCode, message: string) {
    super(message);
    this.name = 'ProtocolError';
    this.code = code;
  }
}

/** Follow-up-сообщение LLM при неверном ответе (эталонный текст, 03 §2.3). */
export const FOLLOWUP_MESSAGE =
  'Твой ответ не распознан как валидное действие. Верни строго валидный JSON в ' +
  'формате {"action": <имя>, "args": {...}}. Доступные действия: run_generation, ' +
  'read_result, correct_result, finish. Схемы — в системном промпте.';

/** Повтор follow-up до 2 раз; после третьего неверного ответа сессия → error (03 §2.3). */
export const MAX_PROTOCOL_RETRIES = 2;

/**
 * Извлечение ПЕРВОГО {...} блока: от первого `{` — балансированный пролёт по
 * скобкам с учётом вложенных скобок и строк с экранированием `\"` (03 §2.1).
 * Возвращает текст блока или null (нет `{` / незакрытый блок).
 */
export function extractFirstJsonBlock(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Разбор ответа LLM: первый {...} блок → JSON.parse → объект со строковым `action`
 * из известного набора и объектным (или отсутствующим → {}) `args`.
 * Бросает ProtocolError при неверном JSON / неизвестном action / нарушении схемы.
 */
export function parseActionMessage(text: string): ParsedLlmAction {
  const block = extractFirstJsonBlock(typeof text === 'string' ? text : '');
  if (block === null) {
    throw new ProtocolError('invalid_json', 'не удалось найти JSON-блок в ответе LLM');
  }
  let value: unknown;
  try {
    value = JSON.parse(block);
  } catch (err) {
    throw new ProtocolError('invalid_json', `неверный JSON: ${(err as Error).message}`);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProtocolError('schema_violation', 'действие должно быть объектом вида {"action": <имя>, "args": {...}}');
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj.action !== 'string') {
    throw new ProtocolError('schema_violation', 'поле "action" отсутствует или не строка');
  }
  if (!(KNOWN_ACTIONS as readonly string[]).includes(obj.action)) {
    throw new ProtocolError('unknown_action', `неизвестное действие «${obj.action}»`);
  }
  let args: Record<string, unknown> = {};
  if (obj.args !== undefined) {
    if (typeof obj.args !== 'object' || obj.args === null || Array.isArray(obj.args)) {
      throw new ProtocolError('schema_violation', 'поле "args" должно быть объектом');
    }
    args = obj.args as Record<string, unknown>;
  }
  let thought: string | undefined;
  if (obj.thought !== undefined) {
    if (typeof obj.thought !== 'string') {
      throw new ProtocolError('schema_violation', 'поле "thought" должно быть строкой');
    }
    thought = obj.thought;
  }
  return { action: obj.action as LlmActionName, args, ...(thought !== undefined ? { thought } : {}) };
}
