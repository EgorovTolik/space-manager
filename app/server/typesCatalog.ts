// Общий (глобальный) каталог типов: <workspaceDir>/types-catalog.json (ST-1).
// Единый список типов на все проекты: редактор показывает его чекбоксами и
// добавляет выбранные в spec.types проекта. Файл лежит ВКОРЕ workspace — рядом
// с каталогами проектов; listProjects перечисляет только directories, поэтому
// файл-каталог его не ломает.
// Чистые функции (parseTypesLenient/mergeCatalog) + DI для тестов: workspaceDir, now.
import fsp from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';

import type { Clock } from './workspace.js';

/** Имя файла каталога в корне workspace. */
export const CATALOG_FILE = 'types-catalog.json';

export interface CatalogTypeDef {
  /** Одиночный символ типа на карте-результате. */
  symbol: string;
  name: string | null;
}

/** Формат файла: `{ "types": { "<id>": { "symbol", "name" } }, "updatedAt": "<ISO>" }`. */
export interface TypesCatalog {
  types: Record<string, CatalogTypeDef>;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Чистые функции
// ---------------------------------------------------------------------------

/**
 * Lenient-разбор блока types из текста spec.yaml (паттерн parseSpec из
 * llm/specInfo.ts, но без fail): битый YAML / отсутствующий блок / невалидные
 * отдельные записи — пропускаются. Возвращает только допустимые id → {symbol, name}.
 */
export function parseTypesLenient(text: string): Record<string, CatalogTypeDef> {
  const out: Record<string, CatalogTypeDef> = {};
  let doc: unknown;
  try {
    doc = yaml.load(text);
  } catch {
    return out; // битый YAML — проект для каталога невалиден, молча пропускаем
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return out;
  const rawTypes = (doc as Record<string, unknown>).types;
  if (rawTypes === undefined || rawTypes === null) return out;
  if (typeof rawTypes !== 'object' || Array.isArray(rawTypes)) return out;
  for (const [id, def] of Object.entries(rawTypes as Record<string, unknown>)) {
    if (typeof def !== 'object' || def === null) continue;
    const symbol = (def as { symbol?: unknown }).symbol;
    if (typeof symbol !== 'string' || symbol.length !== 1) continue;
    const name = (def as { name?: unknown }).name;
    out[id] = { symbol, name: typeof name === 'string' ? name : null };
  }
  return out;
}

/**
 * Чистое слияние типов в каталог. Политика конфликтов (детерминированная):
 *   • новый id → добавить;
 *   • id с идентичным определением → без изменений;
 *   • id с РАЗЛИЧНЫМ symbol/name → сохранить ПЕРВОЕ зарегистрированное определение.
 * `changed` — действительно ли что-то изменилось (updatedAt обновляется только тогда).
 */
export function mergeCatalog(
  existing: TypesCatalog,
  incoming: Record<string, CatalogTypeDef>,
  nowIso: string,
): { catalog: TypesCatalog; changed: boolean } {
  const types: Record<string, CatalogTypeDef> = { ...existing.types };
  let changed = false;
  for (const [id, def] of Object.entries(incoming)) {
    const cur = types[id];
    if (cur === undefined) {
      types[id] = def;
      changed = true;
    } else if (cur.symbol !== def.symbol || cur.name !== def.name) {
      // Конфликт — оставляем первое зарегистрированное определение (без перезаписи).
    }
  }
  return {
    catalog: { types, updatedAt: changed ? nowIso : existing.updatedAt },
    changed,
  };
}

// ---------------------------------------------------------------------------
// fs-операции над <workspaceDir>/types-catalog.json
// ---------------------------------------------------------------------------

export function catalogPath(workspaceDir: string): string {
  return path.join(workspaceDir, CATALOG_FILE);
}

/** Чтение каталога; null — файла нет или он не читается/не парсится (битый). */
export async function readCatalogFile(workspaceDir: string): Promise<TypesCatalog | null> {
  try {
    const raw = await fsp.readFile(catalogPath(workspaceDir), 'utf8');
    const data = JSON.parse(raw) as Partial<TypesCatalog>;
    if (typeof data !== 'object' || data === null) return null;
    if (typeof data.types !== 'object' || data.types === null || Array.isArray(data.types)) return null;
    for (const def of Object.values(data.types)) {
      if (typeof def?.symbol !== 'string') return null;
    }
    return {
      types: data.types,
      updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : '',
    };
  } catch {
    return null;
  }
}

/** Атомарная запись каталога (tmp + rename — паттерн writeMeta). */
export async function writeCatalogFile(workspaceDir: string, catalog: TypesCatalog): Promise<void> {
  const finalPath = catalogPath(workspaceDir);
  const tmpPath = `${finalPath}.tmp`;
  await fsp.writeFile(tmpPath, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
  await fsp.rename(tmpPath, finalPath);
}

/**
 * Seed: пройтись по ВСЕМ проектам workspace (spec.yaml каждого; битые YAML и
 * нечитаемые файлы игнорируются), объединить типы в каталог, записать файл.
 * Порядок обхода — сортировка имён каталогов (детерминированность «первое
 * зарегистрированное» при конфликтах между проектами).
 */
export async function seedCatalogFromProjects(workspaceDir: string, now: Clock): Promise<TypesCatalog> {
  let slugs: string[] = [];
  try {
    const entries = await fsp.readdir(workspaceDir, { withFileTypes: true });
    // Только каталоги (файл-каталог и прочий мусор в корне не участвуют).
    slugs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort((a, b) => a.localeCompare(b));
  } catch {
    slugs = []; // workspace пуст/недоступен → пустой каталог
  }
  let catalog: TypesCatalog = { types: {}, updatedAt: now().toISOString() };
  for (const slug of slugs) {
    let specText: string;
    try {
      specText = await fsp.readFile(path.join(workspaceDir, slug, 'spec.yaml'), 'utf8');
    } catch {
      continue; // проекта/spec.yaml нет — игнор
    }
    const { catalog: next } = mergeCatalog(catalog, parseTypesLenient(specText), now().toISOString());
    catalog = next;
  }
  await writeCatalogFile(workspaceDir, catalog);
  return catalog;
}

/**
 * Чтение каталога с seed-фолбэком: файла нет (или битый) → пересеять по всем
 * проектам workspace. Битый файл пересеваем — состояние восстанавливается
 * детерминированно из spec.yaml проектов.
 */
export async function ensureTypesCatalog(workspaceDir: string, now: Clock): Promise<TypesCatalog> {
  const existing = await readCatalogFile(workspaceDir);
  if (existing !== null) return existing;
  return seedCatalogFromProjects(workspaceDir, now);
}

/**
 * Авто-регистрация типов сохранённого/импортированного spec.yaml в каталоге:
 * разбор lenient → слияние (политика mergeCatalog) → запись при изменениях.
 * Без файла каталога — сначала seed по проектам (сохраняемый проект уже на диске).
 */
export async function registerSpecIntoCatalog(
  workspaceDir: string,
  specText: string | null,
  now: Clock,
): Promise<void> {
  if (specText === null) return;
  const incoming = parseTypesLenient(specText);
  if (Object.keys(incoming).length === 0) return;
  let catalog = await readCatalogFile(workspaceDir);
  if (catalog === null) catalog = await seedCatalogFromProjects(workspaceDir, now);
  const { catalog: merged, changed } = mergeCatalog(catalog, incoming, now().toISOString());
  if (changed) await writeCatalogFile(workspaceDir, merged);
}
