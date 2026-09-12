// tests/unit/validation.test.ts — модуль валидации редактора (ТЗ 05).
//
// Покрытие:
//  • каждый код V-* таблиц ТЗ 05 §2.1/§2.2/§2.4/§2.5 — позитивный кейс с
//    точным текстом сообщения (шаблоны ТЗ 05 §5), кодом, field и cells;
//  • негативные кейсы: валидное состояние → [] (в т.ч. граничные значения);
//  • детерминированный порядок выдачи ошибок;
//  • тест «двойников» (ТЗ 05 §4): таблица соответствия кодов редактора ↔
//    ошибок spaec_manager — для каждого кода §2.1 зафиксирована невалидная
//    спекация-фрагмент, которую отклоняет и редактор (parseSpec/validateAll),
//    и spaec_manager (docs/03 §5, spec_io.py → SpecValidationError, exit 2).
//    Вызов Python в unit-тесте НЕ делается — пары «код → YAML» фиксированы
//    комментарием (Python-сторона проверяется интеграционно).

import { describe, it, expect } from 'vitest';
import { validateAll, SUM_EPSILON } from '../../src/lib/validation';
import type { ValidateInput } from '../../src/lib/validation';
import { parseSpec } from '../../src/lib/specYaml';
import { MaskParseError, parseBlockedMask, parsePresetMask } from '../../src/lib/maskText';
import type {
  BlockedCellValue,
  MaskGrid,
  PresetCellValue,
  SpecDoc,
} from '../../src/lib/types';

// ── Фикстуры ───────────────────────────────────────────────────────────────

/** Полностью валидная спекация 10×8 (база для негативных кейсов). */
function baseSpec(): SpecDoc {
  return {
    grid: { width: 10, height: 8 },
    blockedFile: null,
    presetFile: null,
    types: { A: { symbol: 'A', name: null }, B: { symbol: 'B', name: null } },
    rules: {
      connectivity: 8,
      adjacency: { forbidden: [], allow: null },
      size: { min: null, max: null },
      convexity: { weight: 'soft' },
      fillAll: false,
      touchAll: false,
    },
    clusters: [
      { id: 'c1', type: 'A', areaPercent: 60, shape: 'free' },
      { id: 'c2', type: 'B', areaPercent: 40, shape: 'rectangle' },
    ],
  };
}

/** Спекация 4×3 (для тестов масок малого размера). */
function smallSpec(): SpecDoc {
  const d = baseSpec();
  d.grid = { width: 4, height: 3 };
  d.clusters = [{ id: 'c1', type: 'A', areaPercent: 10, shape: 'free' }];
  return d;
}

function blocked(w: number, h: number, cells: [number, number][] = []): MaskGrid<BlockedCellValue> {
  const grid: BlockedCellValue[][] = Array.from({ length: h }, () =>
    Array<BlockedCellValue>(w).fill('free'),
  );
  for (const [x, y] of cells) grid[y][x] = 'blocked';
  return { width: w, height: h, cells: grid };
}

function preset(
  w: number,
  h: number,
  cells: Array<[number, number, string]> = [],
): MaskGrid<PresetCellValue> {
  const grid: PresetCellValue[][] = Array.from({ length: h }, () =>
    Array<PresetCellValue>(w).fill({ kind: 'free' as const }),
  );
  for (const [x, y, s] of cells) grid[y][x] = { kind: 'preset', symbol: s };
  return { width: w, height: h, cells: grid };
}

function st(partial: Partial<ValidateInput> = {}): ValidateInput {
  return { spec: baseSpec(), blockedMask: null, presetMask: null, ...partial };
}

// ── Базовые сценарии ───────────────────────────────────────────────────────

describe('validateAll — базовые сценарии', () => {
  it('валидное состояние (без масок) → []', () => {
    expect(validateAll(st())).toEqual([]);
  });

  it('валидное состояние с корректными масками → []', () => {
    const state = st({
      blockedMask: blocked(10, 8, [[0, 0], [3, 5]]),
      presetMask: preset(10, 8, [[4, 4, 'A'], [9, 7, 'B']]),
      maskFileNames: { blocked: 'blocked.txt', preset: 'preset.txt' },
    });
    expect(validateAll(state)).toEqual([]);
  });

  it('spec === null → [] (маски без спеки невозможны, ТЗ 05 §1)', () => {
    expect(
      validateAll({
        spec: null,
        blockedMask: blocked(3, 2),
        presetMask: preset(3, 2, [[0, 0, 'X']]),
      }),
    ).toEqual([]);
  });

  it('порядок выдачи ошибок детерминирован (ТЗ: спека → маски)', () => {
    const spec = baseSpec();
    spec.grid = { width: 0, height: 8 }; // V-GRID-DIMS
    spec.clusters = [
      { id: 'c1', type: 'GHOST', areaPercent: 60, shape: 'free' }, // V-CLUST-TYPE
      { id: 'c2', type: 'A', areaPercent: 40, shape: 'blob' as never }, // V-SHAPE
    ];
    spec.rules.adjacency.forbidden = [['A', 'X']]; // V-ADJ-TYPE
    spec.rules.size = { min: 9, max: 1 }; // V-SIZE
    const state = st({
      spec,
      blockedMask: blocked(3, 2, [[0, 0]]), // V-MASK-DIM + конфликт
      presetMask: preset(3, 2, [[0, 0, 'Q']]), // V-MASK-DIM + осиротевший + конфликт
      maskFileNames: { blocked: 'b.txt' },
    });
    expect(validateAll(state).map((e) => e.code)).toEqual([
      'V-GRID-DIMS',
      'V-CLUST-TYPE',
      'V-SHAPE',
      'V-ADJ-TYPE',
      'V-SIZE',
      'V-MASK-DIM', // blocked (есть имя файла)
      'V-MASK-DIM', // preset (без имени)
      'V-MASK-PRESET', // осиротевший символ Q
      'V-MASK-CONFLICT',
    ]);
  });
});

// ── Коды §2.1: спека ───────────────────────────────────────────────────────

describe('V-GRID-DIMS (ТЗ 05 §2.1)', () => {
  it('width не положительное целое → ошибка с точным текстом', () => {
    const spec = baseSpec();
    spec.grid.width = 0;
    const errors = validateAll(st({ spec }));
    expect(errors).toEqual([
      {
        code: 'V-GRID-DIMS',
        field: 'grid.width',
        message: 'Размер сетки: width и height должны быть целыми числами больше 0.',
      },
    ]);
  });

  it('height дробное → ошибка по grid.height', () => {
    const spec = baseSpec();
    spec.grid.height = 2.5;
    const errors = validateAll(st({ spec }));
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('V-GRID-DIMS');
    expect(errors[0].field).toBe('grid.height');
  });

  it('негатив: положительные целые → без ошибок', () => {
    expect(validateAll(st())).toEqual([]);
  });
});

describe('V-MASK-DIM (ТЗ 05 §2.1/§2.2)', () => {
  it('загруженный файл маски с другим размером — шаблон «Файл маски…»', () => {
    const state = st({
      blockedMask: blocked(5, 4),
      maskFileNames: { blocked: 'blocked.txt' },
    });
    const errors = validateAll(state);
    expect(errors).toEqual([
      {
        code: 'V-MASK-DIM',
        field: 'blockedFile',
        message:
          'Файл маски `blocked.txt` имеет размер 5×4, а сетка в спеке — 10×8. ' +
          'Перезагрузите маску или измените размер сетки.',
      },
    ]);
    expect(errors[0].cells).toBeUndefined(); // заглушка подсветки (04-ui-ux §3.5)
  });

  it('маска без имени файла — шаблон «…больше не совпадает» (имя из поля спеки)', () => {
    const spec = baseSpec();
    spec.presetFile = 'preset.txt';
    const state = st({ spec, presetMask: preset(3, 2) });
    expect(validateAll(state)).toEqual([
      {
        code: 'V-MASK-DIM',
        field: 'presetFile',
        message: 'Маска `preset.txt` (3×2) больше не совпадает с размером сетки (10×8).',
      },
    ]);
  });

  it('маска без имени файла и без поля спеки — дефолтное имя preset.txt', () => {
    const state = st({ presetMask: preset(3, 2) }); // spec.presetFile === null
    expect(validateAll(state)[0].message).toBe(
      'Маска `preset.txt` (3×2) больше не совпадает с размером сетки (10×8).',
    );
  });

  it('негатив: размер маски = grid → без ошибок', () => {
    const state = st({ blockedMask: blocked(10, 8), maskFileNames: { blocked: 'b.txt' } });
    expect(validateAll(state)).toEqual([]);
  });
});

describe('V-CLUST-TYPE (ТЗ 05 §2.1)', () => {
  it('кластер ссылается на отсутствующий тип → точный текст', () => {
    const spec = baseSpec();
    spec.clusters[0].type = 'GHOST';
    const errors = validateAll(st({ spec }));
    expect(errors).toEqual([
      {
        code: 'V-CLUST-TYPE',
        field: 'clusters[0].type',
        message: 'Кластер `c1` ссылается на тип `GHOST`, которого нет в реестре типов.',
      },
    ]);
  });

  it('негатив: все типы указаны → без ошибок', () => {
    expect(validateAll(st())).toEqual([]);
  });
});

describe('V-CLUST-ID (ТЗ 05 §2.1)', () => {
  it('дублирующийся id → первая пара, «№» — по порядку списка (с 1)', () => {
    const spec = baseSpec();
    spec.clusters = [
      { id: 'c1', type: 'A', areaPercent: 20, shape: 'free' },
      { id: 'c2', type: 'B', areaPercent: 20, shape: 'free' },
      { id: 'c1', type: 'A', areaPercent: 20, shape: 'free' },
    ];
    const errors = validateAll(st({ spec }));
    expect(errors).toEqual([
      {
        code: 'V-CLUST-ID',
        field: 'clusters[2].id',
        message: 'Дублируется id кластера: `c1` (кластеры № 1 и № 3).',
      },
    ]);
  });

  it('несколько дублей → одна ошибка (первая пара)', () => {
    const spec = baseSpec();
    spec.clusters = [
      { id: 'c1', type: 'A', areaPercent: 10, shape: 'free' },
      { id: 'c2', type: 'B', areaPercent: 10, shape: 'free' },
      { id: 'c1', type: 'A', areaPercent: 10, shape: 'free' },
      { id: 'c1', type: 'A', areaPercent: 10, shape: 'free' },
    ];
    const errors = validateAll(st({ spec }));
    expect(errors.filter((e) => e.code === 'V-CLUST-ID')).toHaveLength(1);
  });

  it('негатив: уникальные id → без ошибок', () => {
    expect(validateAll(st())).toEqual([]);
  });
});

describe('V-CLUST-SUM (ТЗ 05 §2.1, epsilon 1e-9)', () => {
  it('Σ = 110 → точный текст с суммой', () => {
    const spec = baseSpec();
    spec.clusters[1].areaPercent = 50; // 60 + 50
    const errors = validateAll(st({ spec }));
    expect(errors).toEqual([
      {
        code: 'V-CLUST-SUM',
        field: 'clusters',
        message: 'Сумма долей кластеров — 110 %, больше 100%.',
      },
    ]);
  });

  it('дробная сумма округляется до 2 знаков (100.01)', () => {
    const spec = baseSpec();
    spec.clusters = [
      { id: 'c1', type: 'A', areaPercent: 33.34, shape: 'free' },
      { id: 'c2', type: 'B', areaPercent: 33.33, shape: 'free' },
      { id: 'c3', type: 'A', areaPercent: 33.34, shape: 'free' },
    ];
    const errors = validateAll(st({ spec }));
    expect(errors[0].message).toBe('Сумма долей кластеров — 100.01 %, больше 100%.');
  });

  it('негатив: Σ = 100 ровно → без ошибок', () => {
    expect(validateAll(st())).toEqual([]); // 60 + 40
  });

  it('негатив: превышение в пределах epsilon (1e-9) → без ошибок', () => {
    const spec = baseSpec();
    spec.clusters = [{ id: 'c1', type: 'A', areaPercent: 100 + SUM_EPSILON / 2, shape: 'free' }];
    expect(validateAll(st({ spec }))).toEqual([]);
  });

  it('позитив: превышение за пределами epsilon → ошибка', () => {
    const spec = baseSpec();
    spec.clusters = [{ id: 'c1', type: 'A', areaPercent: 100 + 2 * SUM_EPSILON, shape: 'free' }];
    expect(validateAll(st({ spec })).map((e) => e.code)).toContain('V-CLUST-SUM');
  });
});

describe('V-ADJ-TYPE (ТЗ 05 §2.1)', () => {
  it('неизвестный тип в forbidden → точный текст', () => {
    const spec = baseSpec();
    spec.rules.adjacency.forbidden = [['A', 'GHOST']];
    const errors = validateAll(st({ spec }));
    expect(errors).toEqual([
      {
        code: 'V-ADJ-TYPE',
        field: 'rules.adjacency.forbidden',
        message: 'В правилах соседства указан неизвестный тип `GHOST` (пара в forbidden).',
      },
    ]);
  });

  it('неизвестный тип в allow → «(пара в allow)»', () => {
    const spec = baseSpec();
    spec.rules.adjacency.allow = [['B', 'X']];
    const errors = validateAll(st({ spec }));
    expect(errors[0].message).toBe('В правилах соседства указан неизвестный тип `X` (пара в allow).');
    expect(errors[0].field).toBe('rules.adjacency.allow');
  });

  it('один неизвестный тип в нескольких парах → одна ошибка (дедупликация)', () => {
    const spec = baseSpec();
    spec.rules.adjacency.forbidden = [['A', 'X'], ['X', 'B']];
    const errors = validateAll(st({ spec }));
    expect(errors.filter((e) => e.code === 'V-ADJ-TYPE')).toHaveLength(1);
  });

  it('один неизвестный тип и в forbidden, и в allow → две ошибки (разные списки)', () => {
    const spec = baseSpec();
    spec.rules.adjacency.forbidden = [['A', 'X']];
    spec.rules.adjacency.allow = [['B', 'X']];
    const errors = validateAll(st({ spec }));
    expect(errors.filter((e) => e.code === 'V-ADJ-TYPE')).toHaveLength(2);
  });

  it('негатив: все типы известны → без ошибок', () => {
    const spec = baseSpec();
    spec.rules.adjacency.forbidden = [['A', 'B']];
    expect(validateAll(st({ spec }))).toEqual([]);
  });
});

describe('V-SHAPE (ТЗ 05 §2.1)', () => {
  it('форма вне free/rectangle/circle → точный текст (защита модели)', () => {
    const spec = baseSpec();
    spec.clusters[0].shape = 'blob' as never;
    const errors = validateAll(st({ spec }));
    expect(errors).toEqual([
      {
        code: 'V-SHAPE',
        field: 'clusters[0].shape',
        message: 'Кластер `c1`: форма `blob` не поддерживается (допустимо free / rectangle / circle).',
      },
    ]);
  });

  it('негатив: допустимые формы → без ошибок', () => {
    expect(validateAll(st())).toEqual([]);
  });
});

describe('V-TOUCHALL-TYPE (ТЗ 05 §2.1)', () => {
  it('touchAll не boolean → точный текст (защита модели)', () => {
    const spec = baseSpec();
    spec.rules.touchAll = 'yes' as unknown as boolean;
    const errors = validateAll(st({ spec }));
    expect(errors).toEqual([
      { code: 'V-TOUCHALL-TYPE', field: 'rules.touchAll', message: 'Поле touchAll должно быть true или false.' },
    ]);
  });

  it('негатив: boolean → без ошибок', () => {
    const spec = baseSpec();
    spec.rules.touchAll = true;
    expect(validateAll(st({ spec }))).toEqual([]);
  });
});

describe('V-SIZE (ТЗ 05 §2.4/§5)', () => {
  it('min > max → точный текст', () => {
    const spec = baseSpec();
    spec.rules.size = { min: 5, max: 3 };
    const errors = validateAll(st({ spec }));
    expect(errors).toEqual([
      {
        code: 'V-SIZE',
        field: 'rules.size',
        message: 'Ограничение размера: min (5) больше max (3).',
      },
    ]);
  });

  it('негатив: min ≤ max или null → без ошибок', () => {
    const ok = baseSpec();
    ok.rules.size = { min: 3, max: 5 };
    expect(validateAll(st({ spec: ok }))).toEqual([]);
    const none = baseSpec();
    none.rules.size = { min: null, max: null };
    expect(validateAll(st({ spec: none }))).toEqual([]);
  });
});

// ── Коды §2.2/§2.5: маски ──────────────────────────────────────────────────

describe('V-MASK-PRESET — осиротевшие клетки (ТЗ 05 §2.2)', () => {
  it('один символ вне реестра → точный текст и cells', () => {
    const state = st({ presetMask: preset(10, 8, [[2, 1, 'X']]) });
    const errors = validateAll(state);
    expect(errors).toEqual([
      {
        code: 'V-MASK-PRESET',
        message:
          'Preset: клетка (2, 1) содержит символ «X», не совпадающий ни с одним типом. ' +
          'Исправьте ластиком или перезагрузите файл.',
        cells: [[2, 1]],
      },
    ]);
  });

  it('несколько разных символов → одна ошибка на символ', () => {
    const state = st({ presetMask: preset(10, 8, [[0, 0, 'X'], [5, 4, 'Y']]) });
    const errors = validateAll(state);
    expect(errors).toHaveLength(2);
    expect(errors.map((e) => e.message)).toEqual([
      'Preset: клетка (0, 0) содержит символ «X», не совпадающий ни с одним типом. Исправьте ластиком или перезагрузите файл.',
      'Preset: клетка (5, 4) содержит символ «Y», не совпадающий ни с одним типом. Исправьте ластиком или перезагрузите файл.',
    ]);
  });

  it('N > 5 клеток → сокращение до 5 + «… и ещё {N-5} клеток» (ТЗ 05 §5)', () => {
    const cells: Array<[number, number, string]> = [];
    for (let x = 0; x < 7; x++) cells.push([x, 0, 'Z']);
    const state = st({ presetMask: preset(10, 8, cells) });
    expect(validateAll(state)[0].message).toBe(
      'Preset: клетка (0, 0), (1, 0), (2, 0), (3, 0), (4, 0), … и ещё 2 клеток содержит символ «Z», ' +
        'не совпадающий ни с одним типом. Исправьте ластиком или перезагрузите файл.',
    );
  });

  it('ошибки чтения preset-файла (parsePresetMask) пробрасываются как есть (ТЗ 05 §2.2)', () => {
    // Файл 4×3 с чужим символом 'Z' в (2,1): parsePresetMask сохраняет файл,
    // клетку — free, и выдаёт V-MASK-PRESET; validateAll должен его пробросить.
    const res = parsePresetMask('....\n..Z.\n....\n', 4, 3, ['A', 'B']);
    expect(res.errors).toHaveLength(1);
    const state: ValidateInput = {
      spec: smallSpec(),
      blockedMask: null,
      presetMask: res.mask,
      presetParseErrors: res.errors,
    };
    const errors = validateAll(state);
    // Только проброшенная ошибка: чужая клетка в модели free → осиротевших нет.
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(res.errors[0]);
  });

  it('негатив: все символы из реестра типов → без ошибок', () => {
    const state = st({ presetMask: preset(10, 8, [[0, 0, 'A'], [1, 1, 'B']]) });
    expect(validateAll(state)).toEqual([]);
  });
});

describe('V-MASK-CONFLICT (ТЗ 05 §2.5)', () => {
  it('клетка blocked ∩ preset → точный текст с id типа и cells', () => {
    const spec = baseSpec();
    spec.types.ROOM = { symbol: 'R', name: null };
    const state = st({
      spec,
      blockedMask: blocked(10, 8, [[1, 1]]),
      presetMask: preset(10, 8, [[1, 1, 'R']]),
    });
    const errors = validateAll(state);
    expect(errors).toEqual([
      {
        code: 'V-MASK-CONFLICT',
        message:
          'Клетка (1, 1) одновременно заблокирована и занята preset-кластером (тип `ROOM`). ' +
          'Уберите блокировку или preset-клетку.',
        cells: [[1, 1]],
      },
    ]);
  });

  it('осиротевший символ в конфликте → {type} = сам символ', () => {
    const state = st({
      blockedMask: blocked(10, 8, [[2, 3]]),
      presetMask: preset(10, 8, [[2, 3, 'Q']]),
    });
    const conflict = validateAll(state).find((e) => e.code === 'V-MASK-CONFLICT');
    expect(conflict?.message).toContain('(тип `Q`)');
  });

  it('конфликты разных типов → группировка: одна ошибка на тип', () => {
    const state = st({
      blockedMask: blocked(10, 8, [[0, 0], [1, 0], [5, 5]]),
      presetMask: preset(10, 8, [[0, 0, 'A'], [1, 0, 'A'], [5, 5, 'B']]),
    });
    const conflicts = validateAll(state).filter((e) => e.code === 'V-MASK-CONFLICT');
    expect(conflicts).toHaveLength(2);
    expect(conflicts[0].cells).toEqual([[0, 0], [1, 0]]);
    expect(conflicts[0].message).toContain('(тип `A`)');
    expect(conflicts[1].cells).toEqual([[5, 5]]);
    expect(conflicts[1].message).toContain('(тип `B`)');
  });

  it('N > 5 клеток → сокращение «… и ещё {N-5} клеток»', () => {
    const coords: [number, number][] = [];
    for (let x = 0; x < 6; x++) coords.push([x, 0]);
    const state = st({
      blockedMask: blocked(10, 8, coords),
      presetMask: preset(10, 8, coords.map(([x, y]) => [x, y, 'A'])),
    });
    const conflict = validateAll(state).find((e) => e.code === 'V-MASK-CONFLICT');
    expect(conflict?.message).toBe(
      'Клетка (0, 0), (1, 0), (2, 0), (3, 0), (4, 0), … и ещё 1 клеток одновременно заблокирована ' +
        'и занята preset-кластером (тип `A`). Уберите блокировку или preset-клетку.',
    );
    expect(conflict?.cells).toHaveLength(6);
  });

  it('негатив: перекрытий нет → без ошибок', () => {
    const state = st({
      blockedMask: blocked(10, 8, [[0, 0]]),
      presetMask: preset(10, 8, [[9, 7, 'A']]),
    });
    expect(validateAll(state)).toEqual([]);
  });

  it('маски разного размера (V-MASK-DIM) — конфликт ищется в пересечении', () => {
    const state = st({
      blockedMask: blocked(4, 3, [[0, 0]]),
      presetMask: preset(10, 8, [[0, 0, 'A']]),
    });
    const codes = validateAll(state).map((e) => e.code);
    expect(codes).toContain('V-MASK-CONFLICT');
    expect(codes.filter((c) => c === 'V-MASK-DIM')).toHaveLength(1); // только blocked (4×3 ≠ 10×8)
  });
});

// ── Тест «двойников» (ТЗ 05 §4) ────────────────────────────────────────────
// Таблица соответствия: каждый код V-* из ТЗ 05 §2.1 имеет «двойника» в
// списке ошибок парсинга spaec_manager (docs/03 §5, spec_io.py → exit 2).
// Для каждого кода зафиксирован невалидный YAML-фрагмент, который:
//   • редактор отклоняет — на parseSpec (V-GRID-DIMS, V-SHAPE, V-TOUCHALL-TYPE)
//     или на уровне модели validateAll (V-CLUST-TYPE, V-CLUST-ID, V-CLUST-SUM,
//     V-ADJ-TYPE; для V-MASK-DIM — MaskParseError при чтении маски);
//   • spaec_manager отклоняет — по той же сути (указано в note).

interface TwinCase {
  code: string;
  yaml: string;
  via: 'parse' | 'model' | 'mask';
  note: string; // как этот фрагмент отклоняет spaec_manager
}

const TWIN_CASES: TwinCase[] = [
  {
    code: 'V-GRID-DIMS',
    yaml: 'grid:\n  width: 0\n  height: 5\ntypes: {}\nrules: {}\nclusters: []\n',
    via: 'parse',
    note: 'spaec_manager: SpecValidationError «width/height не положительные целые» (spec_io._parse_grid, docs/03 §5 п.1)',
  },
  {
    code: 'V-MASK-DIM',
    yaml:
      'grid:\n  width: 10\n  height: 10\nblockedFile: small_mask.txt\ntypes: {}\nrules: {}\nclusters: []\n',
    via: 'mask',
    note: 'spaec_manager: SpecValidationError при чтении маски «размер ≠ grid» (spec_io.read_blocked_file, docs/03 §5 п.2); редактор: MaskParseError V-MASK-DIM в parseBlockedMask',
  },
  {
    code: 'V-CLUST-TYPE',
    yaml:
      'grid:\n  width: 5\n  height: 5\ntypes:\n  A: { symbol: "A" }\nrules: {}\nclusters:\n  - id: c1\n    type: GHOST\n    areaPercent: 10\n',
    via: 'model',
    note: 'spaec_manager: SpecValidationError «в clusters указан тип, которого нет в types» (spec_io._parse_clusters, docs/03 §5 п.3)',
  },
  {
    code: 'V-CLUST-ID',
    yaml:
      'grid:\n  width: 5\n  height: 5\ntypes:\n  A: { symbol: "A" }\nrules: {}\nclusters:\n  - id: c1\n    type: A\n    areaPercent: 10\n  - id: c1\n    type: A\n    areaPercent: 20\n',
    via: 'model',
    note: 'spaec_manager: SpecValidationError «дублируется id экземпляра» (spec_io._parse_clusters, docs/03 §5 п.4)',
  },
  {
    code: 'V-CLUST-SUM',
    yaml:
      'grid:\n  width: 5\n  height: 5\ntypes:\n  A: { symbol: "A" }\nrules: {}\nclusters:\n  - id: c1\n    type: A\n    areaPercent: 60\n  - id: c2\n    type: A\n    areaPercent: 50\n',
    via: 'model',
    note: 'spaec_manager: SpecValidationError «сумма areaPercent превышает 100» (spec_io._parse_clusters, docs/03 §5 п.5)',
  },
  {
    code: 'V-ADJ-TYPE',
    yaml:
      'grid:\n  width: 5\n  height: 5\ntypes:\n  A: { symbol: "A" }\nrules:\n  adjacency:\n    forbidden:\n      - [A, GHOST]\nclusters: []\n',
    via: 'model',
    note: 'spaec_manager: SpecValidationError «в adjacency указан неизвестный тип» (spec_io._parse_pairs, docs/03 §5 п.6)',
  },
  {
    code: 'V-SHAPE',
    yaml:
      'grid:\n  width: 5\n  height: 5\ntypes:\n  A: { symbol: "A" }\nrules: {}\nclusters:\n  - id: c1\n    type: A\n    areaPercent: 10\n    shape: blob\n',
    via: 'parse',
    note: 'spaec_manager: SpecValidationError «shape не входит в допустимый набор» (spec_io._parse_clusters, docs/03 §5 п.7)',
  },
  {
    code: 'V-TOUCHALL-TYPE',
    yaml:
      'grid:\n  width: 5\n  height: 5\ntypes: {}\nrules:\n  touchAll: "yes"\nclusters: []\n',
    via: 'parse',
    note: 'spaec_manager: SpecValidationError «touchAll не является boolean» (spec_io._parse_rules, docs/03 §5 п.8)',
  },
];

describe('Тест «двойников» ТЗ 05 §4: редактор отклоняет те же случаи, что и spaec_manager', () => {
  it.each(TWIN_CASES)('$code — фрагмент отклонён редактором ($via)', (tc) => {
    if (tc.via === 'parse') {
      // Ошибка на этапе парсинга YAML — до модели.
      expect(() => parseSpec(tc.yaml)).toThrow();
    } else if (tc.via === 'mask') {
      // V-MASK-DIM — не про YAML: маска 5×5 при grid 10×10 не открывается.
      const small = Array.from({ length: 5 }, () => '.....').join('\n') + '\n';
      try {
        parseBlockedMask(small, 10, 10);
        expect.unreachable('parseBlockedMask должен бросить MaskParseError');
      } catch (e) {
        expect(e).toBeInstanceOf(MaskParseError);
        expect((e as MaskParseError).code).toBe('V-MASK-DIM');
      }
    } else {
      // Модельный уровень: parseSpec принимает, validateAll помечает.
      const doc = parseSpec(tc.yaml);
      const errors = validateAll({ spec: doc, blockedMask: null, presetMask: null });
      expect(errors.map((e) => e.code)).toContain(tc.code);
    }
  });

  it('таблица «двойников» покрывает все 8 кодов §2.1', () => {
    const codes = TWIN_CASES.map((t) => t.code).sort();
    expect(codes).toEqual(
      [
        'V-ADJ-TYPE',
        'V-CLUST-ID',
        'V-CLUST-SUM',
        'V-CLUST-TYPE',
        'V-GRID-DIMS',
        'V-MASK-DIM',
        'V-SHAPE',
        'V-TOUCHALL-TYPE',
      ].sort(),
    );
  });
});
