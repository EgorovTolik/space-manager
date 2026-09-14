// Unit-тесты ST-1: общий каталог типов (typesCatalog.ts) и усечение raw журнала.
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
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
