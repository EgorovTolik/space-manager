// Юнит-тесты конфиг-лоадера LLM (ТЗ docs-llm/07 §2, 02 §2/§5).
// Реальный llm.config.json НЕ трогаем: путь — только через tmp + env LLM_CONFIG_PATH.
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  defaultConfigPath,
  loadLlmConfig,
  MODELS_CACHE_TTL,
  validateLlmConfig,
} from '../../server/llm/config.js';

const VALID_CONFIG = {
  providers: {
    'eac-mac-ai': { url: 'http://localhost:44221', apiKey: 'kv-123' },
    'eac-home-ai': { url: 'http://eac-agent.online:44221', apiKey: 'kv-123' },
  },
  defaultModel: 'eac-mac-ai/Qwen3.6-35B-A3B-UD-Q6_K.gguf',
  labels: { 'eac-home-ai/Qwen3.6-35B-A3B-UD-Q6_K.gguf': 'лучшая локальная' },
};

let tmpDir: string;
let savedEnv: string | undefined;

async function writeConfig(name: string, content: unknown): Promise<string> {
  const file = path.join(tmpDir, name);
  await fsp.writeFile(file, typeof content === 'string' ? content : JSON.stringify(content), 'utf8');
  return file;
}

beforeEach(async () => {
  tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'llm-config-'));
  savedEnv = process.env.LLM_CONFIG_PATH;
});

afterEach(async () => {
  if (savedEnv === undefined) delete process.env.LLM_CONFIG_PATH;
  else process.env.LLM_CONFIG_PATH = savedEnv;
  await fsp.rm(tmpDir, { recursive: true, force: true });
});

describe('loadLlmConfig: валидный конфиг', () => {
  it('возвращает парсинг providers/defaultModel/labels', async () => {
    const file = await writeConfig('ok.json', VALID_CONFIG);
    const loaded = await loadLlmConfig(file);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.config.providers['eac-mac-ai']).toEqual({
      url: 'http://localhost:44221',
      apiKey: 'kv-123',
    });
    expect(loaded.config.defaultModel).toBe('eac-mac-ai/Qwen3.6-35B-A3B-UD-Q6_K.gguf');
    expect(loaded.config.labels['eac-home-ai/Qwen3.6-35B-A3B-UD-Q6_K.gguf']).toBe('лучшая локальная');
  });

  it('labels опционален: отсутствует → {}', async () => {
    const file = await writeConfig('nolabels.json', { ...VALID_CONFIG, labels: undefined });
    const loaded = await loadLlmConfig(file);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.config.labels).toEqual({});
  });
});

describe('loadLlmConfig: файл отсутствует / битый JSON', () => {
  it('отсутствующий файл → ok:false, причина «файл не найден»', async () => {
    const loaded = await loadLlmConfig(path.join(tmpDir, 'no-such.json'));
    expect(loaded).toEqual({ ok: false, reason: 'файл не найден' });
  });

  it('битый JSON → ok:false с указанием ошибки', async () => {
    const file = await writeConfig('broken.json', '{ "providers": ');
    const loaded = await loadLlmConfig(file);
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.reason).toContain('не является корректным JSON');
  });
});

describe('loadLlmConfig: невалидная схема (02 §2)', () => {
  it('нет providers', async () => {
    const file = await writeConfig('noproviders.json', { defaultModel: 'a/b' });
    const loaded = await loadLlmConfig(file);
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.reason).toContain('providers');
  });

  it('пустые providers', async () => {
    const file = await writeConfig('emptyproviders.json', { providers: {}, defaultModel: 'a/b' });
    const loaded = await loadLlmConfig(file);
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.reason).toContain('пуст');
  });

  it('пустая apiKey → невалидно', async () => {
    const bad = structuredClone(VALID_CONFIG);
    (bad.providers['eac-mac-ai'] as { apiKey: string }).apiKey = '';
    const file = await writeConfig('emptykey.json', bad);
    const loaded = await loadLlmConfig(file);
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.reason).toContain('apiKey');
  });

  it('некорректное имя провайдера (регистр/длина)', async () => {
    const file = await writeConfig('badid.json', {
      providers: { 'EAC Mac': { url: 'http://x', apiKey: 'k' } },
      defaultModel: 'EAC Mac/m.gguf',
    });
    const loaded = await loadLlmConfig(file);
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.reason).toContain('имя провайдера');
  });

  it('defaultModel с неизвестным provider', async () => {
    const file = await writeConfig('badmodel.json', { ...VALID_CONFIG, defaultModel: 'ghost/m.gguf' });
    const loaded = await loadLlmConfig(file);
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.reason).toContain('ghost');
  });

  it('defaultModel без "/" — невалидно', async () => {
    const file = await writeConfig('noslash.json', { ...VALID_CONFIG, defaultModel: 'just-model' });
    const loaded = await loadLlmConfig(file);
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.reason).toContain('defaultModel');
  });

  it('validateLlmConfig — чистая функция: null на валидном, причина на битом', () => {
    expect(validateLlmConfig(VALID_CONFIG)).toBeNull();
    expect(validateLlmConfig(null)).not.toBeNull();
    expect(validateLlmConfig({ providers: {} })).toContain('providers');
  });
});

describe('loadLlmConfig: env LLM_CONFIG_PATH (тесты/переопределение)', () => {
  it('defaultConfigPath берёт env, иначе корень проекта/llm.config.json', async () => {
    const file = path.join(tmpDir, 'env.json');
    process.env.LLM_CONFIG_PATH = file;
    expect(defaultConfigPath()).toBe(file);
    delete process.env.LLM_CONFIG_PATH;
    expect(defaultConfigPath()).toContain('llm.config.json');
  });

  it('loadLlmConfig() без аргумента читает путь из env (hot-reload: перечитывает каждый раз)', async () => {
    const file = await writeConfig('env.json', VALID_CONFIG);
    process.env.LLM_CONFIG_PATH = file;
    let loaded = await loadLlmConfig();
    expect(loaded.ok).toBe(true);

    // Файл изменился → следующее обращение уже видит новый конфиг (без рестарта, 02 §5).
    const changed = structuredClone(VALID_CONFIG);
    delete (changed as { labels?: unknown }).labels;
    await fsp.writeFile(file, JSON.stringify(changed), 'utf8');
    loaded = await loadLlmConfig();
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.config.labels).toEqual({});
  });

  it('env указывает на отсутствующий файл → «файл не найден»', async () => {
    process.env.LLM_CONFIG_PATH = path.join(tmpDir, 'missing.json');
    const loaded = await loadLlmConfig();
    expect(loaded).toEqual({ ok: false, reason: 'файл не найден' });
  });
});

describe('константы', () => {
  it('MODELS_CACHE_TTL ≈ 60 c (02 §4.1)', () => {
    expect(MODELS_CACHE_TTL).toBe(60_000);
  });
});
