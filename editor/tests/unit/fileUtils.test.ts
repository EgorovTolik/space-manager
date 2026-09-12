// Unit-тесты lib/fileUtils.ts: имена скачиваемых файлов (ТЗ 02 §6), сумма долей
// (ТЗ 04 §4), проверки форм ввода (ТЗ 05 §2.4), пары adjacency (ТЗ 04 §6) и
// отнесение ошибок к маске (ТЗ 05 §3 п.3). downloadTextFile (DOM) не покрывается.
import { describe, expect, it } from 'vitest';
import {
  clustersPercentSum,
  formatNumber,
  isValidTypeId,
  maskDownloadName,
  maskErrorsFor,
  pairKey,
  pairsContain,
  parseAreaPercent,
  specDownloadName,
  symbolError,
} from '../../src/lib/fileUtils';
import type { ValidationError } from '../../src/lib/types';

describe('specDownloadName (ТЗ 02 §6)', () => {
  it('использует имя исходно загруженного файла', () => {
    expect(specDownloadName('spec_basic.yaml')).toBe('spec_basic.yaml');
  });
  it('созданная «с нуля» спека скачивается как spec.yaml', () => {
    expect(specDownloadName(null)).toBe('spec.yaml');
    expect(specDownloadName('')).toBe('spec.yaml');
  });
});

describe('maskDownloadName (ТЗ 02 §6: поле спеки → исходное имя → дефолт)', () => {
  it('поле спеки имеет приоритет', () => {
    expect(maskDownloadName('blocked_basic.txt', 'other.txt', 'blocked.txt')).toBe('blocked_basic.txt');
  });
  it('без поля спеки — basename исходного файла', () => {
    expect(maskDownloadName(null, 'my_preset.txt', 'preset.txt')).toBe('my_preset.txt');
  });
  it('без всего — дефолтное имя', () => {
    expect(maskDownloadName(null, null, 'blocked.txt')).toBe('blocked.txt');
    expect(maskDownloadName('', '', 'preset.txt')).toBe('preset.txt');
  });
});

describe('clustersPercentSum / formatNumber (ТЗ 04 §4)', () => {
  it('суммирует доли', () => {
    expect(clustersPercentSum([{ id: 'a', type: 'T', areaPercent: 26, shape: 'free' }])).toBe(26);
    expect(
      clustersPercentSum([
        { id: 'a', type: 'T', areaPercent: 26, shape: 'free' },
        { id: 'b', type: 'T', areaPercent: 15, shape: 'free' },
        { id: 'c', type: 'T', areaPercent: 10, shape: 'circle' },
      ]),
    ).toBe(51);
  });
  it('дробные доли округляются до 2 знаков (33.33+33.33+33.34 = 100)', () => {
    expect(
      clustersPercentSum([
        { id: 'a', type: 'T', areaPercent: 33.33, shape: 'free' },
        { id: 'b', type: 'T', areaPercent: 33.33, shape: 'free' },
        { id: 'c', type: 'T', areaPercent: 33.34, shape: 'free' },
      ]),
    ).toBe(100);
  });
  it('пустой список — 0', () => {
    expect(clustersPercentSum([])).toBe(0);
  });
  it('formatNumber без хвостовых нулей', () => {
    expect(formatNumber(51)).toBe('51');
    expect(formatNumber(51.5)).toBe('51.5');
    expect(formatNumber(51.234)).toBe('51.23');
  });
});

describe('isValidTypeId (ТЗ 05 §2.4: [A-Za-z][A-Za-z0-9_]*)', () => {
  it('корректные id', () => {
    expect(isValidTypeId('ROOM')).toBe(true);
    expect(isValidTypeId('room_1')).toBe(true);
    expect(isValidTypeId('A')).toBe(true);
  });
  it('некорректные id', () => {
    expect(isValidTypeId('')).toBe(false);
    expect(isValidTypeId('1abc')).toBe(false);
    expect(isValidTypeId('ab-c')).toBe(false); // дефис допустим только в id кластеров
    expect(isValidTypeId('a b')).toBe(false);
  });
});

describe('parseAreaPercent (ТЗ 05 §2.4: 0 < x ≤ 100, до 2 знаков)', () => {
  it('корректные значения', () => {
    expect(parseAreaPercent('50')).toBe(50);
    expect(parseAreaPercent('100')).toBe(100);
    expect(parseAreaPercent('0.5')).toBe(0.5);
    expect(parseAreaPercent(' 33 ')).toBe(33); // пробелы по краям допускаются
    expect(parseAreaPercent('1.23')).toBe(1.23);
  });
  it('некорректные значения', () => {
    expect(parseAreaPercent('0')).toBeNull();
    expect(parseAreaPercent('100.01')).toBeNull();
    expect(parseAreaPercent('-5')).toBeNull();
    expect(parseAreaPercent('1.234')).toBeNull(); // 3 знака после запятой
    expect(parseAreaPercent('abc')).toBeNull();
    expect(parseAreaPercent('1,5')).toBeNull(); // запятая не поддерживается (ТЗ 02 §4 п.3)
    expect(parseAreaPercent('')).toBeNull();
  });
});

describe('symbolError (ТЗ 04 §5)', () => {
  const types = { ROOM: { symbol: 'R', name: null }, CORRIDOR: { symbol: 'C', name: null } };

  it('новый уникальный символ — ок', () => {
    expect(symbolError('W', types)).toBeNull();
  });
  it('пустой/многозначный — invalid', () => {
    expect(symbolError('', types)).toBe('invalid');
    expect(symbolError('ab', types)).toBe('invalid');
  });
  it('зарезервированные «.» и «*» — reserved', () => {
    expect(symbolError('.', types)).toBe('reserved');
    expect(symbolError('*', types)).toBe('reserved');
  });
  it('дубликат символа другого типа — duplicate', () => {
    expect(symbolError('C', types, 'ROOM')).toBe('duplicate');
  });
  it('свой же символ при редактировании не считается дубликатом', () => {
    expect(symbolError('R', types, 'ROOM')).toBeNull();
  });
});

describe('pairKey / pairsContain (ТЗ 04 §6: пары неупорядоченные)', () => {
  it('A×B = B×A', () => {
    expect(pairKey('A', 'B')).toBe(pairKey('B', 'A'));
  });
  it('находит пару в любом порядке', () => {
    const pairs: [string, string][] = [['ROOM', 'CORRIDOR']];
    expect(pairsContain(pairs, 'ROOM', 'CORRIDOR')).toBe(true);
    expect(pairsContain(pairs, 'CORRIDOR', 'ROOM')).toBe(true);
  });
  it('нет ложных срабатываний на подстроки', () => {
    const pairs: [string, string][] = [['AB', 'C']];
    expect(pairsContain(pairs, 'ABC', '')).toBe(false);
    expect(pairsContain(pairs, 'A', 'BC')).toBe(false);
  });
  it('пустой список — нет пар', () => {
    expect(pairsContain([], 'A', 'B')).toBe(false);
  });
});

describe('maskErrorsFor (ТЗ 05 §3 п.3: ошибки ЭТОЙ маски)', () => {
  const errors: ValidationError[] = [
    { code: 'V-MASK-DIM', field: 'blockedFile', message: 'b-dim' },
    { code: 'V-MASK-DIM', field: 'presetFile', message: 'p-dim' },
    { code: 'V-MASK-PRESET', message: 'preset-символ' },
    { code: 'V-MASK-CONFLICT', message: 'конфликт', cells: [[0, 0]] },
    { code: 'V-CLUST-SUM', message: 'не про маски' },
  ];

  it('blocked: V-MASK-DIM(blockedFile) + V-MASK-CONFLICT', () => {
    const codes = maskErrorsFor(errors, 'blocked').map((e) => e.code);
    expect(codes).toContain('V-MASK-DIM');
    expect(codes).toContain('V-MASK-CONFLICT');
    expect(codes).not.toContain('V-MASK-PRESET');
  });
  it('preset: V-MASK-DIM(presetFile) + V-MASK-PRESET + V-MASK-CONFLICT', () => {
    const got = maskErrorsFor(errors, 'preset');
    expect(got.map((e) => e.code).sort()).toEqual(['V-MASK-CONFLICT', 'V-MASK-DIM', 'V-MASK-PRESET']);
  });
  it('ошибки спеки не относятся ни к одной маске', () => {
    expect(maskErrorsFor([{ code: 'V-CLUST-SUM', message: 'x' }], 'blocked')).toHaveLength(0);
    expect(maskErrorsFor([{ code: 'V-CLUST-SUM', message: 'x' }], 'preset')).toHaveLength(0);
  });
});
