// Авто-опрос моделей провайдеров: GET {url}/v1/models (ТЗ docs-llm/02 §4).
// Паттерн multiagents (server/src/index.ts, /api/providers/:id/models): кэш TTL ~60 c,
// при сбое — просроченный кэш (stale), при отсутствии кэша — пустой список без падения.
import {
  MODELS_CACHE_TTL,
  MODEL_DISCOVERY_TIMEOUT_MS,
  type LlmProvider,
} from './config.js';

export interface ProviderModelsResult {
  /** Отсортированные id моделей провайдера (без префикса provider/). */
  models: string[];
  /** true — список из просроченного кэша после сбоя опроса. */
  stale: boolean;
  /** Текст причины сбоя (только когда запрос не удался). */
  error?: string;
}

interface CacheEntry {
  models: string[];
  fetchedAt: number;
}

/** Модульный кэш списка моделей на провайдера (не сериализуется в ответы API). */
const cache = new Map<string, CacheEntry>();

/** Сброс кэша (юнит-тесты; при изменении провайдеров поведение — перезапрос по TTL). */
export function resetModelsCache(): void {
  cache.clear();
}

interface FetchOpts {
  /** Таймаут запроса, мс (дефолт MODEL_DISCOVERY_TIMEOUT_MS = 10 c, ТЗ 02 §4.3). */
  timeoutMs?: number;
  /** «Текущее время» (инъекция для детерминированных тестов TTL-кэша). */
  now?: () => number;
}

/**
 * Список моделей одного провайдера. Свежий кэш → без HTTP. Сбой/таймаут →
 * просроченный кэш со stale:true либо { models: [] } (провайдер остаётся в списке).
 */
export async function fetchProviderModels(
  id: string,
  provider: LlmProvider,
  opts: FetchOpts = {},
): Promise<ProviderModelsResult> {
  const now = opts.now ?? Date.now;
  const cached = cache.get(id);
  if (cached !== undefined && now() - cached.fetchedAt < MODELS_CACHE_TTL) {
    return { models: cached.models, stale: false };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? MODEL_DISCOVERY_TIMEOUT_MS);
    let resp: Response;
    try {
      resp = await fetch(`${provider.url.replace(/\/+$/, '')}/v1/models`, {
        headers: {
          Authorization: `Bearer ${provider.apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = (await resp.json()) as { data?: unknown };
    const ids: string[] = Array.isArray(data?.data)
      ? (data.data as Array<{ id?: unknown }>)
          .map((m) => m.id)
          .filter((v): v is string => typeof v === 'string')
      : [];
    const models = [...new Set(ids)].sort();
    cache.set(id, { models, fetchedAt: now() });
    return { models, stale: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (cached !== undefined) {
      // Сбой/таймаут при наличии кэша — отдаём даже просроченный (02 §4.3).
      return { models: cached.models, stale: true, error: message };
    }
    return { models: [], stale: false, error: message };
  }
}

/** Параллельный опрос всех провайдеров; сбой одного не влияет на остальных. */
export async function fetchAllProviderModels(
  providers: Record<string, LlmProvider>,
  opts: FetchOpts = {},
): Promise<Record<string, ProviderModelsResult>> {
  const ids = Object.keys(providers);
  const settled = await Promise.all(
    ids.map(async (id) => [id, await fetchProviderModels(id, providers[id], opts)] as const),
  );
  return Object.fromEntries(settled);
}
