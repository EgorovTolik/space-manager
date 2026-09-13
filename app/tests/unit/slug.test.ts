// Валидация имён проекта на клиенте (ТЗ 05 §2: CreateProjectForm/RenameDialog).
// Замечание 2: display-name — произвольное (1..64, без «/» и \0); slug — регламент ТЗ 02 §3.1.
import { describe, expect, it } from 'vitest';

import { isValidProjectName, isValidSlug, SLUG_RE } from '../../src/lib/slug';

describe('isValidSlug', () => {
  it.each(['a', 'abc_1-2', 'a-z_9', 'demo-project', 'x'.repeat(40)] as const)(
    'зелёные: %s',
    (name) => {
      expect(isValidSlug(name)).toBe(true);
    },
  );

  it.each(['', 'Abc', 'a b', 'привет', '..', '.', 'x'.repeat(41), 'a/b', 'a.b', '-_.'] as const)(
    'красные: %s',
    (name) => {
      expect(isValidSlug(name)).toBe(false);
    },
  );

  it('regex совпадает с регламентом ТЗ 02 §3.1', () => {
    expect(SLUG_RE.source).toBe('^[a-z0-9_-]{1,40}$');
  });
});

describe('isValidProjectName (замечание 2)', () => {
  it.each([
    'a',
    'Demo',
    'Офис Б-2',
    'Офис с пробелом и регистром MiXeD',
    'проект №1 (основной)',
    'x'.repeat(64),
  ] as const)('зелёные: %s', (name) => {
    expect(isValidProjectName(name)).toBe(true);
  });

  it.each([
    '',
    'a/b',
    '/x',
    'x/',
    'a\u0000b',
    'x'.repeat(65),
  ] as const)('красные: %s', (name) => {
    expect(isValidProjectName(name)).toBe(false);
  });

  it('non-string → false', () => {
    expect(isValidProjectName(null)).toBe(false);
    expect(isValidProjectName(undefined)).toBe(false);
    expect(isValidProjectName(42)).toBe(false);
  });
});
