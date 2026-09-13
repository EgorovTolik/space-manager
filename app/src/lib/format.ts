// Чистые формatters и конструкторы навигационных путей (ТЗ 03 §1/§2).
// Без React/DOM — ради unit-тестов.

const p2 = (n: number): string => String(n).padStart(2, '0');

/** ISO → «DD.MM.YYYY HH:mm» локального времени (ТЗ 03 §1); null/битое → «—». */
export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

/** Байты → «N Б» / «N КБ» / «N.N МБ» (ТЗ 03 §1: «47 КБ»). */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

/** Ссылка на редактор проекта (ТЗ 03 §6, 04 §2.5). */
export function editorPath(name: string): string {
  return `/editor?project=${encodeURIComponent(name)}`;
}

/**
 * Ссылка на viewer3d (ТЗ 03 §6, 04 §3.5): `?result=` добавляется только если
 * у проекта есть latestResult.
 */
export function viewerPath(name: string, latestResult: string | null): string {
  const base = `/viewer3d?project=${encodeURIComponent(name)}`;
  return latestResult ? `${base}&result=${encodeURIComponent(latestResult)}` : base;
}

/** URL картинки предпросмотра (ТЗ 02 §6.13). */
export function previewUrl(projectName: string, fileName: string): string {
  return `/api/projects/${encodeURIComponent(projectName)}/preview?file=${encodeURIComponent(fileName)}`;
}
