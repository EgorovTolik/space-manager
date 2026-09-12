// Карточка выбранной комнаты (ТЗ 04 §6) — заглушка скелета.
// Полная карточка (символ/тип/клетки/площадь/bbox/строка таблицы) — подзадача 5.

import { useViewer } from '../state/viewerStore';
import { ru } from '../i18n/ru';

export function InfoPanel() {
  const { state, dispatch } = useViewer();
  const room =
    state.report !== null && state.selection !== null
      ? state.report.rooms.find((r) => r.index === state.selection) ?? null
      : null;
  return (
    <section className="panel panel-info" aria-label={ru.panelInfo}>
      <h2>{ru.panelInfo}</h2>
      {room === null ? (
        <div className="muted">{ru.infoNoSelection}</div>
      ) : (
        <div>
          <strong>{room.label}</strong>
          <div>
            {ru.infoCellsLabel} {room.size}
          </div>
          <button type="button" onClick={() => dispatch({ type: 'SELECT_ROOM', roomId: null })}>
            {ru.deselectButton}
          </button>
        </div>
      )}
    </section>
  );
}
