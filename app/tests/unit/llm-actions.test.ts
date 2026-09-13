// Unit-тесты чистых функций LLM-модуля (ТЗ docs-llm/07 §2.1):
// валидатор оверрайдов run_generation, edits к карте, парсер отчёта, геометрия.
import { describe, expect, it } from 'vitest';

import {
  applyEditsToMap,
  checkGenerationArgs,
  checkMapEdits,
  replaceMapSection,
} from '../../server/llm/actions.js';
import {
  buildClusterSummary,
  buildGeometrySummary,
  connectedRegions,
  extractMapLines,
  parseTableRows,
} from '../../server/llm/reportParse.js';
import { clusterTarget, countFreeCells, maskToGrid, parseSpec } from '../../server/llm/specInfo.js';

const SPEC_TEXT = [
  'grid:',
  '  width: 10',
  '  height: 5',
  'blockedFile: blocked.txt',
  'presetFile: preset.txt',
  'types:',
  '  ROOM: { symbol: "R", name: Комната }',
  '  CORRIDOR: { symbol: "C", name: Коридор }',
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
  '    areaPercent: 30',
  '    shape: free',
  '  - id: corridor1',
  '    type: CORRIDOR',
  '    areaPercent: 70',
  '    shape: free',
  '',
].join('\n');

const SPEC = parseSpec(SPEC_TEXT);

// F для оверрайдов: маска 10×5 без блокировок → 50 свободных клеток.
const F = 50;

describe('checkGenerationArgs — валидация оверрайдов (ТЗ docs-llm/03 §4)', () => {
  it('пустые args {} — ок, оверрайдов нет', () => {
    const res = checkGenerationArgs({}, SPEC, F);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.args).toEqual({});
  });

  it('seed: целое ≥ 0 проходит; отрицательное/дробное/не число — ошибка', () => {
    for (const seed of [0, 7, 12345]) {
      const res = checkGenerationArgs({ seed }, SPEC, F);
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.args.seed).toBe(seed);
    }
    for (const seed of [-1, 1.5, '7', null]) {
      const res = checkGenerationArgs({ seed }, SPEC, F);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toContain('seed');
    }
  });

  it('timeBudget: число > 0 проходит; 0/отрицательное/строка — ошибка', () => {
    expect(checkGenerationArgs({ timeBudget: 1.5 }, SPEC, F).ok).toBe(true);
    for (const tb of [0, -2, '2', NaN]) {
      const res = checkGenerationArgs({ timeBudget: tb }, SPEC, F);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toContain('timeBudget');
    }
  });

  it('nodeBudget: целое > 0 проходит; дробное/≤0 — ошибка', () => {
    const ok = checkGenerationArgs({ nodeBudget: 50000 }, SPEC, F);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.args.nodeBudget).toBe(50000);
    for (const nb of [0, -1, 2.5, 'x']) {
      const res = checkGenerationArgs({ nodeBudget: nb }, SPEC, F);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toContain('nodeBudget');
    }
  });

  describe('areaPercent — допуск ±10% от цели кластера (границы включительно)', () => {
    // room1: цель = round(50 * 30/100) = 15 → разрешено |new − 15| ≤ 1.5, т.е. 14..16.
    it('внутри допуска — проходит (включая границы)', () => {
      for (const pct of [28, 30, 32]) {
        const res = checkGenerationArgs({ areaPercent: { room1: pct } }, SPEC, F);
        expect(res.ok).toBe(true);
      }
    });

    it('вне допуска — ошибка с текстом допустимого диапазона', () => {
      const res = checkGenerationArgs({ areaPercent: { room1: 40 } }, SPEC, F);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toContain('room1');
        expect(res.error).toContain('15'); // цель
      }
    });

    it('кластер с целью 0 — оверрайд не допускается', () => {
      const tiny = parseSpec(SPEC_TEXT.replace('width: 10', 'width: 2')); // F=10, room1 → round(10*30/100)=3
      const zero = parseSpec(SPEC_TEXT.replace('areaPercent: 30', 'areaPercent: 4').replace('width: 10', 'width: 2'));
      expect(clusterTarget(10, 4)).toBe(0); // round(0.4) = 0
      const res = checkGenerationArgs({ areaPercent: { room1: 50 } }, zero, 10);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toContain('цель 0');
      // Контроль: у tiny цель ненулевая — прогоним валидатор на нём.
      expect(checkGenerationArgs({ areaPercent: { room1: 34 } }, tiny, 10).ok).toBe(true);
    });

    it('неизвестный id кластера — ошибка со списком допустимых', () => {
      const res = checkGenerationArgs({ areaPercent: { kom1: 20 } }, SPEC, F);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toContain('kom1');
        expect(res.error).toContain('room1');
      }
    });
  });

  describe('запрещённые и неизвестные аргументы — каждое по отдельности', () => {
    for (const key of ['touchAll', 'grid', 'blockedFile', 'presetFile', 'types', 'shape', 'rules', 'clusters', 'width', 'height', 'fillAll']) {
      it(`аргумент ${key} запрещён`, () => {
        const res = checkGenerationArgs({ [key]: true }, SPEC, F);
        expect(res.ok).toBe(false);
        if (!res.ok) {
          expect(res.error).toContain(key);
          expect(res.error).toMatch(/запрещён|неизвестн/);
        }
      });
    }

    it('несколько запрещённых — все перечислены в одном сообщении', () => {
      const res = checkGenerationArgs({ touchAll: true, grid: { width: 30 } }, SPEC, F);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toContain('touchAll');
        expect(res.error).toContain('grid');
      }
    });
  });
});

describe('checkMapEdits / applyEditsToMap (ТЗ docs-llm/03 §6)', () => {
  it('пустой/не массив edits — ошибка', () => {
    for (const raw of [undefined, [], 'x', { x: 1 }]) {
      const res = checkMapEdits(raw, SPEC);
      expect(res.ok).toBe(false);
    }
  });

  it('координаты вне сетки — ошибка с границами', () => {
    for (const edit of [
      { x: -1, y: 0, symbol: '.' },
      { x: 10, y: 0, symbol: '.' },
      { x: 0, y: -1, symbol: '.' },
      { x: 0, y: 5, symbol: '.' },
    ]) {
      const res = checkMapEdits([edit], SPEC);
      expect(res.ok).toBe(false);
    }
  });

  it('недопустимый символ (вне {*, .} ∪ символов спеки) — ошибка', () => {
    for (const symbol of ['X', '?', 'RR', '']) {
      const res = checkMapEdits([{ x: 0, y: 0, symbol }], SPEC);
      expect(res.ok).toBe(false);
    }
    // Допустимые: '*', '.', 'R', 'C'.
    expect(checkMapEdits([{ x: 0, y: 0, symbol: '*' }], SPEC).ok).toBe(true);
    expect(checkMapEdits([{ x: 0, y: 0, symbol: 'C' }], SPEC).ok).toBe(true);
  });

  it('применение edits: только карта меняется, исходный массив не мутируется', () => {
    const map = ['RR....CCC.', '..R..C.C..'];
    const res = checkMapEdits([{ x: 0, y: 0, symbol: '.' }, { x: 8, y: 1, symbol: '.' }], SPEC);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unreachable');
    const next = applyEditsToMap(map, res.edits);
    expect(next).toEqual(['.R....CCC.', '..R..C.C..']);
    expect(map).toEqual(['RR....CCC.', '..R..C.C..']); // исходный нетронут
  });

  it('replaceMapSection: секция КАРТА заменяется, остальные секции переносятся как есть', () => {
    const report = [
      '== КАРТА ==',
      'RR..',
      '..CC',
      '',
      '== ТАБЛИЦА: запрошено / фактически / отклонение ==',
      '',
      'id | type | доля (%) | цель (клеток) | факт (клеток) | отклонение | статус',
      'a  | ROOM | 50       | 2             | 2             | 0          | ок',
      '',
      '== ПРЕДУПРЕЖДЕНИЯ ==',
      '',
      'нет',
    ].join('\n');
    const out = replaceMapSection(report, ['RR..', '.CCC']);
    expect(out).toBe([
      '== КАРТА ==',
      'RR..',
      '.CCC',
      '',
      '== ТАБЛИЦА: запрошено / фактически / отклонение ==',
      '',
      'id | type | доля (%) | цель (клеток) | факт (клеток) | отклонение | статус',
      'a  | ROOM | 50       | 2             | 2             | 0          | ок',
      '',
      '== ПРЕДУПРЕЖДЕНИЯ ==',
      '',
      'нет',
    ].join('\n'));
  });
});

describe('парсер отчёта (ТЗ docs-llm/03 §5)', () => {
  const REPORT = [
    'НЕ УДАЛОСЬ РАЗМЕСТИТЬ ВСЕ КЛАСТЕРЫ.',
    'Причина: тест',
    '',
    '== КАРТА ==',
    'RR.CC',
    'R.RCC',
    '.CCC.',
    '',
    '== ТАБЛИЦА: запрошено / фактически / отклонение ==',
    '',
    'id        | type     | доля (%) | цель (клеток) | факт (клеток) | отклонение  | статус   ',
    '--------- | -------- | -------- | ------------- | ------------- | ----------- | --------',
    'room1     | ROOM     | 40       | 3             | 3             | 0           | ок      ',
    'corridor1 | CORRIDOR | 60       | 5             | 4             | -1 (-25%)   | недостача',
    '',
    '== ПРЕДУПРЕЖДЕНИЯ ==',
    '',
    'WARNING: corridor1 (CORRIDOR) получился меньше запрошенного.',
  ].join('\n');

  it('extractMapLines — секция КАРТА; нет секции → null', () => {
    expect(extractMapLines(REPORT)).toEqual(['RR.CC', 'R.RCC', '.CCC.']);
    expect(extractMapLines('без секций')).toBeNull();
    expect(extractMapLines('== КАРТА ==\n\n== ТАБЛИЦА ==\n')).toBeNull();
  });

  it('parseTableRows — строки таблицы (цель/факт/статус); пустой массив без секции', () => {
    const rows = parseTableRows(REPORT);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: 'room1', type: 'ROOM', target: 3, actual: 3, status: 'ок' });
    expect(rows[1]).toMatchObject({ id: 'corridor1', type: 'CORRIDOR', target: 5, actual: 4, deviation: '-1 (-25%)', status: 'недостача' });
    expect(parseTableRows('без таблицы')).toEqual([]);
  });

  it('buildClusterSummary — компактный JSON по кластерам', () => {
    const summary = buildClusterSummary(parseTableRows(REPORT));
    expect(summary).toEqual({
      clusters: [
        { id: 'room1', type: 'ROOM', target: 3, actual: 3, deviation: '0', status: 'ок' },
        { id: 'corridor1', type: 'CORRIDOR', target: 5, actual: 4, deviation: '-1 (-25%)', status: 'недостача' },
      ],
    });
  });

  it('connectedRegions — 8-связность (диагонали), «.»/«*» не учитываются, bbox', () => {
    // R-клетки: (0,0), (2,0) — изолированные; (0,2),(1,2) — соседни по горизонтали.
    const map = ['R.R', '*..', 'RR.'];
    const regions = connectedRegions(map.map((l) => [...l]));
    expect(regions).toEqual([
      { symbol: 'R', cells: 1, bbox: [0, 0, 0, 0] },
      { symbol: 'R', cells: 1, bbox: [2, 0, 2, 0] },
      { symbol: 'R', cells: 2, bbox: [0, 2, 1, 2] },
    ]);

    // Диагональное касание = ОДНА область (8-окрестность).
    const diag = ['R.', '.R'];
    expect(connectedRegions(diag.map((l) => [...l]))).toEqual([{ symbol: 'R', cells: 2, bbox: [0, 0, 1, 1] }]);

    // '*' и '.' не дают областей.
    expect(connectedRegions(['**.', '.**.'].map((l) => [...l]))).toEqual([]);
  });

  it('buildGeometrySummary — тип по символу из реестра; неизвестный символ → type null', () => {
    const map = ['RC?'];
    const geo = buildGeometrySummary(map, SPEC.types);
    expect(geo).toEqual({
      regions: [
        { type: 'ROOM', symbol: 'R', cells: 1, bbox: [0, 0, 0, 0] },
        { type: 'CORRIDOR', symbol: 'C', cells: 1, bbox: [1, 0, 1, 0] },
        { type: null, symbol: '?', cells: 1, bbox: [2, 0, 2, 0] },
      ],
    });
  });
});

describe('specInfo — парсинг спеки и маски (чистые функции)', () => {
  it('parseSpec — grid/types/clusters/маски', () => {
    expect(SPEC.width).toBe(10);
    expect(SPEC.height).toBe(5);
    expect(SPEC.blockedFile).toBe('blocked.txt');
    expect(SPEC.presetFile).toBe('preset.txt');
    expect(SPEC.types.ROOM).toEqual({ symbol: 'R', name: 'Комната' });
    expect(SPEC.clusters).toEqual([
      { id: 'room1', type: 'ROOM', areaPercent: 30, shape: 'free' },
      { id: 'corridor1', type: 'CORRIDOR', areaPercent: 70, shape: 'free' },
    ]);
  });

  it('parseSpec — невалидный grid → ошибка', () => {
    expect(() => parseSpec(SPEC_TEXT.replace('width: 10', 'width: 0'))).toThrow(/grid.width/);
    expect(() => parseSpec('not: [yaml')).toThrow();
  });

  it('maskToGrid — размер; countFreeCells — «*» блокирует, preset НЕ уменьшает F', () => {
    const grid = maskToGrid('..*\n...\n...', 3, 3);
    expect(countFreeCells(grid)).toBe(8);
    // Символ типа в маске (пресет) считается свободной клеткой (docs/03 §3).
    expect(countFreeCells(maskToGrid('R.*\n...\n...', 3, 3))).toBe(8);
    expect(() => maskToGrid('....', 3, 3)).toThrow(/строк|длины/);
    expect(() => maskToGrid('..\n...', 3, 2)).toThrow();
  });

  it('clusterTarget — round(F · % / 100)', () => {
    expect(clusterTarget(50, 30)).toBe(15);
    expect(clusterTarget(96, 30)).toBe(29); // как в примере docs/06 §4
    expect(clusterTarget(10, 4)).toBe(0);
  });
});
