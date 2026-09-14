// Общий (глобальный) каталог типов: <workspaceDir>/types-catalog.json (ST-1).
// Единый список типов на все проекты: редактор показывает его чекбоксами и
// добавляет выбранные в spec.types проекта. Файл лежит ВКОРЕ workspace — рядом
// с каталогами проектов; listProjects перечисляет только directories, поэтому
// файл-каталог его не ломает.
// Чистые функции (parseTypesLenient/mergeCatalog) + DI для тестов: workspaceDir, now.
import fsp from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';

import { ApiError } from './errors.js';
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

/** Максимальная длина имени типа (ST-3). */
export const MAX_TYPE_NAME_LEN = 64;

/**
 * Чистое обновление записи каталога (ST-3): PATCH { symbol?, name? }, минимум
 * одно поле. Правила symbol совпадают с editor/src/lib/fileUtils.ts#symbolError:
 * ОДИН символ, не «.» и не «*»; name ≤ MAX_TYPE_NAME_LEN (null — без имени,
 * отсутствие поля — имя сохраняется). Уникальность symbol: занят ДРУГИМ id →
 * 422 с id владельца; id не существует → 404. Политика updatedAt как у
 * mergeCatalog: свежий ТОЛЬКО при фактическом изменении значения (повтор с теми же значениями
 * — changed=false, файл не трогаем).
 */
export function applyCatalogUpdate(
  catalog: TypesCatalog,
  id: string,
  patch: { symbol?: unknown; name?: unknown },
  nowIso: string,
): { catalog: TypesCatalog; changed: boolean } {
  const hasSymbol = Object.prototype.hasOwnProperty.call(patch, 'symbol');
  const hasName = Object.prototype.hasOwnProperty.call(patch, 'name');
  if (!hasSymbol && !hasName) {
    throw ApiError.invalidName('Укажите минимум одно поле для обновления: "symbol" и/или "name"');
  }
  const symbol = hasSymbol ? patch.symbol : undefined;
  if (symbol !== undefined && typeof symbol !== 'string') {
    throw ApiError.invalidName('Поле "symbol" должно быть строкой из одного символа');
  }
  const name = hasName ? patch.name : undefined;
  if (name !== undefined && name !== null && typeof name !== 'string') {
    throw ApiError.invalidName(`Поле "name" — строка (не длиннее ${MAX_TYPE_NAME_LEN}) или null (без имени)`);
  }
  if (typeof symbol === 'string') {
    if (symbol.length !== 1) {
      throw ApiError.invalidName(`Символ типа — ОДИН символ (получено: «${symbol}»)`);
    }
    if (symbol === '.' || symbol === '*') {
      throw ApiError.invalidName(`Символ «${symbol}» зарезервирован и не может быть символом типа`);
    }
  }
  if (typeof name === 'string' && name.length > MAX_TYPE_NAME_LEN) {
    throw ApiError.invalidName(`Имя типа длиннее ${MAX_TYPE_NAME_LEN} символов`);
  }

  const cur = catalog.types[id];
  if (cur === undefined) throw ApiError.typeNotFound(id);

  // Уникальность symbol в каталоге: занят другим id → 422 с id владельца.
  if (typeof symbol === 'string' && symbol !== cur.symbol) {
    const owner = Object.entries(catalog.types).find(([otherId, def]) => otherId !== id && def.symbol === symbol)?.[0];
    if (owner !== undefined) {
      throw ApiError.unprocessable(`Символ «${symbol}» уже занят типом «${owner}» в общем каталоге`);
    }
  }

  const nextDef: CatalogTypeDef = {
    symbol: typeof symbol === 'string' ? symbol : cur.symbol,
    name: hasName ? (name as string | null) : cur.name,
  };
  const changed = nextDef.symbol !== cur.symbol || nextDef.name !== cur.name;
  if (!changed) return { catalog, changed: false };
  return {
    catalog: { types: { ...catalog.types, [id]: nextDef }, updatedAt: nowIso },
    changed: true,
  };
}

/**
 * Чистое удаление записи из каталога (ST-3). id не существует → 404.
 * УДАЛЯЕТСЯ ТОЛЬКО запись глобального каталога — spec.yaml проектов НЕ
 * трогаются: проект с этим типом сохранит своё локальное определение, и при
 * следующем seed/merge из проектов тип может ВОЗРОСИТЬСЯ, если он ещё есть в
 * каком-то spec.yaml (корректное поведение, не баг).
 */
export function applyCatalogRemove(
  catalog: TypesCatalog,
  id: string,
  nowIso: string,
): { catalog: TypesCatalog; changed: boolean } {
  if (!(id in catalog.types)) throw ApiError.typeNotFound(id);
  const types = { ...catalog.types };
  delete types[id];
  return { catalog: { types, updatedAt: nowIso }, changed: true };
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
 * PATCH (ST-3): обновление записи каталога. Файла нет → сначала seed по
 * проектам (как GET), затем applyCatalogUpdate; файл перезаписывается только
 * при фактическом изменении (no-op — без записи). Изменяется ТОЛЬКО глобальный
 * каталог, spec.yaml проектов не трогаются.
 */
export async function patchCatalogType(
  workspaceDir: string,
  id: string,
  patch: { symbol?: unknown; name?: unknown },
  now: Clock,
): Promise<TypesCatalog> {
  const current = await ensureTypesCatalog(workspaceDir, now);
  const { catalog, changed } = applyCatalogUpdate(current, id, patch, now().toISOString());
  if (changed) await writeCatalogFile(workspaceDir, catalog);
  return catalog;
}

/**
 * DELETE (ST-3): удаление записи из каталога. СМ applyCatalogRemove: проекты
 * не трогаются, тип может возродиться при следующем seed/merge.
 */
export async function removeCatalogType(
  workspaceDir: string,
  id: string,
  now: Clock,
): Promise<TypesCatalog> {
  const current = await ensureTypesCatalog(workspaceDir, now);
  const { catalog } = applyCatalogRemove(current, id, now().toISOString());
  await writeCatalogFile(workspaceDir, catalog);
  return catalog;
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
