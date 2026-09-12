// lib/fileUtils.ts — чистые помощники панелей и проверки форм ввода (ТЗ 02 §6/§7,
// 04 §4/§5/§6, 05 §2.4/§3). Модуль без React; единственная функция с DOM-эффектом —
// downloadTextFile (тонкая обёртка Blob + <a download>), она не покрывается unit-тестами.

import type { ClusterEntry, TypeDef, ValidationError } from './types';

/** Скачивание текстового файла браузером: Blob + <a download> (ТЗ 04 §1). */
export function downloadTextFile(name: string, content: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Имя спеки при скачивании (ТЗ 02 §6): имя исходного файла; создана «с нуля» → spec.yaml. */
export function specDownloadName(originalName: string | null): string {
  return originalName && originalName.length > 0 ? originalName : 'spec.yaml';
}

/**
 * Имя маски при скачивании (ТЗ 02 §6, приоритет):
 * значение поля спеки (blockedFile/presetFile) → basename исходно загруженной маски → дефолт.
 */
export function maskDownloadName(
  specField: string | null,
  originalName: string | null,
  fallback: string,
): string {
  if (specField && specField.length > 0) return specField;
  if (originalName && originalName.length > 0) return originalName;
  return fallback;
}

/** Сумма долей кластеров для строки «Сумма долей» (ТЗ 04 §4); округление до 2 знаков. */
export function clustersPercentSum(clusters: ClusterEntry[]): number {
  let sum = 0;
  for (const c of clusters) sum += c.areaPercent;
  return Math.round(sum * 100) / 100;
}

/** Формат числа для UI: до 2 знаков, без хвостовых нулей («51», «51.5», «51.23»). */
export function formatNumber(v: number): string {
  return String(Math.round(v * 100) / 100);
}

// ── Проверки форм ввода (ТЗ 05 §2.4) ────────────────────────────────────────────

const TYPE_ID_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

/** id типа: не пустой, `[A-Za-z][A-Za-z0-9_]*` (уникальность проверяет вызывающий). */
export function isValidTypeId(id: string): boolean {
  return TYPE_ID_RE.test(id);
}

const AREA_PERCENT_RE = /^\d+(\.\d{1,2})?$/;

/** areaPercent: число, 0 < x ≤ 100, до 2 знаков после запятой (запятая не поддерживается). null — вне правила. */
export function parseAreaPercent(input: string): number | null {
  const s = input.trim();
  if (!AREA_PERCENT_RE.test(s)) return null;
  const v = Number(s);
  if (!(v > 0 && v <= 100)) return null;
  return v;
}

export type SymbolErrorKind = 'invalid' | 'reserved' | 'duplicate';

/** symbol типа: ровно 1 символ, ≠ «.» и «*», уникален среди типов (ТЗ 04 §5). null — корректен. */
export function symbolError(
  symbol: string,
  types: Record<string, TypeDef>,
  excludeTypeId?: string,
): SymbolErrorKind | null {
  if (symbol.length !== 1) return 'invalid';
  if (symbol === '.' || symbol === '*') return 'reserved';
  for (const [id, def] of Object.entries(types)) {
    if (id !== excludeTypeId && def.symbol === symbol) return 'duplicate';
  }
  return null;
}

// ── Пары adjacency (неупорядоченные, A×B = B×A — ТЗ 04 §6) ──────────────────────

/** Нормализованный ключ неупорядоченной пары типов. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

/** Содержится ли пара (в любом порядке) в списке. */
export function pairsContain(pairs: [string, string][], a: string, b: string): boolean {
  const key = pairKey(a, b);
  return pairs.some(([x, y]) => pairKey(x, y) === key);
}

// ── Отнесение ошибок к маске (ТЗ 05 §3 п.3) ─────────────────────────────────────
// Скачивание маски — с подтверждением, если есть ошибки ЭТОЙ маски:
// V-MASK-DIM по соответствующему полю + V-MASK-PRESET (только preset) +
// кросс-масочная V-MASK-CONFLICT относится к обеим маскам.

export function maskErrorsFor(errors: ValidationError[], kind: 'blocked' | 'preset'): ValidationError[] {
  const field = kind === 'blocked' ? 'blockedFile' : 'presetFile';
  return errors.filter((e) => {
    if (e.code === 'V-MASK-CONFLICT') return true;
    if (e.code === 'V-MASK-DIM') return e.field === field;
    if (kind === 'preset' && e.code === 'V-MASK-PRESET') return true;
    return false;
  });
}
