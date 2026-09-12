// Unit-тесты lib/specYaml.ts (подзадача 12).
// Критерии: round-trip данных по эталонам examples; канонический dump —
// побайтово по эталону ТЗ 02 §4; дефолты docs/03; неизвестные поля; негативы.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dumpSpec, parseSpec, parseSpecWithWarnings, SpecParseError } from '../../src/lib/specYaml';
import type { SpecDoc } from '../../src/lib/types';

const EXAMPLES = new URL('../../../examples/', import.meta.url);
function readExample(name: string): string {
  return readFileSync(fileURLToPath(new URL(name, EXAMPLES)), 'utf-8');
}

/** basename без './' — единственное осознанное преобразование dump (ТЗ 02 §4 «нюансы»). */
function normalizeDoc(doc: SpecDoc): SpecDoc {
  const base = (s: string | null) => (s === null ? null : s.split('/').pop() ?? s);
  return { ...doc, blockedFile: base(doc.blockedFile), presetFile: base(doc.presetFile) };
}

/** Эквивалентность по данным с нормализацией basename + идемпотентность dump. */
function expectDataRoundTrip(yamlText: string): void {
  const once = parseSpec(yamlText);
  const dumped = dumpSpec(once);
  const twice = parseSpec(dumped);
  // dump идемпотентен: вторая сериализация побайтово та же
  expect(dumpSpec(twice)).toBe(dumped);
  // данные эквивалентны (с учётом нормализации blockedFile/presetFile к basename)
  expect(normalizeDoc(twice)).toEqual(normalizeDoc(once));
}

describe('specYaml: round-trip эталонов examples', () => {
  it('spec_basic.yaml: эквивалентность по данным после dump/parse', () => {
    expectDataRoundTrip(readExample('spec_basic.yaml'));
  });

  it('spec_touchall.yaml: эквивалентность по данным после dump/parse', () => {
    expectDataRoundTrip(readExample('spec_touchall.yaml'));
  });

  it('spec_touchall.yaml: dump побайтово совпадает с эталоном ТЗ 02 §4', () => {
    const expected = [
      'grid:',
      '  width: 12',
      '  height: 8',
      'blockedFile: blocked_touchall.txt',   // basename без './' (нюанс ТЗ 02 §4)
      'presetFile: null',
      'types:',
      '  ROOM: { symbol: "R", name: Комната }',
      '  CORRIDOR: { symbol: "C", name: Коридор }',
      '  GARDEN: { symbol: "G", name: Сад }',
      'rules:',
      '  connectivity: 8',
      '  adjacency:',
      '    forbidden: []',
      '    allow: null',
      '  size:',
      '    min: null',
      '    max: null',
      '  convexity:',
      '    weight: soft',
      '  fillAll: false',
      '  touchAll: true',
      'clusters:',
      '  - id: room1',
      '    type: ROOM',
      '    areaPercent: 40',
      '    shape: free',
      '  - id: corridor1',
      '    type: CORRIDOR',
      '    areaPercent: 35',
      '    shape: free',
      '  - id: garden1',
      '    type: GARDEN',
      '    areaPercent: 25',
      '    shape: free',
      '',   // завершающий перевод строки
    ].join('\n');
    expect(dumpSpec(parseSpec(readExample('spec_touchall.yaml')))).toBe(expected);
  });

  it('spec_basic.yaml: после dump имя blockedFile приводится к basename', () => {
    const doc = parseSpec(readExample('spec_basic.yaml'));
    expect(doc.blockedFile).toBeNull(); // в эталоне blockedFile: null
    doc.blockedFile = './blocked_basic.txt';
    const dumped = dumpSpec(doc);
    expect(dumped).toContain('blockedFile: blocked_basic.txt');
    expect(dumped).not.toContain('./blocked_basic.txt');
  });
});

describe('specYaml: дефолты при парсинге (docs/03)', () => {
  const minimal = [
    'grid:',
    '  width: 5',
    '  height: 6',
    'types:',
    '  A: { symbol: "A" }',
    '',
  ].join('\n');

  it('отсутствующие поля rules получают дефолты', () => {
    const doc = parseSpec(minimal);
    expect(doc.rules).toEqual({
      connectivity: 8,
      adjacency: { forbidden: [], allow: null },
      size: { min: null, max: null },
      convexity: { weight: 'soft' },
      fillAll: false,
      touchAll: false,
    });
  });

  it('TypeDef.name без поля → null; clusters без списка → []', () => {
    const doc = parseSpec(minimal);
    expect(doc.types.A).toEqual({ symbol: 'A', name: null });
    expect(doc.clusters).toEqual([]);
  });

  it('shape без поля → free; areaPercent дробный сохраняется как есть', () => {
    const doc = parseSpec(
      [
        'grid: { width: 3, height: 3 }',
        'types: { A: { symbol: "A" } }',
        'clusters:',
        '  - id: c1',
        '    type: A',
        '    areaPercent: 12.5',
        '',
      ].join('\n'),
    );
    expect(doc.clusters[0].shape).toBe('free');
    expect(doc.clusters[0].areaPercent).toBe(12.5);
    // дробное — в десятичной записи, целое — без .0
    const dumped = dumpSpec(doc);
    expect(dumped).toContain('areaPercent: 12.5');
  });

  it('дефолты прописываются явно при dump (ТЗ 02 §4 п.4)', () => {
    const dumped = dumpSpec(parseSpec(minimal));
    for (const line of ['allow: null', 'min: null', 'max: null', 'weight: soft', 'fillAll: false', 'touchAll: false']) {
      expect(dumped).toContain(line);
    }
  });
});

describe('specYaml: неизвестные поля (ТЗ 02 §4 п.5)', () => {
  it('отбрасываются из модели и перечисляются в unknownFields', () => {
    const { doc, unknownFields } = parseSpecWithWarnings(
      [
        'grid: { width: 3, height: 3 }',
        'types: { A: { symbol: "A", extra: 1 } }',
        'rules:',
        '  connectivity: 8',
        '  newFeature: true',
        'clusters:',
        '  - id: c1',
        '    type: A',
        '    areaPercent: 50',
        '    shape: free',
        '    note: "чужое"',
        '',
      ].join('\n'),
    );
    expect(unknownFields).toContain('rules.newFeature');
    expect(unknownFields).toContain('types.A.extra');
    expect(unknownFields).toContain('clusters[0].note');
    // в модели чужих полей нет
    expect(JSON.stringify(doc)).not.toContain('newFeature');
    expect(JSON.stringify(doc)).not.toContain('extra');
  });

  it('parseSpec (без предупреждений) на том же файле работает', () => {
    const doc: SpecDoc = parseSpec(
      'grid: { width: 3, height: 3 }\ntypes: {}\nfuture: 42\n',
    );
    expect(doc.grid).toEqual({ width: 3, height: 3 });
  });
});

describe('specYaml: негативные случаи (SpecParseError с причиной)', () => {
  const cases: Array<[string, string]> = [
    ['битый YAML', 'grid: [1,\n'],
    ['корень — список', '- a\n- b\n'],
    ['нет grid', 'types: {}\n'],
    ['width = 0', 'grid:\n  width: 0\n  height: 5\n'],
    ['height дробное', 'grid:\n  width: 5\n  height: 2.5\n'],
    ['blockedFile — число', 'grid: { width: 3, height: 3 }\nblockedFile: 7\n'],
    ['symbol из двух символов', 'grid: { width: 3, height: 3 }\ntypes:\n  A: { symbol: "AB" }\n'],
    ['connectivity = 6', 'grid: { width: 3, height: 3 }\nrules:\n  connectivity: 6\n'],
    ['touchAll — строка', 'grid: { width: 3, height: 3 }\nrules:\n  touchAll: "yes"\n'],
    ['size.min = -1', 'grid: { width: 3, height: 3 }\nrules:\n  size:\n    min: -1\n'],
    ['areaPercent = 0', 'grid: { width: 3, height: 3 }\ntypes: { A: { symbol: "A" } }\nclusters:\n  - id: c1\n    type: A\n    areaPercent: 0\n'],
    ['areaPercent = 101', 'grid: { width: 3, height: 3 }\ntypes: { A: { symbol: "A" } }\nclusters:\n  - id: c1\n    type: A\n    areaPercent: 101\n'],
    ['shape — blob', 'grid: { width: 3, height: 3 }\ntypes: { A: { symbol: "A" } }\nclusters:\n  - id: c1\n    type: A\n    areaPercent: 50\n    shape: blob\n'],
    ['пустой id кластера', 'grid: { width: 3, height: 3 }\ntypes: { A: { symbol: "A" } }\nclusters:\n  - id: ""\n    type: A\n    areaPercent: 50\n'],
    ['adjacency-пара не из двух элементов', 'grid: { width: 3, height: 3 }\nrules:\n  adjacency:\n    forbidden:\n      - [A]\n'],
  ];

  for (const [name, yamlText] of cases) {
    it(name, () => {
      expect(() => parseSpec(yamlText)).toThrow(SpecParseError);
      // сообщение — с указанием причины на русском
      try {
        parseSpec(yamlText);
      } catch (e) {
        expect((e as Error).message.length).toBeGreaterThan(5);
      }
    });
  }

  it('пустой файл — ошибка', () => {
    expect(() => parseSpec('')).toThrow(SpecParseError);
  });
});
