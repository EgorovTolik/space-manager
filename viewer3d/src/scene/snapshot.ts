// Реестр PNG-снапшота (ТЗ 04 §10 + docs-unified/04 §2.4): компонент внутри Canvas
// регистрирует функцию снятия кадра; кнопка тулбара вызывает её без прямого доступа
// к R3F. В проектном режиме рядом с обработчиком хранится ЦЕЛЬ сохранения
// (setSnapshotTarget) — результат уходит в preview/ проекта, а не на диск.

/**
 * Результат снапшота (docs-unified/04 §2.4):
 * - savedToProject — PNG сохранён в проект, поле = имя файла от сервера (preview-<ts>.png);
 * - downloaded    — fallback: локальное скачивание (проект не выбран — только dev),
 *                   поле = имя скачанного файла;
 * - error         — POST preview завершился ошибкой API (баннер в панели).
 */
export type SnapshotResult =
  | { savedToProject: string }
  | { downloaded: string }
  | { error: string };

type SnapshotFn = () => Promise<SnapshotResult | null>;

let current: SnapshotFn | null = null;
let target: { projectName: string } | null = null;
const listeners = new Set<(result: SnapshotResult) => void>();

/** Регистрация/снятие обработчика (вызывается из компонента внутри <Canvas>). */
export function setSnapshotHandler(fn: SnapshotFn | null): void {
  current = fn;
}

/**
 * Цель сохранения (docs-unified/04 §2.2): вызывается из ProjectPanel при успешной
 * загрузке ревизии; null — снять цель (fallback на скачивание).
 */
export function setSnapshotTarget(t: { projectName: string } | null): void {
  target = t;
}

/** Текущая цель сохранения (используется обработчиком кадра в сцене). */
export function getSnapshotTarget(): { projectName: string } | null {
  return target;
}

/**
 * Подписка на результат снапшота (статус/баннер панели). Возвращает функцию
 * отписки. Вызывается только для реальных результатов (не для null).
 */
export function onSnapshotResult(listener: (result: SnapshotResult) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Снять кадр. null — сцена ещё не построена или нет отрисованного кадра
 * (результаты слушателям в этом случае НЕ рассылаются).
 */
export async function takeSnapshot(): Promise<SnapshotResult | null> {
  if (current === null) return null;
  const result = await current();
  if (result !== null) {
    for (const listener of [...listeners]) listener(result);
  }
  return result;
}
