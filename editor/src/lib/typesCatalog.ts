// Общий список типов (ST-2): глобальный каталог `GET /api/types-catalog` + чистые
// guard-функции «можно ли отметить/снять» и маппинг каталога → строки чекбоксов.
//
// Правила блокировок:
// - снятие отметки запрещено, если тип привязан хотя бы к одному кластеру
//   (spec.clusters.some(c => c.type === id)) — иначе сломались бы V-CLUST-TYPE;
// - отметка запрещена, если symbol типа из каталога уже занят ДРУГИМ типом проекта
//   (иначе нарушится V-TYPE-SYMDUP).
// Типы проекта, отсутствующие в каталоге (ещё ни разу не сохранены), отображаются
// строками «вне общего списка» внизу секции — список = каталог + дополнения проекта.
import { deleteTypesCatalog, fetchTypesCatalog, patchTypesCatalog } from './api';
import type { TypesCatalog } from './api';
import type { SpecDoc } from './types';

export type CatalogTypes = TypesCatalog['types'];

// ── Сессионный кэш (на время сессии страницы) + подписка на обновление ──────────

let cache: CatalogTypes | null = null;
let inflight: Promise<CatalogTypes> | null = null;
const listeners = new Set<(types: CatalogTypes) => void>();

/** Подписка на обновления каталога (первый fetch и refresh); возвращает отписку. */
export function subscribeTypesCatalog(fn: (types: CatalogTypes) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

async function load(force: boolean): Promise<CatalogTypes> {
  if (!force && cache !== null) return cache;
  if (inflight !== null) return inflight;
  inflight = fetchTypesCatalog()
    .then((r) => {
      cache = r.types;
      for (const l of listeners) l(r.types);
      return r.types;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Каталог с кэшированием на время сессии страницы. */
export function getTypesCatalog(): Promise<CatalogTypes> {
  return load(false);
}

/** Повторный fetch после сохранения/импорта (новые типы проекта должны сразу
 * увидаться как отмеченные). Вызывается FilesPanel после успешного PUT …/files. */
export function refreshTypesCatalog(): void {
  cache = null;
  // Сбой повторного fetch не критичен (пока живёт старый кэш UI) — без unhandled rejection.
  void load(true).catch(() => {});
}

// ── Изменения каталога (ST-4): PATCH/DELETE + обновление сессионного кэша ──────
// Сервер возвращает обновлённый каталог ЦЕЛИКОМ — просто подменяем кэш и
// уведомляем подписчиков (тот же механизм, что при fetch). Семантика: правится
// только глобальный каталог, спеки проектов не меняются.

function applyCatalogResponse(types: CatalogTypes): void {
  cache = types;
  for (const l of listeners) l(types);
}

/** `PATCH /api/types-catalog/:id` {symbol?, name?} → обновлённый каталог. */
export async function patchCatalog(
  id: string,
  patch: { symbol?: string; name?: string | null },
): Promise<CatalogTypes> {
  const r = await patchTypesCatalog(id, patch);
  applyCatalogResponse(r.types);
  return r.types;
}

/** `DELETE /api/types-catalog/:id` → обновлённый каталог (строка исчезает из секции). */
export async function deleteCatalog(id: string): Promise<CatalogTypes> {
  const r = await deleteTypesCatalog(id);
  applyCatalogResponse(r.types);
  return r.types;
}

/** Тело PATCH /api/types-catalog/:id из полей инлайн-формы (чистый маппинг):
 * symbol как введён, name — обрезанный; пустое name → null (сервер очищает name). */
export function catalogPatchBody(
  symbol: string,
  name: string,
): { symbol: string; name: string | null } {
  const t = name.trim();
  return { symbol, name: t === '' ? null : t };
}

// ── Чистые guard-функции (unit-тестируемые, без React и fetch) ─────────────────

/** Id кластеров проекта, использующих тип. */
export function clusterIdsOfType(spec: SpecDoc, typeId: string): string[] {
  return spec.clusters.filter((c) => c.type === typeId).map((c) => c.id);
}

/** Id типа проекта с данным symbol (исключая `excludeId`); null — символ свободен. */
export function findSymbolOwner(
  types: SpecDoc['types'],
  symbol: string,
  excludeId?: string,
): string | null {
  for (const id of Object.keys(types)) {
    if (id !== excludeId && types[id].symbol === symbol) return id;
  }
  return null;
}

/** Решение по клику на чекбокс типа `id` секции «Общий список типов». */
export type CatalogToggleDecision =
  | { kind: 'add'; def: { symbol: string; name: string | null } } // можно отметить
  | { kind: 'remove' } // можно снять (тип уже в проекте)
  | { kind: 'blocked-clusters'; clusterIds: string[] } // снятие заблокировано кластерами
  | { kind: 'symbol-dup'; symbol: string; owner: string }; // отметка запрещена: символ занят

/** id обязан быть в каталоге или в spec.types (строки «вне списка» — в spec.types). */
export function catalogToggleDecision(catalog: CatalogTypes, spec: SpecDoc, id: string): CatalogToggleDecision {
  if (spec.types[id] !== undefined) {
    const clusterIds = clusterIdsOfType(spec, id);
    return clusterIds.length > 0 ? { kind: 'blocked-clusters', clusterIds } : { kind: 'remove' };
  }
  const def = catalog[id];
  if (def === undefined) return { kind: 'remove' }; // недостижимо из UI; дефолт — без последствий
  const owner = findSymbolOwner(spec.types, def.symbol);
  return owner !== null ? { kind: 'symbol-dup', symbol: def.symbol, owner } : { kind: 'add', def };
}

/** Строка секции «Общий список типов» в UI. */
export interface CatalogRow {
  id: string;
  symbol: string;
  name: string | null;
  /** Тип есть только в спеке проекта, каталога о нём ещё нет (ни разу не сохранялся). */
  outsideCatalog: boolean;
  checked: boolean; // отмечен ⇔ тип уже в spec.types
  disabled: boolean; // чекбокс недоступен (только причина symbol-dup)
  /** Причина блокировки отметки: символ занят другим типом проекта. */
  disableReason: { symbol: string; owner: string } | null;
}

/** Маппинг каталог + spec.types → строки чекбоксов.
 * Порядок: каталог (как пришёл с сервера), затем типы проекта вне каталога. */
export function catalogRows(catalog: CatalogTypes, spec: SpecDoc): CatalogRow[] {
  const rows: CatalogRow[] = Object.entries(catalog).map(([id, def]) => {
    const inProject = spec.types[id] !== undefined;
    if (inProject) {
      return { id, symbol: def.symbol, name: def.name, outsideCatalog: false, checked: true, disabled: false, disableReason: null };
    }
    const owner = findSymbolOwner(spec.types, def.symbol);
    return {
      id,
      symbol: def.symbol,
      name: def.name,
      outsideCatalog: false,
      checked: false,
      disabled: owner !== null,
      disableReason: owner !== null ? { symbol: def.symbol, owner } : null,
    };
  });
  // Типы проекта, которых нет в каталоге — «вне общего списка» (внизу, по порядку спеки).
  for (const id of Object.keys(spec.types)) {
    if (catalog[id] === undefined) {
      const def = spec.types[id];
      rows.push({ id, symbol: def.symbol, name: def.name, outsideCatalog: true, checked: true, disabled: false, disableReason: null });
    }
  }
  return rows;
}
