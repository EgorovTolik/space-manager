// Unit-тесты палитры preset-редактора (src/lib/typeColors.ts, ТЗ 04 §3.3).
import { describe, it, expect } from 'vitest';
import { TYPE_COLORS, buildTypePalette, textColorFor } from '../../src/lib/typeColors';

describe('TYPE_COLORS — фиксированная палитра (ТЗ 04 §3.3)', () => {
  it('ровно 20 различимых цветов', () => {
    expect(TYPE_COLORS).toHaveLength(20);
    expect(new Set(TYPE_COLORS).size).toBe(20);
  });
});

describe('buildTypePalette — цвет по порядку добавления, без коллизий', () => {
  it('первым трём типам — первые три цвета палитры', () => {
    const p = buildTypePalette([
      ['ROOM', { symbol: 'R' }],
      ['WALL', { symbol: 'W' }],
      ['CORE', { symbol: 'C' }],
    ]);
    expect(p.byType.get('ROOM')).toBe(TYPE_COLORS[0]);
    expect(p.byType.get('WALL')).toBe(TYPE_COLORS[1]);
    expect(p.byType.get('CORE')).toBe(TYPE_COLORS[2]);
  });

  it('цвет доступен и по символу (клетки preset хранят символ)', () => {
    const p = buildTypePalette([['ROOM', { symbol: 'R' }]]);
    expect(p.bySymbol.get('R')).toBe(TYPE_COLORS[0]);
    expect(p.symbolToType.get('R')).toBe('ROOM');
  });

  it('пустой реестр → пустые карты', () => {
    const p = buildTypePalette([]);
    expect(p.byType.size).toBe(0);
    expect(p.bySymbol.size).toBe(0);
  });

  it('текст на светлом фоне — тёмный, на остальных — белый', () => {
    expect(textColorFor('#f0e442')).toBe('#1a1a1a');
    expect(textColorFor(TYPE_COLORS[0])).toBe('#ffffff');
  });
});
