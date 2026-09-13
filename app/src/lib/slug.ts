// Чистая валидация имени проекта (slug) — регламент ТЗ 02 §3.1: ^[a-z0-9_-]{1,40}$.
// Вынесена отдельно от React ради unit-тестов без DOM.

export const SLUG_RE = /^[a-z0-9_-]{1,40}$/;

/** true, если имя проходит регламент slug (ТЗ 02 §3.1). */
export function isValidSlug(name: string): boolean {
  return SLUG_RE.test(name);
}
