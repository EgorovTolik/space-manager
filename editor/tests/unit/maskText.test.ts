// Unit-тесты lib/maskText.ts (подзадача 12).
// Критерии: побайтовый round-trip на канонических эталонах examples;
// терпимое чтение свободных символов; V-MASK-DIM при неверной размерности;
// V-MASK-PRESET — файл загружается, клетки помечаются (ТЗ 05 §2.2).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  dumpMask,
  MaskParseError,
  maskFileDims,
  parseBlockedMask,
  parseBlockedMaskAny,
  parsePresetMask,
  parsePresetMaskAny,
} from '../../src/lib/maskText';

const EXAMPLES = new URL('../../../examples/', import.meta.url);
function readExample(name: string): string {
  return readFileSync(fileURLToPath(new URL(name, EXAMPLES)), 'utf-8');
}

describe('maskText: побайтовый round-trip эталонов examples (ТЗ 02 §5)', () => {
  it('blocked_basic.txt (10×10) идентичен побайтово', () => {
    const text = readExample('blocked_basic.txt');
    const mask = parseBlockedMask(text, 10, 10);
    expect(dumpMask(mask)).toBe(text);
  });

  it('blocked_touchall.txt (12×12) идентичен побайтово', () => {
    const text = readExample('blocked_touchall.txt');
    const mask = parseBlockedMask(text, 12, 12);
    expect(dumpMask(mask)).toBe(text);
  });

  it('preset_example.txt (10×10) идентичен побайтово', () => {
    const text = readExample('preset_example.txt');
    // Символы, реально используемые в этом эталоне: A и B.
    const { mask, invalidCells, errors } = parsePresetMask(text, 10, 10, ['A', 'B']);
    expect(invalidCells).toEqual([]);
    expect(errors).toEqual([]);
    expect(dumpMask(mask)).toBe(text);
  });

  it('preset_example.txt с чужой палитрой: A/B становятся V-MASK-PRESET', () => {
    const text = readExample('preset_example.txt');
    const { invalidCells, errors } = parsePresetMask(text, 10, 10, ['R']);
    // в эталоне 8 клеток A + 3 клетки B
    expect(invalidCells.length).toBe(11);
    expect(errors[0].code).toBe('V-MASK-PRESET');
    expect(errors[0].cells).toEqual(invalidCells);
    expect(errors[0].message).toContain('(2, 0)'); // первая клетка A (x=2, y=0)
  });
});

describe('maskText: терпимость чтения', () => {
  it('пробел и «-» читаются как свободные клетки (blocked)', () => {
    const text = '* -\n*..\n';
    const mask = parseBlockedMask(text, 3, 2);
    expect(mask.cells).toEqual([
      ['blocked', 'free', 'free'],
      ['blocked', 'free', 'free'],
    ]);
    // запись — каноническая '.' (ТЗ 02 §5)
    expect(dumpMask(mask)).toBe('*..\n*..\n');
  });

  it('CRLF-переводы строк читаются без ошибок', () => {
    const text = '*..\r\n...\r\n';
    const mask = parseBlockedMask(text, 3, 2);
    expect(dumpMask(mask)).toBe('*..\n...\n');
  });

  it('отсутствие завершающего \\n допустимо при чтении', () => {
    const mask = parseBlockedMask('..*.', 4, 1);
    expect(mask.cells).toEqual([['free', 'free', 'blocked', 'free']]);
  });
});

describe('maskText: V-MASK-DIM (неверная размерность → исключение)', () => {
  it('меньше строк, чем height', () => {
    expect(() => parseBlockedMask('..\n..', 2, 3)).toThrow(MaskParseError);
    try {
      parseBlockedMask('..\n..', 2, 3);
    } catch (e) {
      const err = e as MaskParseError;
      expect(err.code).toBe('V-MASK-DIM');
      expect(err.message).toContain('2×2');
      expect(err.message).toContain('2×3');
    }
  });

  it('длина строки ≠ width', () => {
    try {
      parsePresetMask('..\n...', 2, 2, ['A']);
      throw new Error('не должно было бросить');
    } catch (e) {
      expect(e).toBeInstanceOf(MaskParseError);
      expect((e as MaskParseError).code).toBe('V-MASK-DIM');
    }
  });

  it('пустой файл', () => {
    expect(() => parseBlockedMask('', 3, 3)).toThrow(MaskParseError);
    expect(() => parsePresetMask('', 3, 3, ['A'])).toThrow(MaskParseError);
  });
});

describe('maskText: V-MASK-PRESET (файл загружается, клетки помечаются)', () => {
  it('неизвестный символ → free в модели + ошибка с координатами', () => {
    const text = '.X.\n.A.\n';
    const { mask, invalidCells, errors } = parsePresetMask(text, 3, 2, ['A']);
    expect(invalidCells).toEqual([[1, 0]]);
    expect(mask.cells[0]).toEqual([{ kind: 'free' }, { kind: 'free' }, { kind: 'free' }]);
    expect(mask.cells[1]).toEqual([
      { kind: 'free' },
      { kind: 'preset', symbol: 'A' },
      { kind: 'free' },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('V-MASK-PRESET');
    expect(errors[0].message).toContain('(1, 0)');
    expect(errors[0].message).toMatch(/Исправьте ластиком или перезагрузите файл/);
    // dump: неизвестный символ не сохраняется (клетка — free → '.')
    expect(dumpMask(mask)).toBe('...\n.A.\n');
  });

  it('более 5 клеток: сообщение сокращается «… и ещё N клеток» (ТЗ 05 §5)', () => {
    const text = 'XXXXX\n.....\n';
    const { errors, invalidCells } = parsePresetMask(text, 5, 2, ['A']);
    expect(invalidCells).toHaveLength(5);
    // ровно 5 — без сокращения
    expect(errors[0].message).not.toContain('и ещё');

    const text7 = 'XXXXXXX\n.......\n';
    const { errors: e7, invalidCells: c7 } = parsePresetMask(text7, 7, 2, ['A']);
    expect(c7).toHaveLength(7);
    expect(e7[0].message).toContain('… и ещё 2 клеток');
  });
});

describe('maskText: каноническая запись dumpMask', () => {
  it('последняя строка — с завершающим \\n, без пробелов в концах строк', () => {
    const mask = parseBlockedMask('..\n.*\n', 2, 2);
    const text = dumpMask(mask);
    expect(text.endsWith('\n')).toBe(true);
    expect(text.split('\n').slice(0, -1)).toEqual(['..', '.*']);
  });

  it('preset-карта: свободные клетки пишутся как «.»', () => {
    const { mask } = parsePresetMask('A B\n...', 3, 2, ['A']);
    expect(dumpMask(mask)).toBe('A..\n...\n');
  });
});

// ── Чтение «в собственном размере» (подзадача 15: файлы с несовпадающим размером
//    загружаются тоже — V-MASK-DIM фиксирует несоответствие, ТЗ 04 §3.5 / 05 §2.1) ──

describe('maskText: чтение в собственном размере (parse*Any)', () => {
  it('маска меньшего размера читается в своих размерностях', () => {
    const mask = parseBlockedMaskAny('**.\n...\n');
    expect(mask.width).toBe(3);
    expect(mask.height).toBe(2);
    expect(mask.cells[0]).toEqual(['blocked', 'blocked', 'free']);
  });

  it('preset-карта с чужими символами: файл загружается, клетки — free + ошибки', () => {
    const res = parsePresetMaskAny('A.Z\n...\n', ['A']);
    expect(res.mask.width).toBe(3);
    expect(res.invalidCells).toEqual([[2, 0]]); // 'Z' — третий символ строки (x=2)
    expect(res.errors[0].code).toBe('V-MASK-PRESET');
  });

  it('рваный (непрямоугольный) файл отклоняется с V-MASK-DIM', () => {
    expect(() => parseBlockedMaskAny('**\n***\n')).toThrowError(MaskParseError);
    try {
      parseBlockedMaskAny('**\n***\n');
    } catch (e) {
      expect((e as MaskParseError).code).toBe('V-MASK-DIM');
    }
  });

  it('пустой файл отклоняется с V-MASK-DIM', () => {
    expect(() => parseBlockedMaskAny('\n')).toThrowError(MaskParseError);
  });

  it('maskFileDims: прямоугольник / рваный / пустой', () => {
    expect(maskFileDims('abcd\nefgh\n')).toEqual({ width: 4, height: 2 });
    expect(maskFileDims('abc\ndefg\n')).toBeNull();
    expect(maskFileDims('')).toBeNull();
  });
});
