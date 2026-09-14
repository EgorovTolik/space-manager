// Детекция стагнации LLM-агента (ТЗ docs-llm/05 §2.1): модель «завершила работу»
// без finish, если 3 подряд ИСПОЛНЯЮЩИХ шага (run_generation/correct_result;
// read_result и finish не учитываются) имеют идентичный хэш (action + канонический
// JSON аргументов). Чистые функции без IO — детектор DI-руется в агентный цикл.
import { createHash } from 'node:crypto';

/** Порог: подряд одинаковых исполняющих шагов, после которого сессия завершается автоматически. */
export const STAGNATION_LIMIT = 3;

/** Текст note журнала при авто-завершении по стагнации (эталонный — для тестов). */
export const STAGNATION_NOTE =
  'авто-завершение: модель 3 раза подряд повторила одинаковое действие без прогресса';

/**
 * Канонический JSON: ключи объектов рекурсивно отсортированы по алфавиту,
 * порядок массивов сохраняется.
 * Детерминированный отпечаток для сравнения аргументов.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`);
  return `{${parts.join(',')}}`;
}

/** Детерминированный хэш шага: sha256(action + канонический JSON аргументов). */
export function stagnationHash(action: string, args: Record<string, unknown>): string {
  const payload = `${action}\u0000${canonicalJson(args)}`;
  return createHash('sha256').update(payload).digest('hex');
}

/**
 * Детектор стагнации (чистый счётчик, DI в цикл): feed() вызывается на каждом
 * исполняющем шаге (run_generation/correct_result, независимо от ok результата);
 * true — когда порог подряд идентичных хэшей достигнут. Любой другой шаг между
 * повторами сбрасывает счётчик (считаются только ПОДРЯД).
 */
export function createStagnationDetector(limit: number = STAGNATION_LIMIT): {
  feed(action: string, args: Record<string, unknown>): boolean;
} {
  let lastHash: string | null = null;
  let row = 0;
  return {
    feed(action: string, args: Record<string, unknown>): boolean {
      const hash = stagnationHash(action, args);
      if (hash === lastHash) row += 1;
      else {
        lastHash = hash;
        row = 1;
      }
      return row >= limit;
    },
  };
}
