// Smoke-тест store (подзадача 11): SPEC_LOADED устанавливает спеку.
import { describe, expect, it } from 'vitest';
import { initialState, reducer } from '../../src/state/editorStore';
import type { SpecDoc } from '../../src/lib/types';

const spec: SpecDoc = {
  grid: { width: 10, height: 8 },
  blockedFile: null,
  presetFile: null,
  types: { ROOM: { symbol: 'R', name: 'Комната' } },
  rules: {
    connectivity: 8,
    adjacency: { forbidden: [], allow: null },
    size: { min: null, max: null },
    convexity: { weight: 'soft' },
    fillAll: false,
    touchAll: false,
  },
  clusters: [
    { id: 'room1', type: 'ROOM', areaPercent: 100, shape: 'free' },
  ],
};

describe('editorStore (smoke)', () => {
  it('SPEC_LOADED устанавливает spec и не трогает маски', () => {
    const next = reducer(initialState, { type: 'SPEC_LOADED', doc: spec });
    expect(next.spec).toBe(spec);
    expect(next.blockedMask).toBeNull();
    expect(next.presetMask).toBeNull();
  });
});

// Подзадача 15: ошибки чтения preset-файла (ТЗ 05 §2.2) хранятся в ui.presetFileErrors
// и пробрасываются GridCanvas в validateAll — проверяем жизненный цикл флага.
import { parsePresetMask } from '../../src/lib/maskText';

describe('editorStore: presetFileErrors (ТЗ 05 §2.2)', () => {
  it('MASK_LOADED(preset) сохраняет ошибки чтения файла', () => {
    const withSpec = reducer(initialState, { type: 'SPEC_LOADED', doc: spec });
    const { mask, errors } = parsePresetMask('A.Z\n...', 3, 2, ['R']); // «Z» — чужой символ
    expect(errors).toHaveLength(1);
    const next = reducer(withSpec, {
      type: 'MASK_LOADED',
      kind: 'preset',
      mask,
      fileName: 'preset_example.txt',
      presetErrors: errors,
    });
    expect(next.ui.presetFileErrors).toEqual(errors);
  });

  it('загрузка blocked-маски не сбрасывает ошибки preset-файла', () => {
    const withSpec = reducer(initialState, { type: 'SPEC_LOADED', doc: spec });
    const { mask, errors } = parsePresetMask('A.Z\n...', 3, 2, ['R']);
    let next = reducer(withSpec, { type: 'MASK_LOADED', kind: 'preset', mask, presetErrors: errors });
    const blockedMask = { width: 10, height: 8, cells: Array.from({ length: 8 }, () => Array(10).fill('free' as const)) };
    next = reducer(next, { type: 'MASK_LOADED', kind: 'blocked', mask: blockedMask });
    expect(next.ui.presetFileErrors).toEqual(errors);
  });

  it('MASK_CLEARED(preset) и GRID_RESIZE сбрасывают ошибки чтения', () => {
    const withSpec = reducer(initialState, { type: 'SPEC_LOADED', doc: spec });
    const { mask, errors } = parsePresetMask('A.Z\n...', 3, 2, ['R']);
    let next = reducer(withSpec, { type: 'MASK_LOADED', kind: 'preset', mask, presetErrors: errors });
    expect(next.ui.presetFileErrors).toHaveLength(1);

    const cleared = reducer(next, { type: 'MASK_CLEARED', kind: 'preset' });
    expect(cleared.ui.presetFileErrors).toEqual([]);

    const resized = reducer(next, { type: 'GRID_RESIZE', w: 4, h: 2 });
    expect(resized.ui.presetFileErrors).toEqual([]);
  });
});
