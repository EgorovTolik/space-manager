// Панель типов (ТЗ 04 §5). Реестр types {id: {symbol, name}}.
//
// Форма: id (ключ реестра; `[A-Za-z][A-Za-z0-9_]*`, уникален), symbol — ОДИН символ
// (≠ «.» и «*», без дублей — сообщения под полем, коды V-TYPE-SYMDUP/V-TYPE-RESERVED),
// name — необязательный текст.
// Удаление типа: без ссылок — немедленное с подтверждением; если тип используется
// (кластеры/adjacency/preset-клетки) — диалог ТЗ 04 §5 с каскадом: TYPE_REMOVE
// (кластеры и пары adjacency отбрасывает store) + очистка preset-клеток символа.
import { useState } from 'react';
import type { CSSProperties } from 'react';
import { ru } from '../i18n/ru';
import { useEditor } from '../state/editorStore';
import { isValidTypeId, symbolError } from '../lib/fileUtils';

const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' };
const btnStyle: CSSProperties = { cursor: 'pointer', padding: '2px 6px' };
const fieldStyle: CSSProperties = { display: 'block', marginTop: 8 };
const labelStyle: CSSProperties = { fontSize: 12, color: '#555' };
const errorStyle: CSSProperties = { color: '#c62828', fontSize: 12, marginTop: 2 };
const modalStyle: CSSProperties = {
  border: '1px solid #888',
  borderRadius: 6,
  padding: 10,
  background: '#fafafa',
  marginBottom: 10,
};

export default function TypesPanel(): JSX.Element {
  const { state, dispatch } = useEditor();
  const spec = state.spec;
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);

  if (!spec) {
    return (
      <section className="panel" style={{ padding: 8, color: '#888' }}>
        {ru.grid.noSpec}
      </section>
    );
  }

  const typeIds = Object.keys(spec.types);

  // Клетки preset-карты с символом типа (для каскадного удаления, ТЗ 04 §5).
  function presetCellsOfSymbol(symbol: string): [number, number][] {
    if (!spec) return [];
    const pm = state.presetMask;
    if (!pm) return [];
    const cells: [number, number][] = [];
    for (let y = 0; y < pm.height; y++) {
      for (let x = 0; x < pm.width; x++) {
        const c = pm.cells[y][x];
        if (c.kind === 'preset' && c.symbol === symbol) cells.push([x, y]);
      }
    }
    return cells;
  }

  function removeType(id: string): void {
    if (!spec) return;
    const def = spec.types[id];
    if (!def) return;
    const usedByClusters = spec.clusters.filter((c) => c.type === id).map((c) => c.id);
    const presetCells = presetCellsOfSymbol(def.symbol);

    if (usedByClusters.length === 0 && presetCells.length === 0) {
      // Без ссылок — немедленное удаление с подтверждением (ТЗ 04 §5).
      if (!window.confirm(ru.types.removeConfirm.replace('{id}', id))) return;
      dispatch({ type: 'TYPE_REMOVE', id });
      return;
    }

    const parts: string[] = [];
    if (usedByClusters.length > 0) parts.push(ru.types.cascadeClusters.replace('{list}', usedByClusters.join(', ')));
    if (presetCells.length > 0) parts.push(ru.types.cascadeCells.replace('{n}', String(presetCells.length)));
    const text = `${ru.types.cascadeLead} ${parts.join(' и ')}.${ru.types.cascadeOptions}`;
    if (!window.confirm(text)) return; // «Отмена» — вариант (1)

    dispatch({ type: 'TYPE_REMOVE', id }); // кластеры + пары adjacency отбрасывает store
    if (presetCells.length > 0 && state.presetMask) {
      // Вариант (2): связанные preset-клетки удаляются (иначе остались бы как
      // «чужие» символы с ошибкой V-MASK-PRESET).
      dispatch({ type: 'STROKE_APPLY', kind: 'preset', cells: presetCells, value: { kind: 'free' } });
    }
  }

  return (
    <section className="panel" style={{ padding: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>{ru.panels.types}</h2>
        <button type="button" style={btnStyle} onClick={() => setEditingId('new')}>
          {ru.types.addBtn}
        </button>
      </div>

      {editingId !== null && (
        <TypeForm
          key={editingId === 'new' ? 'new' : editingId}
          types={spec.types}
          excludeId={editingId === 'new' ? undefined : editingId}
          initialName={editingId !== 'new' ? spec.types[editingId]?.name ?? '' : ''}
          onSave={(id, symbol, name) => {
            if (editingId === 'new') dispatch({ type: 'TYPE_ADD', id, symbol, name: name || null });
            else dispatch({ type: 'TYPE_UPDATE', id: editingId, patch: { symbol, name: name || null } });
            setEditingId(null);
          }}
          onCancel={() => setEditingId(null)}
        />
      )}

      {typeIds.length === 0 ? (
        <p style={{ color: '#888', fontSize: 12 }}>{ru.types.empty}</p>
      ) : (
        typeIds.map((id) => (
          <div key={id} style={rowStyle}>
            <span
              style={{
                flex: '0 0 auto',
                width: 22,
                textAlign: 'center',
                border: '1px solid #bbb',
                borderRadius: 3,
                fontWeight: 700,
              }}
            >
              {spec.types[id].symbol}
            </span>
            <span style={{ flex: '0 0 auto', minWidth: 60, overflow: 'hidden', textOverflow: 'ellipsis' }}>{id}</span>
            <span style={{ flex: 1, color: '#777', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {spec.types[id].name ?? ''}
            </span>
            <button type="button" style={btnStyle} title="Редактировать" onClick={() => setEditingId(id)}>
              ✎
            </button>
            <button type="button" style={btnStyle} title="Удалить" onClick={() => removeType(id)}>
              ✕
            </button>
          </div>
        ))
      )}
    </section>
  );
}

// ── Форма типа (ТЗ 04 §5) ───────────────────────────────────────────────────────

function TypeForm(props: {
  types: Record<string, { symbol: string; name: string | null }>;
  excludeId?: string; // редактируемый тип не считается дубликатом самого себя
  initialName: string;
  onSave: (id: string, symbol: string, name: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const { types, excludeId, initialName, onSave, onCancel } = props;
  const [id, setId] = useState(excludeId ?? '');
  const [symbol, setSymbol] = useState('');
  const [name, setName] = useState(initialName);
  const [errors, setErrors] = useState<{ id?: string; symbol?: string }>({});

  function save(): void {
    const next: { id?: string; symbol?: string } = {};
    const trimmedId = id.trim();
    if (trimmedId.length === 0) next.id = ru.types.idEmpty;
    else if (!isValidTypeId(trimmedId)) next.id = ru.types.idPattern;
    else if (Object.keys(types).some((t) => t === trimmedId && t !== excludeId)) next.id = ru.types.idDup;

    const se = symbolError(symbol, types, excludeId);
    if (se === 'invalid') next.symbol = ru.types.symbolInvalid;
    else if (se === 'reserved') next.symbol = ru.types.symbolReserved;
    else if (se === 'duplicate') next.symbol = ru.types.symbolDup;

    setErrors(next);
    if (next.id || next.symbol) return;
    onSave(trimmedId, symbol, name.trim());
  }

  return (
    <div style={modalStyle}>
      <strong>{excludeId ? ru.types.editTitle : ru.types.addTitle}</strong>

      <label style={fieldStyle}>
        <span style={labelStyle}>{ru.types.idLabel} *</span>
        <input value={id} onChange={(e) => setId(e.target.value)} disabled={excludeId !== undefined} style={{ width: '100%', boxSizing: 'border-box', marginTop: 2 }} />
        {errors.id && <span style={errorStyle}>{errors.id}</span>}
      </label>

      <label style={fieldStyle}>
        <span style={labelStyle}>{ru.types.symbolLabel} *</span>
        <input value={symbol} onChange={(e) => setSymbol(e.target.value)} maxLength={2} style={{ width: 60, marginTop: 2 }} />
        {errors.symbol && <span style={errorStyle}>{errors.symbol}</span>}
      </label>

      <label style={fieldStyle}>
        <span style={labelStyle}>{ru.types.nameLabel}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', marginTop: 2 }} />
      </label>

      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button type="button" style={btnStyle} onClick={save}>
          {ru.common.save}
        </button>
        <button type="button" style={btnStyle} onClick={onCancel}>
          {ru.common.cancel}
        </button>
      </div>
    </div>
  );
}
