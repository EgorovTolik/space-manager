// Карточка выбранной комнаты (ТЗ 04 §6): метка, символ/тип, клетки, площадь (size·S²),
// габариты bbox ((x1−x0+1)·S × (y1−y0+1)·S), строка таблицы (если сопоставлена),
// кнопка «Снять выделение».

import { useMemo } from 'react';
import { useViewer } from '../state/viewerStore';
import { symbolPalette, UNKNOWN_SYMBOL_COLOR } from '../lib/palette';
import { ru } from '../i18n/ru';

export function InfoPanel() {
  const { state, dispatch } = useViewer();
  const report = state.report;
  const room =
    report !== null && state.selection !== null
      ? report.rooms.find((r) => r.index === state.selection) ?? null
      : null;

  const palette = useMemo(
    () => (report === null ? new Map<string, string>() : symbolPalette(report.map)),
    [report],
  );

  return (
    <section className="panel panel-info" aria-label={ru.panelInfo}>
      <h2>{ru.panelInfo}</h2>
      {room === null || report === null ? (
        <div className="muted">{ru.infoNoSelection}</div>
      ) : (
        <div>
          <strong>{room.label}</strong>
          <div>
            <span className="chip" style={{ background: palette.get(room.symbol) ?? UNKNOWN_SYMBOL_COLOR }} />
            {ru.infoSymbolTypeLine(room.symbol, room.typeId)}
          </div>
          <div>
            {ru.infoCellsLabel} {room.size} · {ru.infoAreaLabel}{' '}
            {ru.areaValue(room.size * state.params.scale ** 2, state.params.unitLabel)}
          </div>
          <div>
            {ru.infoBboxLabel}{' '}
            {ru.bboxValue(
              (room.bbox.x1 - room.bbox.x0 + 1) * state.params.scale,
              (room.bbox.y1 - room.bbox.y0 + 1) * state.params.scale,
              state.params.unitLabel,
            )}
          </div>
          {room.tableRow !== null && (
            <div className="info-table-row">
              <div>{ru.infoTableRowTitle}</div>
              <div>
                {ru.infoTableRowLine(
                  room.tableRow.share,
                  room.tableRow.target,
                  room.tableRow.actual,
                  room.tableRow.deviation,
                  room.tableRow.status,
                )}
              </div>
            </div>
          )}
          <button type="button" onClick={() => dispatch({ type: 'SELECT_ROOM', roomId: null })}>
            {ru.deselectButton}
          </button>
        </div>
      )}
    </section>
  );
}
