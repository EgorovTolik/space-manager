// Юнит-тесты GET /api/llm/providers (ТЗ docs-llm/06 §1.1, 02 §5).
// Конфиг — только через env LLM_CONFIG_PATH на tmp-файлы; fetch провайдеров — mock'и.
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api, startServer, type TestCtx } from './helpers.js';
import { resetModelsCache } from '../../server/llm/models.js';

const VALID_CONFIG = {
  providers: {
    'eac-mac-ai': { url: 'http://mac.example', apiKey: 'kv-123' },
    'eac-home-ai': { url: 'http://home.example', apiKey: 'kv-456' },
  },
  defaultModel: 'eac-mac-ai/Qwen3.6-35B-A3B-UD-Q6_K.gguf',
  labels: { 'eac-home-ai/Qwen3.6-35B-A3B-UD-Q6_K.gguf': 'лучшая локальная' },
};

let ctx: TestCtx;
let tmpDir: string;
let savedEnv: string | undefined;
let realFetch: typeof fetch;
/** Мок опроса провайдеров (локальный test-сервер ходит через реальный fetch). */
let providerMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  ctx = await startServer();
  tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'llm-api-'));
  savedEnv = process.env.LLM_CONFIG_PATH;
  resetModelsCache();
  realFetch = globalThis.fetch.bind(globalThis);
  providerMock = vi.fn();
  vi.stubGlobal('fetch', ((url: string | URL | Request, init?: RequestInit) => {
    if (typeof url === 'string' && url.startsWith(ctx.base)) return realFetch(url, init);
    return providerMock(String(url), init);
  }) as typeof fetch);
});

afterEach(async () => {
  if (savedEnv === undefined) delete process.env.LLM_CONFIG_PATH;
  else process.env.LLM_CONFIG_PATH = savedEnv;
  await fsp.rm(tmpDir, { recursive: true, force: true });
  vi.unstubAllGlobals();
  resetModelsCache();
  await ctx.stop();
});

async function writeConfig(name: string, content: unknown): Promise<void> {
  process.env.LLM_CONFIG_PATH = path.join(
    tmpDir,
    name,
  );
  await fsp.writeFile(process.env.LLM_CONFIG_PATH, JSON.stringify(content), 'utf8');
}

describe('GET /api/llm/providers', () => {
  it('без llm.config.json → 200 {configured:false, reason}', async () => {
    process.env.LLM_CONFIG_PATH = path.join(tmpDir, 'missing.json');
    const res = await api(ctx, 'GET', '/api/llm/providers');
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ configured: false, reason: 'файл не найден' });
  });

  it('невалидный конфиг → 200 {configured:false, reason} (сервис жив)', async () => {
    await writeConfig('bad.json', { providers: {}, defaultModel: 'a/b' });
    const res = await api(ctx, 'GET', '/api/llm/providers');
    expect(res.status).toBe(200);
    const body = res.json as { configured: boolean; reason: string };
    expect(body.configured).toBe(false);
    expect(body.reason).toContain('providers');
  });

  it('валидный конфиг → провайдеры, отсортированные модели, подписи; ключи не утекают', async () => {
    await writeConfig('ok.json', VALID_CONFIG);
    providerMock.mockImplementation((url: string) => {
      const body = String(url).includes('home.example')
        ? { data: [{ id: 'Qwen3.6-35B-A3B-UD-Q6_K.gguf' }, { id: 'zz-other.gguf' }] }
        : { data: [{ id: 'Qwen3.6-35B-A3B-UD-Q6_K.gguf' }] };
      return Promise.resolve(
        new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      );
    });

    const res = await api(ctx, 'GET', '/api/llm/providers');
    expect(res.status).toBe(200);
    const body = res.json as {
      configured: boolean;
      defaultModel: string;
      providers: Array<{ id: string; models: Array<{ id: string; label: string | null }> }>;
    };
    expect(body.configured).toBe(true);
    expect(body.defaultModel).toBe('eac-mac-ai/Qwen3.6-35B-A3B-UD-Q6_K.gguf');
    expect(body.providers.map((p) => p.id)).toEqual(['eac-mac-ai', 'eac-home-ai']);

    const home = body.providers.find((p) => p.id === 'eac-home-ai');
    expect(home?.models).toEqual([
      { id: 'Qwen3.6-35B-A3B-UD-Q6_K.gguf', label: 'лучшая локальная' },
      { id: 'zz-other.gguf', label: null },
    ]);
    const mac = body.providers.find((p) => p.id === 'eac-mac-ai');
    expect(mac?.models).toEqual([{ id: 'Qwen3.6-35B-A3B-UD-Q6_K.gguf', label: null }]);

    // Ключи провайдеров в ответе не передаются (02 §1 / 06 §1.1).
    const raw = JSON.stringify(res.json);
    expect(raw).not.toContain('kv-123');
    expect(raw).not.toContain('kv-456');
  });

  it('недоступный провайдер → models: [] (сталь), остальные живут', async () => {
    await writeConfig('ok.json', VALID_CONFIG);
    providerMock.mockImplementation((url: string) => {
      if (String(url).includes('home.example')) return Promise.reject(new TypeError('fetch failed'));
      return Promise.resolve(
        new Response(JSON.stringify({ data: [{ id: 'm.gguf' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });

    const res = await api(ctx, 'GET', '/api/llm/providers');
    expect(res.status).toBe(200);
    const body = res.json as { configured: boolean; providers: Array<{ id: string; models: unknown[] }> };
    expect(body.configured).toBe(true);
    expect(body.providers.find((p) => p.id === 'eac-home-ai')?.models).toEqual([]);
    expect(body.providers.find((p) => p.id === 'eac-mac-ai')?.models).toHaveLength(1);
  });
});
