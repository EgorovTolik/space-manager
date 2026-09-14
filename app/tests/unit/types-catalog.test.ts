// Unit-тесты ST-1: общий каталог типов (typesCatalog.ts) и усечение raw журнала.
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ApiError } from '../../server/errors.js';
import {
  applyCatalogRemove,
  applyCatalogUpdate,
  MAX_TYPE_NAME_LEN,
  mergeCatalog,
  parseTypesLenient,
  seedCatalogFromProjects,
  type TypesCatalog,
} from '../../server/typesCatalog.js';
import { RAW_MAX_LEN, truncateRaw } from '../../server/llm/journal.js';
import type { Clock } from '../../server/workspace.js';

let tmp: string;
const nowIso = '2026-09-15T10:00:00.000Z';
const fixedNow: Clock = () => new Date(nowIso);

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'types-catalog-test-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const catalog = (types: TypesCatalog['types']): TypesCatalog => ({ types, updatedAt: 'old' });

describe('mergeCatalog — чистая политика слияния (ST-1)', () => {
  it('новый id → добавляется; updatedAt обновляется', () => {
    const base = catalog({ A: { symbol: 'A', name: 'тип А' } });
    const { catalog: merged, changed } = mergeCatalog(base, { B: { symbol: 'B', name: null } }, nowIso);
    expect(changed).toBe(true);
    expect(merged.types).toEqual({ A: { symbol: 'A', name: 'тип А' }, B: { symbol: 'B', name: null } });
    expect(merged.updatedAt).toBe(nowIso);
    // Исходный каталог не мутируется.
    expect(base.types).toEqual({ A: { symbol: 'A', name: 'тип А' } });
  });

  it('дубль с идентичным определением → без изменений, updatedAt НЕ обновляется', () => {
    const base = catalog({ A: { symbol: 'A', name: 'тип А' } });
    const { catalog: merged, changed } = mergeCatalog(base, { A: { symbol: 'A', name: 'тип А' } }, nowIso);
    expect(changed).toBe(false);
    expect(merged.updatedAt).toBe('old');
  });

  it('конфликт (различный symbol) → сохраняется ПЕРВОЕ зарегистрированное определение', () => {
    const base = catalog({ A: { symbol: 'A', name: 'тип А' } });
    const { catalog: merged, changed } = mergeCatalog(base, { A: { symbol: 'Q', name: 'вредитель' } }, nowIso);
    expect(changed).toBe(false);
    expect(merged.types.A).toEqual({ symbol: 'A', name: 'тип А' });
    expect(merged.updatedAt).toBe('old');
  });

  it('конфликт только по name → тоже первое определение; новый id в том же мерже добавляется', () => {
    const base = catalog({ A: { symbol: 'A', name: null } });
    const { catalog: merged, changed } = mergeCatalog(
      base,
      { A: { symbol: 'A', name: 'другое имя' }, C: { symbol: 'C', name: 'новый' } },
      nowIso,
    );
    expect(changed).toBe(true); // добавился C
    expect(merged.types.A).toEqual({ symbol: 'A', name: null }); // A — первое
    expect(merged.types.C).toEqual({ symbol: 'C', name: 'новый' });
  });
});

describe('parseTypesLenient — lenient-разбор spec.yaml (ST-1)', () => {
  it('корректный блок types → типы; отсутствие name → null', () => {
    const text = [
      'grid:',
      '  width: 7',
      'types:',
      '  A: { symbol: "A", name: Тип А }',
      '  B: { symbol: "B" }',
    ].join('\n');
    expect(parseTypesLenient(text)).toEqual({
      A: { symbol: 'A', name: 'Тип А' },
      B: { symbol: 'B', name: null },
    });
  });

  it('битый YAML → пусто (проект игнорируется, без исключений)', () => {
    expect(parseTypesLenient('grid:\n  width: [недокрыт')).toEqual({});
    expect(parseTypesLenient('{{{{')).toEqual({});
  });

  it('отсутствующий/необъектный блок types → пусто; невалидные записи пропускаются', () => {
    expect(parseTypesLenient('grid:\n  width: 7\n')).toEqual({});
    expect(parseTypesLenient('types:\n  - A\n')).toEqual({});
    const text = [
      'types:',
      '  BAD1: { symbol: "XX", name: два символа }', // symbol — не один символ
      '  BAD2: "не объект"',
      '  OK: { symbol: "K", name: ок }',
    ].join('\n');
    expect(parseTypesLenient(text)).toEqual({ OK: { symbol: 'K', name: 'ок' } });
  });
});

describe('seedCatalogFromProjects — seed по workspace (ST-1)', () => {
  const writeProject = async (slug: string, specText?: string): Promise<void> => {
    const dir = path.join(tmp, slug);
    await fsp.mkdir(dir, { recursive: true });
    if (specText !== undefined) await fsp.writeFile(path.join(dir, 'spec.yaml'), specText, 'utf8');
  };

  it('объединяет типы всех проектов; битый YAML и каталог без spec — игнор; файл пишется', async () => {
    await writeProject('p1', 'types:\n  A: { symbol: "A", name: А }\n');
    await writeProject('p2', '{{битый yaml'); // игнор
    await writeProject('p3'); // нет spec.yaml — игнор
    await fsp.writeFile(path.join(tmp, 'loose.txt'), 'файл в корне — не проект\n');

    const catalog = await seedCatalogFromProjects(tmp, fixedNow);
    expect(catalog.types).toEqual({ A: { symbol: 'A', name: 'А' } });
    expect(catalog.updatedAt).toBe(nowIso);

    // Файл каталога создан на диске в ожидаемом формате.
    const onDisk = JSON.parse(await fsp.readFile(path.join(tmp, 'types-catalog.json'), 'utf8'));
    expect(onDisk).toEqual({ types: { A: { symbol: 'A', name: 'А' } }, updatedAt: nowIso });
  });

  it('конфликт между проектами → детерминированно первый по сортировке имён каталогов', async () => {
    await writeProject('aa', 'types:\n  X: { symbol: "1", name: из aa }\n');
    await writeProject('bb', 'types:\n  X: { symbol: "2", name: из bb }\n');
    const catalog = await seedCatalogFromProjects(tmp, fixedNow);
    expect(catalog.types.X).toEqual({ symbol: '1', name: 'из aa' });
  });

  it('пустой workspace → пустой каталог, файл всё равно пишется', async () => {
    const catalog = await seedCatalogFromProjects(tmp, fixedNow);
    expect(catalog.types).toEqual({});
    await expect(fsp.access(path.join(tmp, 'types-catalog.json'))).resolves.toBeUndefined();
  });
});

/** Захват исключения: ожидаем ApiError со статусом; возвращаем message. */
function expectApiError(fn: () => unknown, status: number): string {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    const e = err as ApiError;
    expect(e.status).toBe(status);
    return e.message;
  }
  throw new Error(`ожидалось ApiError(${status}), исключение не брошено`);
}

describe('applyCatalogUpdate — чистое обновление записи (ST-3)', () => {
  const base = (): TypesCatalog =>
    catalog({ A: { symbol: 'A', name: 'тип А' }, B: { symbol: 'B', name: null } });

  it('смена symbol и name → запись обновлена, updatedAt свежий, исходник не мутируется', () => {
    const { catalog: next, changed } = applyCatalogUpdate(base(), 'A', { symbol: 'Q', name: 'новый' }, nowIso);
    expect(changed).toBe(true);
    expect(next.types.A).toEqual({ symbol: 'Q', name: 'новый' });
    expect(next.types.B).toEqual({ symbol: 'B', name: null }); // остальные записи не тронуты
    expect(next.updatedAt).toBe(nowIso);
  });

  it('повтор с теми же значениями → changed=false, updatedAt НЕ меняется', () => {
    const { catalog: next, changed } = applyCatalogUpdate(base(), 'A', { symbol: 'A', name: 'тип А' }, nowIso);
    expect(changed).toBe(false);
    expect(next.updatedAt).toBe('old');
  });

  it('name: null → имя сброшено; отсутствие name в патче → имя сохраняется', () => {
    const cleared = applyCatalogUpdate(base(), 'A', { name: null }, nowIso);
    expect(cleared.changed).toBe(true);
    expect(cleared.catalog.types.A).toEqual({ symbol: 'A', name: null });

    const kept = applyCatalogUpdate(base(), 'B', { symbol: 'K' }, nowIso);
    expect(kept.catalog.types.B).toEqual({ symbol: 'K', name: null }); // null остался как был
  });

  it('symbol уже занят ДРУГИМ id → 422 с id владельца в сообщении; собственный symbol — не конфликт', () => {
    const msg = expectApiError(() => applyCatalogUpdate(base(), 'A', { symbol: 'B' }, nowIso), 422);
    expect(msg).toContain('типом «B»'); // B — id-владелец символа «B»
    // Свой собственный символ не считается дубликатом.
    const ok = applyCatalogUpdate(base(), 'A', { symbol: 'A', name: 'x' }, nowIso);
    expect(ok.changed).toBe(true);
  });

  it('битый symbol: «.», «*», два символа, пусто → 400; имя > 64 → 400; ровно 64 → ок', () => {
    for (const bad of ['.', '*', 'AB', '']) {
      const msg = expectApiError(() => applyCatalogUpdate(base(), 'A', { symbol: bad }, nowIso), 400);
      expect(msg).toBeTruthy();
    }
    expectApiError(
      () => applyCatalogUpdate(base(), 'A', { name: 'x'.repeat(MAX_TYPE_NAME_LEN + 1) }, nowIso),
      400,
    );
    const ok = applyCatalogUpdate(base(), 'A', { name: 'x'.repeat(MAX_TYPE_NAME_LEN) }, nowIso);
    expect(ok.changed).toBe(true);
  });

  it('пустой патч {} → 400; не-строковый symbol/name → 400; несуществующий id → 404', () => {
    expect(expectApiError(() => applyCatalogUpdate(base(), 'A', {}, nowIso), 400)).toContain('минимум одно поле');
    expectApiError(() => applyCatalogUpdate(base(), 'A', { symbol: 5 }, nowIso), 400);
    expectApiError(() => applyCatalogUpdate(base(), 'A', { name: ['нет'] }, nowIso), 400);
    const msg404 = expectApiError(() => applyCatalogUpdate(base(), 'NOPE', { symbol: 'K' }, nowIso), 404);
    expect(msg404).toContain('NOPE');
  });
});

describe('applyCatalogRemove — чистое удаление записи (ST-3)', () => {
  it('существующий id → запись удалена, updatedAt свежий; остальные записи на месте', () => {
    const { catalog: next, changed } = applyCatalogRemove(
      catalog({ A: { symbol: 'A', name: null }, B: { symbol: 'B', name: 'б' } }),
      'A',
      nowIso,
    );
    expect(changed).toBe(true);
    expect(next.types).toEqual({ B: { symbol: 'B', name: 'б' } });
    expect(next.updatedAt).toBe(nowIso);
  });

  it('несуществующий id → 404 с id в сообщении', () => {
    const msg = expectApiError(
      () => applyCatalogRemove(catalog({ A: { symbol: 'A', name: null } }), 'NOPE', nowIso),
      404,
    );
    expect(msg).toContain('NOPE');
  });
});

describe('truncateRaw — усечение дословных ответов LLM (ST-1)', () => {
  it('ответ короче/ровно RAW_MAX_LEN → без изменений', () => {
    expect(truncateRaw('')).toBe('');
    const short = '{"action":"finish","args":{}}';
    expect(truncateRaw(short)).toBe(short);
    const exact = 'x'.repeat(RAW_MAX_LEN);
    expect(truncateRaw(exact)).toBe(exact);
  });

  it('ответ длиннее RAW_MAX_LEN → префикс + «…(N символов)» (N — полная длина)', () => {
    const long = 'a'.repeat(8500);
    const out = truncateRaw(long);
    expect(out).toBe(`${'a'.repeat(RAW_MAX_LEN)}…(8500 символов)`);
    expect(out.length).toBeLessThan(long.length);
  });
});
