// ST-2: чистые guard-функции общего списка типов (lib/typesCatalog).
// Привязан к кластеру → снятие блока; дубль symbol → отметка блока; свободный тип → ок.
import { describe, expect, it } from 'vitest';
import type { SpecDoc } from '../../src/lib/types';
import {
  catalogRows,
  catalogToggleDecision,
  clusterIdsOfType,
  findSymbolOwner,
} from '../../src/lib/typesCatalog';

const SPEC: SpecDoc = {
  grid: { width: 10, height: 10 },
  blockedFile: null,
  presetFile: null,
  types: {
    A: { symbol: 'A', name: 'Тип A' },
    D: { symbol: 'D', name: null },
  },
  rules: {
    connectivity: 8,
    adjacency: { forbidden: [], allow: null },
    size: { min: null, max: null },
    convexity: { weight: 'soft' },
    fillAll: false,
    touchAll: false,
  },
  clusters: [{ id: 'a1', type: 'A', areaPercent: 40, shape: 'free' }],
};

// Каталог {A, B, C}: у C символ «D» — уже занят типом D проекта.
const CATALOG = {
  A: { symbol: 'A', name: 'Тип A (каталог)' },
  B: { symbol: 'B', name: 'Тип B' },
  C: { symbol: 'D', name: 'Тип C' },
};

describe('clusterIdsOfType / findSymbolOwner', () => {
  it('собирает id кластеров типа и находит владельца символа', () => {
    expect(clusterIdsOfType(SPEC, 'A')).toEqual(['a1']);
    expect(clusterIdsOfType(SPEC, 'D')).toEqual([]);
    expect(findSymbolOwner(SPEC.types, 'D')).toBe('D');
    expect(findSymbolOwner(SPEC.types, 'Z')).toBeNull();
    // excludeId — сам тип не считается владельцем своего символа.
    expect(findSymbolOwner(SPEC.types, 'A', 'A')).toBeNull();
  });
});

describe('catalogToggleDecision', () => {
  it('тип привязан к кластеру → снятие заблокировано (blocked-clusters)', () => {
    const d = catalogToggleDecision(CATALOG, SPEC, 'A');
    expect(d).toEqual({ kind: 'blocked-clusters', clusterIds: ['a1'] });
  });

  it('несколько кластеров одного типа — все перечислены', () => {
    const spec2: SpecDoc = {
      ...SPEC,
      clusters: [
        SPEC.clusters[0],
        { id: 'a2', type: 'A', areaPercent: 10, shape: 'free' },
      ],
    };
    expect(catalogToggleDecision(CATALOG, spec2, 'A')).toEqual({
      kind: 'blocked-clusters',
      clusterIds: ['a1', 'a2'],
    });
  });

  it('отмеченный свободный тип (без кластеров) → можно снять (remove)', () => {
    expect(catalogToggleDecision(CATALOG, SPEC, 'D')).toEqual({ kind: 'remove' });
  });

  it('свободный тип из каталога → можно отметить (add с определением)', () => {
    expect(catalogToggleDecision(CATALOG, SPEC, 'B')).toEqual({
      kind: 'add',
      def: { symbol: 'B', name: 'Тип B' },
    });
  });

  it('символ занят другим типом проекта → отметка запрещена (symbol-dup)', () => {
    expect(catalogToggleDecision(CATALOG, SPEC, 'C')).toEqual({
      kind: 'symbol-dup',
      symbol: 'D',
      owner: 'D',
    });
  });

  it('символ «занят» самим типом (id уже в проекте) → не дубль', () => {
    // A уже в spec.types — решение по ветке «отмечен», символ A его собственный.
    const d = catalogToggleDecision(CATALOG, SPEC, 'A');
    expect(d.kind).toBe('blocked-clusters');
  });
});

describe('catalogRows (маппинг каталог + spec.types → чекбоксы)', () => {
  it('отмечены типы проекта; дубль symbol — disabled с причиной', () => {
    const rows = catalogRows(CATALOG, SPEC);
    // Каталог {A,B,C} + D из проекта (вне каталога) — дописан в конец.
    expect(rows.map((r) => r.id)).toEqual(['A', 'B', 'C', 'D']);

    const a = rows[0];
    expect(a.checked).toBe(true);
    expect(a.disabled).toBe(false);
    expect(a.outsideCatalog).toBe(false);

    expect(rows[1].checked).toBe(false); // B — не в проекте, доступен
    expect(rows[1].disabled).toBe(false);

    const c = rows[2];
    expect(c.checked).toBe(false);
    expect(c.disabled).toBe(true);
    expect(c.disableReason).toEqual({ symbol: 'D', owner: 'D' });
  });

  it('типы проекта вне каталога — строки «вне общего списка» внизу, отмеченные', () => {
    const rows = catalogRows(CATALOG, SPEC);
    // D нет в каталоге → дописан после строк каталога.
    expect(rows.map((r) => r.id)).toEqual(['A', 'B', 'C', 'D']);
    const d = rows[3];
    expect(d.outsideCatalog).toBe(true);
    expect(d.checked).toBe(true);
    expect(d.disabled).toBe(false);
    expect(d.symbol).toBe('D');
  });

  it('пустой каталог — только типы проекта, все «вне списка»', () => {
    const rows = catalogRows({}, SPEC);
    expect(rows.map((r) => r.id)).toEqual(['A', 'D']);
    expect(rows.every((r) => r.outsideCatalog && r.checked)).toBe(true);
  });
});
