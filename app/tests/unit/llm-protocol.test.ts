// Юнит-тесты парсера JSON-протокола (ТЗ docs-llm/07 §2, 03 §1–2). Чистые функции.
import { describe, expect, it } from 'vitest';

import {
  extractFirstJsonBlock,
  FOLLOWUP_MESSAGE,
  KNOWN_ACTIONS,
  MAX_PROTOCOL_RETRIES,
  parseActionMessage,
  ProtocolError,
} from '../../server/llm/protocol.js';

describe('extractFirstJsonBlock', () => {
  it('ничего нет до блока', () => {
    expect(extractFirstJsonBlock('{"a":1}')).toBe('{"a":1}');
  });

  it('текст до и после блока игнорируется (03 §2.1)', () => {
    expect(extractFirstJsonBlock('Думаю... {"action":"finish"} ...остальное')).toBe('{"action":"finish"}');
  });

  it('вложенные скобки в args', () => {
    const text = 'x {"args": {"areaPercent": {"ком1": 20}}} y';
    expect(extractFirstJsonBlock(text)).toBe('{"args": {"areaPercent": {"ком1": 20}}}');
  });

  it('скобки внутри строковых литералов и экранирование \\\"', () => {
    const text = 'pre {"thought": "видел { и } и \\" кавычку"} post';
    expect(extractFirstJsonBlock(text)).toBe('{"thought": "видел { и } и \\" кавычку"}');
  });

  it('два блока — берётся ПЕРВЫЙ (07 §2)', () => {
    const text = '{"action":"finish","args":{"candidates":[]}} {"action":"read_result"}';
    expect(extractFirstJsonBlock(text)).toBe('{"action":"finish","args":{"candidates":[]}}');
  });

  it('нет { → null; незакрытый блок → null', () => {
    expect(extractFirstJsonBlock('просто текст')).toBeNull();
    expect(extractFirstJsonBlock('{"a": {')).toBeNull();
  });

  // LST-6 живой прогон: локальные GGUF-модели часто оборачивают ответ в markdown-заборы.
  it('markdown-забор ```json … ``` вокруг объекта терпится (LST-6)', () => {
    const text = 'Вот действие:\n```json\n{"action":"read_result","args":{"file":"result-1.txt"}}\n```\nГотово.';
    expect(extractFirstJsonBlock(text)).toBe('{"action":"read_result","args":{"file":"result-1.txt"}}');
  });

  it('забор без языка и с рассуждением после блока (LST-6)', () => {
    const text = '```\n{"action": "finish", "args": {"candidates": [{"file": "a", "comment": "x"}]}}\n```\nОбоснование: аргументы со скобками {y}.';
    expect(extractFirstJsonBlock(text)).toBe('{"action": "finish", "args": {"candidates": [{"file": "a", "comment": "x"}]}}');
  });
});

describe('parseActionMessage: валидные ответы', () => {
  it('минимальный {"action","args"}', () => {
    expect(parseActionMessage('{"action":"run_generation","args":{"seed":7}}')).toEqual({
      action: 'run_generation',
      args: { seed: 7 },
    });
  });

  it('args может быть пустым объектом (run_generation без оверрайдов)', () => {
    expect(parseActionMessage('{"action":"run_generation","args":{}}').args).toEqual({});
  });

  it('args отсутствует → нормализуется в {}', () => {
    const parsed = parseActionMessage('{"action":"finish"}');
    expect(parsed.args).toEqual({});
  });

  it('thought опционален: есть — строкой, нет — поля нет', () => {
    const withThought = parseActionMessage(
      '{"action":"read_result","args":{"file":"result-1.txt"},"thought":"проверю отчёт"}',
    );
    expect(withThought.thought).toBe('проверю отчёт');
    expect(parseActionMessage('{"action":"finish","args":{}}').thought).toBeUndefined();
  });

  it('JSON с текстом до/после разбирается', () => {
    const parsed = parseActionMessage(
      'Готово. {"action":"correct_result","args":{"baseFile":"r.txt","edits":[]},"thought":"t"} Как?',
    );
    expect(parsed.action).toBe('correct_result');
  });

  it('все четыре действия из известного набора', () => {
    expect([...KNOWN_ACTIONS]).toEqual(['run_generation', 'read_result', 'correct_result', 'finish']);
    for (const action of KNOWN_ACTIONS) {
      expect(parseActionMessage(`{"action":"${action}","args":{}}`).action).toBe(action);
    }
  });
});

describe('parseActionMessage: ошибки → ProtocolError', () => {
  it('мусор без JSON-блока → invalid_json', () => {
    expect(() => parseActionMessage('ничего похожего на JSON')).toThrow(ProtocolError);
    try {
      parseActionMessage('ничего');
    } catch (err) {
      expect((err as ProtocolError).code).toBe('invalid_json');
    }
  });

  it('неверный JSON внутри блока → invalid_json', () => {
    try {
      parseActionMessage('{"action": "finish",}');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ProtocolError);
      expect((err as ProtocolError).code).toBe('invalid_json');
    }
  });

  it('неизвестное action → unknown_action', () => {
    try {
      parseActionMessage('{"action":"dance","args":{}}');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ProtocolError);
      expect((err as ProtocolError).code).toBe('unknown_action');
      expect((err as ProtocolError).message).toContain('«dance»');
    }
  });

  it('отсутствие action → schema_violation', () => {
    try {
      parseActionMessage('{"args":{"a":1}}');
      expect.unreachable();
    } catch (err) {
      expect((err as ProtocolError).code).toBe('schema_violation');
    }
  });

  it('args не объект → schema_violation', () => {
    try {
      parseActionMessage('{"action":"finish","args":[1,2]}');
      expect.unreachable();
    } catch (err) {
      expect((err as ProtocolError).code).toBe('schema_violation');
    }
  });

  it('thought не строка → schema_violation', () => {
    try {
      parseActionMessage('{"action":"finish","args":{},"thought":42}');
      expect.unreachable();
    } catch (err) {
      expect((err as ProtocolError).code).toBe('schema_violation');
    }
  });

  it('текст без {...} (например чистый массив) → invalid_json', () => {
    try {
      parseActionMessage('[1,2]');
      expect.unreachable();
    } catch (err) {
      expect((err as ProtocolError).code).toBe('invalid_json');
    }
  });

  it('follow-up текст и лимит повторов зафиксированы (03 §2.3)', () => {
    expect(FOLLOWUP_MESSAGE).toContain('Верни строго валидный JSON');
    expect(FOLLOWUP_MESSAGE).toContain('run_generation');
    expect(MAX_PROTOCOL_RETRIES).toBe(2);
  });

  it('ответ целиком в markdown-заборе ```json … ``` разбирается (LST-6 живой прогон)', () => {
    const text = '```json\n{"action":"run_generation","args":{"seed":7},"thought":"попробуем seed 7"}\n```';
    const parsed = parseActionMessage(text);
    expect(parsed.action).toBe('run_generation');
    expect(parsed.args).toEqual({ seed: 7 });
    expect(parsed.thought).toBe('попробуем seed 7');
  });
});
