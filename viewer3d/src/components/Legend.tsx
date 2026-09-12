// Легенда symbol → цвет → type_id (ТЗ 04 §5) — заглушка скелета.
// Чипы палитры по комнатам отчёта — подзадача 5.

import { useViewer } from '../state/viewerStore';
import { ru } from '../i18n/ru';

export function Legend() {
  const { state } = useViewer();
  return (
    <section className="panel panel-legend" aria-label={ru.panelLegend}>
      <h2>{ru.panelLegend}</h2>
      <div className="muted">{state.report === null ? ru.legendEmpty : '…'}</div>
    </section>
  );
}
