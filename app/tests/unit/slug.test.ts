// Валидация slug на клиенте (ТЗ 05 §2: CreateProjectForm; регламент ТЗ 02 §3.1).
import { describe, expect, it } from 'vitest';

import { isValidSlug, SLUG_RE } from '../../src/lib/slug';

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
