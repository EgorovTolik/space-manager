// Разбор spec.yaml проекта для LLM-модуля (ТЗ docs-llm/03 §4, 05 §3.3).
// Чистые функции: структура спеки, маски, база площади F и цели кластеров.
// YAML разбирается js-yaml (тот же пакет, что в редакторе) — формат спеки не
// меняется, модуль только ЧИТАЕТ файлы проекта, ничего не записывая.
import yaml from 'js-yaml';

export interface SpecType {
  /** Одиночный символ типа на карте-результате. */
  symbol: string;
  name: string | null;
}

export interface SpecCluster {
  id: string;
  type: string;
  areaPercent: number;
  shape: string;
}

/** Правила размещения спеки (docs/04-rules-and-adjacency.md); дефолты — при отсутствии полей. */
export interface SpecRules {
  /** Режим связи/соседства: 4 или 8 (текущий срез — 8). */
  connectivity: number;
  adjacency: {
    /** Жёсткий whitelist пар типов; null = default-open. */
    allow: Array<[string, string]> | null;
    /** Blacklist пар типов, которым запрещено соприкасаться. */
    forbidden: Array<[string, string]>;
  };
  fillAll: boolean;
  touchAll: boolean;
}

export interface SpecInfo {
  width: number;
  height: number;
  /** Имена масок как в спеке (относительные от каталога спеки); null — маски нет. */
  blockedFile: string | null;
  presetFile: string | null;
  types: Record<string, SpecType>;
  clusters: SpecCluster[];
  /** Правила speки (lenient-разбор; дефолты docs/04 при отсутствии блока/полей). */
  rules: SpecRules;
}

function fail(message: string): never {
  throw new Error(`спекация проекта: ${message}`);
}

/** Пары типов adjacency: массив [A, B] строк; null/undefined → дефолт. Lenient —
 * невалидные пары пропускаются (полную валидацию делает солвер). */
function parseTypePairs(value: unknown): Array<[string, string]> {
  if (!Array.isArray(value)) return [];
  const out: Array<[string, string]> = [];
  for (const p of value) {
    if (Array.isArray(p) && p.length === 2 && typeof p[0] === 'string' && typeof p[1] === 'string') {
      out.push([p[0], p[1]]);
    }
  }
  return out;
}

/** Разбор блока rules с дефолтами (docs/04): connectivity 8, default-open adjacency. */
function parseRules(doc: Record<string, unknown>): SpecRules {
  const raw = doc.rules;
  const rec = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const connectivity = typeof rec.connectivity === 'number' && Number.isInteger(rec.connectivity) ? rec.connectivity : 8;
  const adj = typeof rec.adjacency === 'object' && rec.adjacency !== null
    ? (rec.adjacency as Record<string, unknown>)
    : {};
  const allow = Array.isArray(adj.allow) ? parseTypePairs(adj.allow) : null;
  return {
    connectivity,
    adjacency: { allow, forbidden: parseTypePairs(adj.forbidden) },
    fillAll: rec.fillAll === true,
    touchAll: rec.touchAll === true,
  };
}

/** Разбор spec.yaml в структуру (валидация минимальная — полную делает солвер). */
export function parseSpec(text: string): SpecInfo {
  let doc: unknown;
  try {
    doc = yaml.load(text);
  } catch (err) {
    fail(`не удалось разобрать YAML: ${(err as Error).message}`);
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    fail('корневой объект отсутствует');
  }
  const obj = doc as Record<string, unknown>;

  const grid = obj.grid;
  if (typeof grid !== 'object' || grid === null) fail('отсутствует блок grid');
  const width = (grid as { width?: unknown }).width;
  const height = (grid as { height?: unknown }).height;
  if (typeof width !== 'number' || !Number.isInteger(width) || width <= 0) {
    fail('grid.width — целое > 0');
  }
  if (typeof height !== 'number' || !Number.isInteger(height) || height <= 0) {
    fail('grid.height — целое > 0');
  }

  const fileRef = (key: 'blockedFile' | 'presetFile'): string | null => {
    const v = obj[key];
    if (v === undefined || v === null) return null;
    if (typeof v !== 'string' || v.trim() === '') fail(`${key} — непустая строка`);
    return v;
  };

  const types: Record<string, SpecType> = {};
  const rawTypes = obj.types;
  if (rawTypes !== undefined && rawTypes !== null) {
    if (typeof rawTypes !== 'object' || Array.isArray(rawTypes)) fail('types — объект id → {symbol, name}');
    for (const [id, def] of Object.entries(rawTypes as Record<string, unknown>)) {
      if (typeof def !== 'object' || def === null) fail(`types.${id} — объект`);
      const symbol = (def as { symbol?: unknown }).symbol;
      if (typeof symbol !== 'string' || symbol.length !== 1) fail(`types.${id}.symbol — один символ`);
      const name = (def as { name?: unknown }).name;
      types[id] = { symbol, name: typeof name === 'string' ? name : null };
    }
  }

  const clusters: SpecCluster[] = [];
  const rawClusters = obj.clusters;
  if (Array.isArray(rawClusters)) {
    for (const [i, c] of (rawClusters as unknown[]).entries()) {
      if (typeof c !== 'object' || c === null) fail(`clusters[${i}] — объект`);
      const rec = c as Record<string, unknown>;
      if (typeof rec.id !== 'string' || rec.id.trim() === '') fail(`clusters[${i}].id — непустая строка`);
      if (typeof rec.type !== 'string') fail(`clusters[${i}].type — строка`);
      if (typeof rec.areaPercent !== 'number' || !Number.isFinite(rec.areaPercent)) {
        fail(`clusters[${i}].areaPercent — число`);
      }
      clusters.push({
        id: rec.id,
        type: rec.type,
        areaPercent: rec.areaPercent,
        shape: typeof rec.shape === 'string' ? rec.shape : 'free',
      });
    }
  }

  return {
    width,
    height,
    blockedFile: fileRef('blockedFile'),
    presetFile: fileRef('presetFile'),
    types,
    clusters,
    rules: parseRules(obj),
  };
}

/** Маска (текст width×height) → сетка символов; несовпадение размера — ошибка. */
export function maskToGrid(text: string, width: number, height: number): string[][] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop(); // завершающий \n
  if (lines.length !== height) {
    throw new Error(`маска: строк ${lines.length}, ожидается ${height}`);
  }
  const grid: string[][] = [];
  for (let y = 0; y < height; y++) {
    const line = lines[y];
    if (line.length !== width) {
      throw new Error(`маска: строка ${y} длины ${line.length}, ожидается ${width}`);
    }
    grid.push([...line]);
  }
  return grid;
}

/**
 * База площади F — свободные клетки БЕЗ блокировок (preset НЕ уменьшает F;
 * docs/03 §3, docs/05 §6 — та же формула, что в солвере и валидаторе).
 */
export function countFreeCells(grid: string[][]): number {
  let free = 0;
  for (const row of grid) {
    for (const ch of row) {
      if (ch !== '*') free++;
    }
  }
  return free;
}

/** Цель кластера в клетках: round(F · areaPercent / 100) (docs/06 §4). */
export function clusterTarget(freeCells: number, areaPercent: number): number {
  return Math.round((freeCells * areaPercent) / 100);
}
