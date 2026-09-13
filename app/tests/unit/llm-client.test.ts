// Юнит-тесты клиента chat/completions (ТЗ docs-llm/02 §6): fetch — mock'и.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { chatCompletion, LlmClientError, type ChatMessage } from '../../server/llm/client.js';

const MESSAGES: ChatMessage[] = [
  { role: 'system', content: 'система' },
  { role: 'user', content: 'привет' },
];

function okResponse(content: string): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('chatCompletion: успешный ответ', () => {
  it('POST {url}/v1/chat/completions с Bearer, model и messages; возвращает content', async () => {
    fetchMock.mockResolvedValueOnce(okResponse('{"action":"finish","args":{}}'));
    const content = await chatCompletion({
      url: 'http://llm.example/',
      apiKey: 'kv-123',
      model: 'eac-mac-ai/Qwen3.6-35B-A3B-UD-Q6_K.gguf',
      messages: MESSAGES,
    });
    expect(content).toBe('{"action":"finish","args":{}}');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://llm.example/v1/chat/completions');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer kv-123');
    expect(headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(String(init.body)) as { model: string; messages: unknown[] };
    expect(body.model).toBe('eac-mac-ai/Qwen3.6-35B-A3B-UD-Q6_K.gguf');
    expect(body.messages).toEqual(MESSAGES);
    // 02 §6: прочие параметры (temperature и т.п.) НЕ задаются — дефолты провайдера.
    expect('temperature' in body).toBe(false);
  });
});

describe('chatCompletion: ошибки → типизированные LlmClientError', () => {
  it('HTTP 500 → code LLM_HTTP с статусом и фрагментом тела', async () => {
    fetchMock.mockResolvedValueOnce(new Response('internal error', { status: 500 }));
    try {
      await chatCompletion({ url: 'http://llm.example', apiKey: 'k', model: 'p/m', messages: MESSAGES });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(LlmClientError);
      const e = err as LlmClientError;
      expect(e.code).toBe('LLM_HTTP');
      expect(e.status).toBe(500);
      expect(e.message).toContain('HTTP 500');
      expect(e.message).toContain('internal error');
    }
  });

  it('сетевая ошибка (fetch failed) → code LLM_NETWORK', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    try {
      await chatCompletion({ url: 'http://llm.example', apiKey: 'k', model: 'p/m', messages: MESSAGES });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(LlmClientError);
      expect((err as LlmClientError).code).toBe('LLM_NETWORK');
      expect((err as LlmClientError).message).toContain('fetch failed');
    }
  });

  it('таймаут (короткий, abort) → code LLM_TIMEOUT', async () => {
    fetchMock.mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal;
          if (signal) signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );
    try {
      await chatCompletion({
        url: 'http://llm.example',
        apiKey: 'k',
        model: 'p/m',
        messages: MESSAGES,
        timeoutMs: 30,
      });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(LlmClientError);
      expect((err as LlmClientError).code).toBe('LLM_TIMEOUT');
    }
  });

  it('ответ без choices[0].message.content → code LLM_BAD_RESPONSE', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [] }), { status: 200 }));
    try {
      await chatCompletion({ url: 'http://llm.example', apiKey: 'k', model: 'p/m', messages: MESSAGES });
      expect.unreachable();
    } catch (err) {
      expect((err as LlmClientError).code).toBe('LLM_BAD_RESPONSE');
    }
  });

  it('ответ не JSON → code LLM_BAD_RESPONSE', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>bad gateway</html>', { status: 200 }));
    try {
      await chatCompletion({ url: 'http://llm.example', apiKey: 'k', model: 'p/m', messages: MESSAGES });
      expect.unreachable();
    } catch (err) {
      expect((err as LlmClientError).code).toBe('LLM_BAD_RESPONSE');
    }
  });
});
