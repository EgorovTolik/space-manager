// Легенда (ТЗ 04 §5): чип цвета + символ + type_id (если известен) — в порядке
// палитры (первое растровое появление символа на карте).

import { useMemo } from 'react';
import { useViewer } from '../state/viewerStore';
import { symbolPalette, UNKNOWN_SYMBOL_COLOR } from '../lib/palette';
import { ru } from '../i18n/ru';

export function Legend() {
  const { state } = useViewer();
  const report = state.report;

  // Порядок — палитровый (ТЗ 02 §8): первое появление символа в растровом обходе;
  // rooms уже в этом порядке, typeId берём из первой комнаты этого символа с типом.
  const entries = useMemo(() => {
    if (report === null) return [];
    const palette = symbolPalette(report.map);
    const seen = new Set<string>();
    const out: Array<{ symbol: string; color: string; typeId: string | null }> = [];
    for (const room of report.rooms) {
      if (seen.has(room.symbol)) continue;
      seen.add(room.symbol);
      const typed = report.rooms.find((r) => r.symbol === room.symbol && r.typeId !== null);
      out.push({ symbol: room.symbol, color: palette.get(room.symbol) ?? UNKNOWN_SYMBOL_COLOR, typeId: typed?.typeId ?? null });
    }
    return out;
  }, [report]);

  return (
    <section className="panel panel-legend" aria-label={ru.panelLegend}>
      <h2>{ru.panelLegend}</h2>
      {entries.length === 0 ? (
        <div className="muted">{ru.legendEmpty}</div>
      ) : (
        entries.map((entry) => (
          <div className="legend-row" key={entry.symbol}>
            <span className="chip" style={{ background: entry.color }} />
            <span>{entry.symbol}</span>
            <span>→</span>
            <span>{entry.typeId ?? ru.dash}</span>
          </div>
        ))
      )}
    </section>
  );
}
