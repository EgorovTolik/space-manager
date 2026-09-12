// Unit-тесты палитры (ТЗ 02 §8): порядок назначения, '?' вне палитры, зацикливание.

import { describe, it, expect } from 'vitest';
import { PALETTE, UNKNOWN_SYMBOL_COLOR, symbolPalette } from '../../src/lib/palette';
import type { CellChar } from '../../src/lib/reportParser';

function row(line: string): CellChar[] {
  return Array.from(line);
}

describe('palette', () => {
  it('PALETTE — ровно 16 различимых hex-цветов', () => {
    expect(PALETTE).toHaveLength(16);
    expect(new Set(PALETTE).size).toBe(16);
    for (const c of PALETTE) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('цвета назначаются по порядку первого появления в растровом обходе', () => {
    const map: CellChar[][] = [
      row('A.B'),
      row('BA.'),
      row('.C.'),
    ];
    const palette = symbolPalette(map);
    expect(palette.get('A')).toBe(PALETTE[0]); // A появляется первой (0,0)
    expect(palette.get('B')).toBe(PALETTE[1]); // B — (0,1)
    expect(palette.get('C')).toBe(PALETTE[2]); // C — (1,2)
  });

  it("'.' и '*' цвета не получают", () => {
    const palette = symbolPalette([row('.*A')]);
    expect(palette.has('.')).toBe(false);
    expect(palette.has('*')).toBe(false);
    expect(palette.get('A')).toBe(PALETTE[0]);
  });

  it("'?' получает #808080 и не тратит индекс палитры", () => {
    const palette = symbolPalette([row('?AB')]);
    expect(palette.get('?')).toBe(UNKNOWN_SYMBOL_COLOR);
    expect(palette.get('A')).toBe(PALETTE[0]);
    expect(palette.get('B')).toBe(PALETTE[1]);
  });

  it('при > 15 типах цвета зацикливаются', () => {
    const chars = 'ABCDEFGHIJKLMNOP'; // 16 разных символов
    const palette = symbolPalette([row(chars)]);
    expect(palette.get('A')).toBe(PALETTE[0]);
    expect(palette.get('P')).toBe(PALETTE[15]);
    // 17-й символ зацикливается на первый цвет
    const palette2 = symbolPalette([row(chars + 'Q')]);
    expect(palette2.get('Q')).toBe(PALETTE[0]);
  });

  it('пустая карта → пустая палитра', () => {
    expect(symbolPalette([]).size).toBe(0);
    expect(symbolPalette([row('...')]).size).toBe(0);
  });
});
