// Чистая валидация имён проекта.
//   • slug — машинный идентификатор каталога (регламент ТЗ 02 §3.1); генерируется
//     сервером, клиент его не вводит;
//   • display-name — человекочитаемое имя: любые символы кроме «/» и \0, длина 1..64
//     (замечание 2). Валидация на клиенте ДО отправки.
// Вынесено отдельно от React ради unit-тестов без DOM.

export const SLUG_RE = /^[a-z0-9_-]{1,40}$/;

/** true, если имя проходит регламент slug (ТЗ 02 §3.1). */
export function isValidSlug(name: string): boolean {
  return SLUG_RE.test(name);
}

/** Максимальная длина человекочитаемого имени проекта. */
export const DISPLAY_NAME_MAX = 64;

/** true, если имя проходит регламент display-name (1..64 символа, без «/» и \0; non-string → false). */
export function isValidProjectName(name: unknown): boolean {
  if (typeof name !== 'string') return false;
  if (name.length < 1 || name.length > DISPLAY_NAME_MAX) return false;
  if (name.includes('/') || name.includes('\0')) return false;
  return true;
}
