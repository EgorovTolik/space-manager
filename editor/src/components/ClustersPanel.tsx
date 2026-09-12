// Панель кластеров (ТЗ 04 §4, правила ввода — ТЗ 05 §2.4).
//
// Список clusters в порядке сериализации (ТЗ 02 §2): id | type | areaPercent | shape | ✎ ✕;
// строка «Сумма долей» жёлтая при > 100 (V-CLUST-SUM, epsilon как в validateAll).
// Форма «Добавить/Редактировать» — модальная карточка: id (не пустой, уникален),
// type (выпадающий из реестра; обязателен), areaPercent ((0..100], до 2 знаков),
// shape (free/rectangle/circle + однострочные описания docs/03 §4).
import { useState } from 'react';
import type { CSSProperties } from 'react';
import { ru } from '../i18n/ru';
import { useEditor } from '../state/editorStore';
import type { ClusterEntry, ShapeKind } from '../lib/types';
import { SUM_EPSILON } from '../lib/validation';
import { clustersPercentSum, formatNumber, parseAreaPercent } from '../lib/fileUtils';

const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' };
const btnStyle: CSSProperties = { cursor: 'pointer', padding: '2px 6px' };
const fieldStyle: CSSProperties = { display: 'block', marginTop: 8 };
const labelStyle: CSSProperties = { fontSize: 12, color: '#555' };
const errorStyle: CSSProperties = { color: '#c62828', fontSize: 12, marginTop: 4 };
const modalStyle: CSSProperties = {
  border: '1px solid #888',
  borderRadius: 6,
  padding: 10,
  background: '#fafafa',
  marginBottom: 10,
};

type ShapeHintKey = keyof typeof ru.clusters.shapeHints;
const SHAPES: { value: ShapeKind; hint: ShapeHintKey }[] = [
  { value: 'free', hint: 'free' },
  { value: 'rectangle', hint: 'rectangle' },
  { value: 'circle', hint: 'circle' },
];

export default function ClustersPanel(): JSX.Element {
  const { state, dispatch } = useEditor();
  const spec = state.spec;
  // null — форма закрыта; 'new' — добавление; иначе редактируемый entry.
  const [editing, setEditing] = useState<ClusterEntry | 'new' | null>(null);

  if (!spec) {
    return (
      <section className="panel" style={{ padding: 8, color: '#888' }}>
        {ru.grid.noSpec}
      </section>
    );
  }

  const sum = clustersPercentSum(spec.clusters);
  const over = sum > 100 + SUM_EPSILON;
  const typeIds = Object.keys(spec.types);

  function removeCluster(id: string): void {
    if (!window.confirm(ru.clusters.removeConfirm.replace('{id}', id))) return;
    dispatch({ type: 'CLUSTER_REMOVE', id });
  }

  return (
    <section className="panel" style={{ padding: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>{ru.panels.clusters}</h2>
        <button type="button" style={btnStyle} onClick={() => setEditing('new')}>
          {ru.clusters.addBtn}
        </button>
      </div>

      {editing !== null && (
        <ClusterForm
          key={editing === 'new' ? 'new' : editing.id}
          initial={editing === 'new' ? null : editing}
          typeIds={typeIds}
          existingIds={spec.clusters.map((c) => c.id)}
          onSave={(entry, isNew) => {
            if (isNew) dispatch({ type: 'CLUSTER_ADD', cluster: entry });
            else dispatch({ type: 'CLUSTER_UPDATE', id: entry.id, patch: { type: entry.type, areaPercent: entry.areaPercent, shape: entry.shape } });
            setEditing(null);
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      {spec.clusters.length === 0 ? (
        <p style={{ color: '#888', fontSize: 12 }}>{ru.clusters.empty}</p>
      ) : (
        spec.clusters.map((c) => (
          <div key={c.id} style={rowStyle}>
            <span style={{ flex: '0 0 auto', minWidth: 70, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.id}</span>
            <span style={{ flex: '0 0 auto', color: '#555' }}>{c.type}</span>
            <span style={{ flex: '0 0 auto', color: '#555' }}>{formatNumber(c.areaPercent)}%</span>
            <span style={{ flex: 1, color: '#777' }}>{c.shape}</span>
            <button type="button" style={btnStyle} title="Редактировать" onClick={() => setEditing(c)}>
              ✎
            </button>
            <button type="button" style={btnStyle} title="Удалить" onClick={() => removeCluster(c.id)}>
              ✕
            </button>
          </div>
        ))
      )}

      <div
        style={{
          marginTop: 8,
          padding: '4px 6px',
          borderRadius: 4,
          background: over ? '#fff3cd' : '#f0f7f0',
          border: `1px solid ${over ? '#f0ad4e' : '#c3e6cb'}`,
          fontSize: 12,
        }}
      >
        {over
          ? ru.clusters.sumOver.replace('{sum}', formatNumber(sum))
          : ru.clusters.sumOk.replace('{sum}', formatNumber(sum))}
      </div>
    </section>
  );
}

// ── Форма «Добавить/Редактировать» (ТЗ 04 §4) ───────────────────────────────────

function ClusterForm(props: {
  initial: ClusterEntry | null; // null — новый кластер
  typeIds: string[];
  existingIds: string[];
  onSave: (entry: ClusterEntry, isNew: boolean) => void;
  onCancel: () => void;
}): JSX.Element {
  const { initial, typeIds, existingIds, onSave, onCancel } = props;
  const [id, setId] = useState(initial ? initial.id : '');
  const [type, setType] = useState(initial ? initial.type : (typeIds[0] ?? ''));
  const [percentText, setPercentText] = useState(initial ? String(initial.areaPercent) : '');
  const [shape, setShape] = useState<ShapeKind>(initial ? initial.shape : 'free');
  const [errors, setErrors] = useState<string[]>([]);

  // Если type загруженного кластера удалён из реестра (V-CLUST-TYPE) — показываем его
  // как отдельный вариант, чтобы форма не «теряла» значение.
  const options = typeIds.includes(type) || !initial ? typeIds : [type, ...typeIds];

  function save(): void {
    const errs: string[] = [];
    const trimmedId = id.trim();
    if (trimmedId.length === 0) errs.push(ru.clusters.idEmpty);
    else if (existingIds.some((x) => x === trimmedId && x !== initial?.id)) errs.push(ru.clusters.idDup);
    if (typeIds.length === 0) errs.push(ru.clusters.noTypes);
    else if (!type) errs.push(ru.clusters.typeLabel + ': ' + ru.clusters.idEmpty);
    const percent = parseAreaPercent(percentText);
    if (percent === null) errs.push(ru.clusters.percentInvalid);
    setErrors(errs);
    if (errs.length > 0) return;
    onSave(
      { id: trimmedId, type, areaPercent: percent as number, shape },
      initial === null,
    );
  }

  const selectedHint = SHAPES.find((s) => s.value === shape)?.hint;

  return (
    <div style={modalStyle}>
      <strong>{initial ? ru.clusters.editTitle : ru.clusters.addTitle}</strong>

      <label style={fieldStyle}>
        <span style={labelStyle}>{ru.clusters.idLabel} *</span>
        <input value={id} onChange={(e) => setId(e.target.value)} disabled={initial !== null} style={{ width: '100%', boxSizing: 'border-box', marginTop: 2 }} />
      </label>
      <div style={{ fontSize: 11, color: '#888' }}>{ru.clusters.idHint}</div>

      <label style={fieldStyle}>
        <span style={labelStyle}>{ru.clusters.typeLabel} *</span>
        <select value={type} onChange={(e) => setType(e.target.value)} style={{ marginTop: 2, width: '100%' }}>
          {options.length === 0 && <option value="">{ru.clusters.noTypes}</option>}
          {options.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>

      <label style={fieldStyle}>
        <span style={labelStyle}>{ru.clusters.percentLabel} *</span>
        <input value={percentText} onChange={(e) => setPercentText(e.target.value)} style={{ width: 120, marginTop: 2 }} />
      </label>

      <div style={fieldStyle}>
        <span style={labelStyle}>{ru.clusters.shapeLabel} *</span>
        <div style={{ display: 'flex', gap: 12, marginTop: 2 }}>
          {SHAPES.map((s) => (
            <label key={s.value} style={{ fontSize: 13 }}>
              <input type="radio" name="cluster-shape" checked={shape === s.value} onChange={() => setShape(s.value)} /> {s.value}
            </label>
          ))}
        </div>
        {selectedHint && <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{ru.clusters.shapeHints[selectedHint]}</div>}
      </div>

      {errors.length > 0 && (
        <ul style={{ ...errorStyle, margin: '6px 0 0', paddingLeft: 18 }}>
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}

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
