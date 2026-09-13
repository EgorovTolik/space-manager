// Список комнат (ТЗ 04 §5): таблица (метка/символ/тип/клеток/площадь/статус),
// клик по строке → SELECT_ROOM + фокус камеры (фокус делает CameraRig по selection);
// повторный клик — снять выделение. Блок unmatchedRows под таблицей.

import { useMemo } from 'react';
import { useViewer } from '../state/viewerStore';
import { symbolPalette, UNKNOWN_SYMBOL_COLOR } from '../lib/palette';
import { ru } from '../i18n/ru';

export function RoomsPanel() {
  const { state, dispatch } = useViewer();
  const report = state.report;

  const palette = useMemo(
    () => (report === null ? new Map<string, string>() : symbolPalette(report.map)),
    [report],
  );

  if (report === null) {
    return (
      <section className="panel panel-rooms" aria-label={ru.panelRooms}>
        <h2>{ru.panelRooms}</h2>
        <div className="muted">{ru.disabledHint}</div>
      </section>
    );
  }

  const { scale, unitLabel } = state.params;
  const areasScale = scale * scale; // площадь = size · S² (ТЗ 04 §5)

  return (
    <section className="panel panel-rooms" aria-label={ru.panelRooms}>
      <h2>{ru.panelRooms}</h2>
      {report.rooms.length === 0 ? (
        <div className="muted">{ru.noRooms}</div>
      ) : (
        <div className="rooms-scroll">
          <table className="rooms-table">
            <thead>
              <tr>
                <th>{ru.roomsColLabel}</th>
                <th>{ru.roomsColSymbol}</th>
                <th>{ru.roomsColType}</th>
                <th>{ru.roomsColCells}</th>
                <th>{ru.roomsColArea}</th>
                <th>{ru.roomsColStatus}</th>
              </tr>
            </thead>
            <tbody>
              {report.rooms.map((room) => (
                <tr
                  key={room.index}
                  className={state.selection === room.index ? 'selected' : ''}
                  onClick={() =>
                    dispatch({
                      type: 'SELECT_ROOM',
                      roomId: state.selection === room.index ? null : room.index,
                    })
                  }
                >
                  <td>{room.label}</td>
                  <td>
                    <span className="chip" style={{ background: palette.get(room.symbol) ?? UNKNOWN_SYMBOL_COLOR }} />
                    {room.symbol}
                  </td>
                  <td>{room.typeId ?? ru.dash}</td>
                  <td>{room.size}</td>
                  <td>{ru.areaValue(room.size * areasScale, unitLabel)}</td>
                  <td>{room.tableRow?.status ?? ru.dash}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {report.unmatchedRows.length > 0 && (
        <div className="unmatched-block">
          <h3>{ru.unmatchedBlockTitle}</h3>
          {report.unmatchedRows.map((row) => (
            <div key={row.id}>{ru.unmatchedRowLine(row.id, row.typeId, row.actual)}</div>
          ))}
        </div>
      )}
    </section>
  );
}
