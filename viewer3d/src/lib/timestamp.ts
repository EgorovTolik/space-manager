// Имя PNG-снапшота (ТЗ 04 §10): viewer3d-snapshot-<YYYYmmdd-HHMMSS>.png —
// тот же формат timestamp, что у CLI-отчётов (cli.py::default_result_name).

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

/** Компактный timestamp YYYYmmdd-HHMMSS из объекта Date (параметр — ради тестируемости). */
export function snapshotTimestamp(d: Date): string {
  return (
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}` +
    `-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
  );
}

/** Имя файла снапшота; без аргумента — текущее время. */
export function snapshotFileName(d: Date = new Date()): string {
  return `viewer3d-snapshot-${snapshotTimestamp(d)}.png`;
}

/**
 * Имя PNG-предпросмотра проекта (docs-unified/04 §2.4): preview-<YYYYmmdd-HHMMSS>.png.
 * Формат timestamp тот же; имя задаёт сервер (02 §6.13), клиентское имя — только
 * для fallback-скачивания и статусов UI.
 */
export function previewFileName(d: Date = new Date()): string {
  return `preview-${snapshotTimestamp(d)}.png`;
}
