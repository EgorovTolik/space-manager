// Загрузка и валидация llm.config.json (ТЗ docs-llm/02 §1–§5).
// Чистые функции + readFile; конфиг перечитывается при каждом обращении к
// LLM-эндпоинтам (hot-reload, 02 §5 — перезапуск сервиса не требуется).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)); // <root>/app/server/llm
/** Корень проекта (каталог, где лежит llm.config.json). */
export const PROJECT_ROOT = path.join(here, '..', '..', '..');

/** Константы таймингов LLM-модуля (ТЗ docs-llm/02 §4, §6). */
export const MODELS_CACHE_TTL = 60_000; // кэш списка моделей, мс
export const MODEL_DISCOVERY_TIMEOUT_MS = 10_000; // таймаут GET {url}/v1/models, мс
export const LLM_CALL_TIMEOUT_MS = 120_000; // таймаут одного chat/completions, мс

export interface LlmProvider {
  /** Base URL OpenAI-совместимого API (запросы на {url}/v1/*). */
  url: string;
  /** Bearer-токен для /v1/*. */
  apiKey: string;
}

export interface LlmConfig {
  providers: Record<string, LlmProvider>;
  /** Строка вида "<provider>/<modelId>"; provider обязан быть в providers. */
  defaultModel: string;
  /** Ключ — "<provider>/<modelId>", значение — подпись для UI (02 §2). */
  labels: Record<string, string>;
}

/** Результат загрузки: либо конфиг, либо человекочитаемая причина на русском (02 §5.2). */
export type LlmConfigLoad = { ok: true; config: LlmConfig } | { ok: false; reason: string };

const PROVIDER_ID_RE = /^[a-z0-9_-]{1,40}$/;

/** Путь к конфигу: env LLM_CONFIG_PATH (тесты) → <корень проекта>/llm.config.json. */
export function defaultConfigPath(): string {
  return process.env.LLM_CONFIG_PATH ?? path.join(PROJECT_ROOT, 'llm.config.json');
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Валидация схемы конфига (02 §2). Возвращает причину на русском или null. */
export function validateLlmConfig(data: unknown): string | null {
  if (!isPlainObject(data)) return 'конфигурация LLM: корневой объект отсутствует';
  const providers = data.providers;
  if (!isPlainObject(providers)) return 'конфигурация LLM: отсутствует поле providers (объект)';
  if (Object.keys(providers).length === 0) {
    return 'конфигурация LLM: providers пуст — добавьте хотя бы одного провайдера';
  }
  for (const [id, p] of Object.entries(providers)) {
    if (!PROVIDER_ID_RE.test(id)) {
      return `конфигурация LLM: некорректное имя провайдера «${id}» (допустимо [a-z0-9_-]{1,40})`;
    }
    if (!isPlainObject(p)) {
      return `конфигурация LLM: провайдер «${id}» — запись должна быть объектом { url, apiKey }`;
    }
    if (typeof p.url !== 'string' || p.url.trim() === '') {
      return `конфигурация LLM: провайдер «${id}» — поле url обязано быть непустой строкой`;
    }
    if (typeof p.apiKey !== 'string' || p.apiKey.trim() === '') {
      return `конфигурация LLM: провайдер «${id}» — поле apiKey обязано быть непустой строкой`;
    }
  }
  const defaultModel = data.defaultModel;
  if (typeof defaultModel !== 'string' || !defaultModel.includes('/')) {
    return 'конфигурация LLM: defaultModel — строка вида "<provider>/<modelId>"';
  }
  const dmProvider = defaultModel.slice(0, defaultModel.indexOf('/'));
  if (!(dmProvider in providers)) {
    return `конфигурация LLM: провайдер «${dmProvider}» из defaultModel не найден в providers`;
  }
  if (data.labels !== undefined) {
    if (!isPlainObject(data.labels)) return 'конфигурация LLM: labels должен быть объектом';
    for (const [key, value] of Object.entries(data.labels)) {
      if (typeof value !== 'string') {
        return `конфигурация LLM: подписи моделей labels["${key}"] должны быть строками`;
      }
    }
  }
  return null;
}

/** Чтение и валидация конфига; невалидный/отсутствующий → ok:false (сервис жив, 02 §5). */
export async function loadLlmConfig(configPath?: string): Promise<LlmConfigLoad> {
  const file = configPath ?? defaultConfigPath();
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: false, reason: 'файл не найден' };
    }
    return { ok: false, reason: `не удалось прочитать llm.config.json: ${(err as Error).message}` };
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    return { ok: false, reason: `llm.config.json не является корректным JSON: ${(err as Error).message}` };
  }
  const problem = validateLlmConfig(data);
  if (problem !== null) return { ok: false, reason: problem };
  const obj = data as Record<string, unknown>;
  const providers: Record<string, LlmProvider> = {};
  for (const [id, p] of Object.entries(obj.providers as Record<string, unknown>)) {
    const rec = p as Record<string, unknown>;
    providers[id] = { url: rec.url as string, apiKey: rec.apiKey as string };
  }
  const labels: Record<string, string> = {};
  if (isPlainObject(obj.labels)) {
    for (const [k, v] of Object.entries(obj.labels)) labels[k] = v as string; // строки проверены в validateLlmConfig
  }
  return { ok: true, config: { providers, defaultModel: obj.defaultModel as string, labels } };
}
