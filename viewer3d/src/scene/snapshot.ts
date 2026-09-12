// Реестр обработчика PNG-снапшота (ТЗ 04 §10): компонент внутри Canvas регистрирует
// функцию снятия кадра, кнопка тулбара вызывает её без прямого доступа к R3F.

type SnapshotFn = () => void;

let current: SnapshotFn | null = null;

/** Регистрация/снятие обработчика (вызывается из компонента внутри <Canvas>). */
export function setSnapshotHandler(fn: SnapshotFn | null): void {
  current = fn;
}

/** Снять кадр. false — сцена ещё не построена (обработчик не зарегистрирован). */
export function takeSnapshot(): boolean {
  if (current === null) return false;
  current();
  return true;
}
