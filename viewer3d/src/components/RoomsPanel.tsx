// Список комнат (ТЗ 04 §5) — заглушка скелета: заголовок + число комнат.
// Таблица (метка/символ/тип/клетки/площадь/статус), выбор и фокус камеры,
// блок unmatchedRows — подзадача 5.

import { useViewer } from '../state/viewerStore';
import { ru } from '../i18n/ru';

export function RoomsPanel() {
  const { state } = useViewer();
  const rooms = state.report?.rooms ?? [];
  return (
    <section className="panel panel-rooms" aria-label={ru.panelRooms}>
      <h2>{ru.panelRooms}</h2>
      {state.report === null ? (
        <div className="muted">{ru.disabledHint}</div>
      ) : rooms.length === 0 ? (
        <div className="muted">{ru.noRooms}</div>
      ) : (
        <ul className="rooms-list">
          {rooms.map((room) => (
            <li key={room.index}>
              {room.label} · {room.symbol} · {room.size} кл.
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
