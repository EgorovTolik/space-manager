// Панель «Файл» (ТЗ 04 §2) — заглушка скелета: заголовок + статус.
// Реализация загрузки (FileReader, drag&drop, ошибки V-*) — подзадача после парсера.

import { useViewer } from '../state/viewerStore';
import { ru } from '../i18n/ru';

export function FilePanel() {
  const { state } = useViewer();
  return (
    <section className="panel panel-files" aria-label={ru.panelFiles}>
      <h2>{ru.panelFiles}</h2>
      <div className="muted">{ru.fileStatus}</div>
      <button type="button" disabled title={state.report ? undefined : ru.disabledHint}>
        {ru.loadReportButton}
      </button>
      {state.report === null ? (
        <div className="muted">{ru.noReportLoaded}</div>
      ) : (
        <ul className="file-status">
          <li>
            {ru.fileNameLabel} {state.fileName ?? '—'}
          </li>
          <li>
            {ru.gridStatusLabel}{' '}
            {ru.gridStatus(state.report.width, state.report.height)}
          </li>
          <li>
            {ru.roomsStatusLabel} {state.report.rooms.length}
          </li>
        </ul>
      )}
    </section>
  );
}
