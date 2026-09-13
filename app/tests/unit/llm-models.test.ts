// Юнит-тесты модель-дискавери (ТЗ docs-llm/07 §2, 02 §4): fetch — mock'и.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchAllProviderModels,
  fetchProviderModels,
  resetModelsCache,
} from '../../server/llm/models.js';
import type { LlmProvider } from '../../server/llm/config.js';

const PROVIDERS: Record<string, LlmProvider> = {
  'p-ok': { url: 'http://ok.example', apiKey: 'k1' },
  'p-down': { url: 'http://down.example', apiKey: 'k2' },
};

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetModelsCache();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchProviderModels: успех', () => {
  it('возвращает отсортированный список id из { data: [{id}] } и шлёт Bearer', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: [{ id: 'z-model.gguf' }, { id: 'a-model.gguf' }] }),
    );
    const res = await fetchProviderModels('p-ok', PROVIDERS['p-ok']);
    expect(res).toEqual({ models: ['a-model.gguf', 'z-model.gguf'], stale: false });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://ok.example/v1/models');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer k1');
  });

  it('завершающий "/" в url обрезается', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [] }));
    await fetchProviderModels('p-ok', { url: 'http://ok.example/', apiKey: 'k1' });
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe('http://ok.example/v1/models');
  });

  it('некорректная data (нет массива) → пустой список без падения', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ foo: 'bar' }));
    const res = await fetchProviderModels('p-ok', PROVIDERS['p-ok']);
    expect(res.models).toEqual([]);
    expect(res.stale).toBe(false);
  });
});

describe('fetchProviderModels: сбой одного провайдера не роняет остальных', () => {
  it('ошибка сети у p-down → его models: [], другие живут', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('down.example')) return Promise.reject(new TypeError('fetch failed'));
      return Promise.resolve(jsonResponse({ data: [{ id: 'm1' }, { id: 'm2' }] }));
    });
    const all = await fetchAllProviderModels(PROVIDERS);
    expect(all['p-ok'].models).toEqual(['m1', 'm2']);
    expect(all['p-ok'].stale).toBe(false);
    expect(all['p-down'].models).toEqual([]);
    expect(all['p-down'].stale).toBe(false);
    expect(all['p-down'].error).toBeTruthy();
  });

  it('HTTP 500 провайдера → ошибка провайдера, не исключение', async () => {
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500 }));
    const res = await fetchProviderModels('p-ok', PROVIDERS['p-ok']);
    expect(res.models).toEqual([]);
    expect(res.error).toContain('500');
  });

  it('таймаут запроса (abort) → ошибка провайдера', async () => {
    fetchMock.mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal;
          if (signal) signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );
    const res = await fetchProviderModels('p-ok', PROVIDERS['p-ok'], { timeoutMs: 30 });
    expect(res.models).toEqual([]);
    expect(res.stale).toBe(false);
    expect(res.error).toBeTruthy();
  });
});

describe('fetchProviderModels: кэш TTL ~60 c', () => {
  it('в пределах TTL второй вызов без fetch; после TTL — перезапрос', async () => {
    let t = 1_000_000;
    const now = () => t;
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ data: [{ id: 'm' }] })));

    const first = await fetchProviderModels('p-ok', PROVIDERS['p-ok'], { now });
    expect(first.models).toEqual(['m']);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    t += 59_000; // ещё свежий кэш
    const second = await fetchProviderModels('p-ok', PROVIDERS['p-ok'], { now });
    expect(second.models).toEqual(['m']);
    expect(second.stale).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    t += 2_000; // > 60 s → перезапрос
    await fetchProviderModels('p-ok', PROVIDERS['p-ok'], { now });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('fetchProviderModels: stale-fallback (02 §4.3)', () => {
  it('после просрочки кэша при сбое — старые модели со stale:true', async () => {
    let t = 1_000_000;
    const now = () => t;
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ data: [{ id: 'old-model' }] })));

    await fetchProviderModels('p-ok', PROVIDERS['p-ok'], { now });
    t += 61_000; // кэш просрочен

    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    const res = await fetchProviderModels('p-ok', PROVIDERS['p-ok'], { now });
    expect(res.models).toEqual(['old-model']);
    expect(res.stale).toBe(true);
    expect(res.error).toBeTruthy();
  });

  it('сбоя не было — просроченный кэш обновляется свежим списком (stale:false)', async () => {
    let t = 1_000_000;
    const now = () => t;
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ data: [{ id: 'old-model' }] })));
    await fetchProviderModels('p-ok', PROVIDERS['p-ok'], { now });

    t += 61_000;
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [{ id: 'new-model' }] }));
    const res = await fetchProviderModels('p-ok', PROVIDERS['p-ok'], { now });
    expect(res.models).toEqual(['new-model']);
    expect(res.stale).toBe(false);
  });

  it('кэши независимы на провайдера: сбой одного не портит кэш другого', async () => {
    let t = 1_000_000;
    const now = () => t;
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('down.example')) return Promise.reject(new TypeError('fetch failed'));
      return Promise.resolve(jsonResponse({ data: [{ id: 'ok-model' }] }));
    });

    const first = await fetchAllProviderModels(PROVIDERS, { now });
    expect(first['p-ok'].models).toEqual(['ok-model']);
    expect(first['p-down'].models).toEqual([]);

    t += 61_000;
    // p-ok: успех обновил кэш; p-down: кэша не было — снова пусто, без падения.
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('down.example')) return Promise.reject(new TypeError('fetch failed'));
      return Promise.resolve(jsonResponse({ data: [{ id: 'ok-model' }] }));
    });
    const second = await fetchAllProviderModels(PROVIDERS, { now });
    expect(second['p-ok'].models).toEqual(['ok-model']);
    expect(second['p-down'].models).toEqual([]);
  });
});
