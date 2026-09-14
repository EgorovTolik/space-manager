// Панель типов (ТЗ 04 §5). Реестр types {id: {symbol, name}}.
//
// Форма: id (ключ реестра; `[A-Za-z][A-Za-z0-9_]*`, уникален), symbol — ОДИН символ
// (≠ «.» и «*», без дублей — сообщения под полем, коды V-TYPE-SYMDUP/V-TYPE-RESERVED),
// name — необязательный текст.
// Удаление типа: без ссылок — немедленное с подтверждением; если тип используется
// (кластеры/adjacency/preset-клетки) — диалог ТЗ 04 §5 с каскадом: TYPE_REMOVE
// (кластеры и пары adjacency отбрасывает store) + очистка preset-клеток символа.
//
// Секция «Общий список типов» (ST-2): глобальный каталог GET /api/types-catalog
// (кэш на время сессии страницы; refreshTypesCatalog — после сохранения проекта).
// Чекбокс отмечен ⇔ тип уже в spec.types. Отметить → TYPE_ADD определением из
// каталога; снять → удаление тем же механизмом, что и ✕ реестра (removeType).
// Блокировки — чистые guard-функции lib/typesCatalog: снятие запрещено, если тип
// привязан к кластеру(ам) (сообщение под секцией, состояние не меняется); отметка
// запрещена, если symbol занят другим типом проекта (V-TYPE-SYMDUP) — чекбокс
// disabled с подсказкой. Типы проекта вне каталога — строки «вне общего списка».
//
// ST-4: на строках КАТАЛОЖНЫХ типов (не «вне общего списка») — инлайн-редактирование
// (✎ → форма в стиле editingId; symbol/name; PATCH /api/types-catalog/:id) и удаление
// (🗑 → единый confirm панели; DELETE). После успеха — кэш каталога обновляется из
// ответа сервера (patchCatalog/deleteCatalog lib/typesCatalog); ошибки 400/404/422 —
// сообщение под секцией. Семантика: правится только общий список, спеки проектов не
// меняются (служебная строка catalogNote).
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { ru } from '../i18n/ru';
import { useEditor } from '../state/editorStore';
import { isValidTypeId, symbolError } from '../lib/fileUtils';
import {
  catalogPatchBody,
  catalogRows,
  catalogToggleDecision,
  deleteCatalog,
  getTypesCatalog,
  patchCatalog,
  subscribeTypesCatalog,
} from '../lib/typesCatalog';
import type { CatalogTypes } from '../lib/typesCatalog';
import type { SpecDoc } from '../lib/types';

const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' };
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

  // Общий список типов (ST-2): каталог с сессионным кэшем + refresh после сохранения.
  const [catalog, setCatalog] = useState<CatalogTypes | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [blockMsg, setBlockMsg] = useState<string | null>(null);
  // ST-4: инлайн-редактирование каталожного типа + ошибка операции с каталогом.
  const [catalogEditId, setCatalogEditId] = useState<string | null>(null);
  const [catalogActionError, setCatalogActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Первый fetch: подписка уведомит, кэш уже заполнен — then() синхронно обновит.
    void getTypesCatalog()
      .then((t) => {
        if (!cancelled) {
          setCatalog(t);
          setCatalogError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setCatalogError(e instanceof Error ? e.message : String(e));
      });
    const unsub = subscribeTypesCatalog((t) => {
      if (cancelled) return;
      setCatalog(t);
      setCatalogError(null);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

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

  // Клик чекбокса «Общий список типов»: guard-решение → действие или сообщение о блоке.
  function onCatalogToggle(id: string): void {
    if (!spec || catalog === null) return;
    setBlockMsg(null);
    const d = catalogToggleDecision(catalog, spec, id);
    switch (d.kind) {
      case 'add':
        dispatch({ type: 'TYPE_ADD', id, symbol: d.def.symbol, name: d.def.name });
        break;
      case 'remove':
        removeType(id); // тот же механизм удаления (confirm + каскад preset-клеток)
        break;
      case 'blocked-clusters':
        setBlockMsg(ru.types.catalogBlockedClusters.replace('{list}', d.clusterIds.join(', ')));
        break;
      case 'symbol-dup':
        // Чекбокс disabled — недостижимо; страховка guard'а.
        setBlockMsg(ru.types.symbolUsedBy.replace('{symbol}', d.symbol).replace('{id}', d.owner));
        break;
    }
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
      {/* «＋ Добавить» — рядом с заголовком: не btn-row, ширина auto (правило 3 styles.css). */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>{ru.panels.types}</h2>
        <button type="button" className="btn" onClick={() => setEditingId('new')}>
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
            {/* Кнопки строки — в самой строке с данными (не btn-row), ширина auto. */}
            <button type="button" className="btn" title="Редактировать" onClick={() => setEditingId(id)}>
              ✎
            </button>
            <button type="button" className="btn" title="Удалить" onClick={() => removeType(id)}>
              ✕
            </button>
          </div>
        ))
      )}

      {catalogSection(
        catalog,
        catalogError,
        spec,
        onCatalogToggle,
        blockMsg,
        catalogEditId,
        (id) => {
          setCatalogActionError(null);
          setCatalogEditId(id);
        },
        () => {
          setCatalogEditId(null);
          setCatalogActionError(null);
        },
        (id, symbol, name) => {
          void (async (): Promise<void> => {
            setCatalogActionError(null);
            try {
              // ST-4: PATCH — правится только общий список; кэш обновляется из ответа.
              await patchCatalog(id, catalogPatchBody(symbol, name));
              setCatalogEditId(null);
            } catch (e) {
              setCatalogActionError(errText(e));
            }
          })();
        },
        (id) => {
          // ST-4: удаление каталожного типа — единый механизм confirm панели.
          if (!window.confirm(ru.types.catalogRemoveConfirm.replace('{id}', id))) return;
          void (async (): Promise<void> => {
            setCatalogActionError(null);
            try {
              await deleteCatalog(id); // кэш обновится из ответа — строка исчезнет
            } catch (e) {
              setCatalogActionError(errText(e));
            }
          })();
        },
        catalogActionError,
      )}
    </section>
  );
}

// ── Секция «Общий список типов» (ST-2) ─────────────────────────────────────────

function catalogSection(
  catalog: CatalogTypes | null,
  catalogError: string | null,
  spec: SpecDoc,
  onToggle: (id: string) => void,
  blockMsg: string | null,
  // ST-4: инлайн-редактирование/удаление каталожных типов.
  editId: string | null,
  onEdit: (id: string) => void,
  onEditCancel: () => void,
  onEditSave: (id: string, symbol: string, name: string) => void,
  onDelete: (id: string) => void,
  actionError: string | null,
): JSX.Element {
  const rows = catalog !== null ? catalogRows(catalog, spec) : [];
  // Редактируемый каталожный тип (narrowed — для формы); id неизменяем.
  const editing =
    editId !== null && catalog !== null && catalog[editId] !== undefined
      ? { id: editId, def: catalog[editId] }
      : null;
  return (
    <div className="types-catalog" style={{ borderTop: '1px dashed #ccc', marginTop: 8, paddingTop: 6 }}>
      <strong>{ru.types.catalogTitle}</strong>
      {catalogError !== null && (
        <div style={errorStyle}>
          {ru.types.catalogError} {catalogError}
        </div>
      )}
      {catalog === null && catalogError === null && (
        <div style={{ color: '#888', fontSize: 12 }}>{ru.types.catalogLoading}</div>
      )}
      {catalog !== null && rows.length === 0 && (
        <div style={{ color: '#888', fontSize: 12 }}>{ru.types.catalogEmpty}</div>
      )}
      {editing !== null && catalog !== null && (
        <CatalogTypeForm
          key={editing.id}
          id={editing.id}
          initial={{ symbol: editing.def.symbol, name: editing.def.name ?? '' }}
          types={catalog}
          onSave={(symbol, name) => onEditSave(editing.id, symbol, name)}
          onCancel={onEditCancel}
        />
      )}
      {rows.map((r) => {
        const hint =
          r.disableReason !== null
            ? ru.types.symbolUsedBy.replace('{symbol}', r.disableReason.symbol).replace('{id}', r.disableReason.owner)
            : undefined;
        return (
          <div key={r.id} style={rowStyle} data-catalog-row={r.outsideCatalog ? undefined : r.id}>
            <input
              type="checkbox"
              aria-label={r.id}
              title={hint}
              checked={r.checked}
              disabled={r.disabled}
              onChange={() => onToggle(r.id)}
            />
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
              {r.symbol}
            </span>
            <span style={{ flex: '0 0 auto', minWidth: 60, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.id}</span>
            {r.outsideCatalog && (
              <span style={{ color: '#856404', fontSize: 11 }} title={ru.types.outsideCatalog}>
                ({ru.types.outsideCatalog})
              </span>
            )}
            <span style={{ flex: 1, color: '#777', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name ?? ''}</span>
            {/* ST-4: редактирование/удаление — только КАТАЛОЖНЫЕ строки (не «вне общего списка»). */}
            {!r.outsideCatalog && (
              <>
                <button type="button" className="btn" title={ru.types.catalogEditBtn} onClick={() => onEdit(r.id)}>
                  ✎
                </button>
                <button type="button" className="btn" title={ru.types.catalogDeleteBtn} onClick={() => onDelete(r.id)}>
                  🗑
                </button>
              </>
            )}
          </div>
        );
      })}
      {blockMsg !== null && <div style={errorStyle}>{blockMsg}</div>}
      {/* ST-4: ошибка операции с каталогом (400/404/422 — текст из ответа сервера). */}
      {actionError !== null && (
        <div style={errorStyle}>
          {ru.types.catalogActionError} {actionError}
        </div>
      )}
      {/* ST-4: служебная строка — изменения касаются только общего списка. */}
      <div style={{ color: '#888', fontSize: 12, marginTop: 6 }}>{ru.types.catalogNote}</div>
    </div>
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

      {/* Ряд кнопок формы: две кнопки — равные высоты, ширина auto (styles.css). */}
      <div className="btn-row" style={{ marginTop: 10 }}>
        <button type="button" className="btn" onClick={save}>
          {ru.common.save}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          {ru.common.cancel}
        </button>
      </div>
    </div>
  );
}

// ── Форма каталожного типа (ST-4): symbol + name, PATCH /api/types-catalog/:id ──
// Валидация symbol — те же проверки, что у реестра типов (fileUtils.symbolError):
// один символ, ≠ «.»/«*», не занят другим типом каталога. id неизменяем.

function CatalogTypeForm(props: {
  id: string;
  initial: { symbol: string; name: string };
  types: Record<string, { symbol: string; name: string | null }>;
  onSave: (symbol: string, name: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const { id, initial, types, onSave, onCancel } = props;
  const [symbol, setSymbol] = useState(initial.symbol);
  const [name, setName] = useState(initial.name);
  const [error, setError] = useState<string | null>(null);

  function save(): void {
    // symbolError с excludeId — символ собственного типа не считается дублем.
    const se = symbolError(symbol, types, id);
    if (se === 'invalid') {
      setError(ru.types.symbolInvalid);
      return;
    }
    if (se === 'reserved') {
      setError(ru.types.symbolReserved);
      return;
    }
    if (se === 'duplicate') {
      setError(ru.types.symbolDup);
      return;
    }
    setError(null);
    onSave(symbol, name.trim());
  }

  return (
    <div style={modalStyle} data-catalog-form={id}>
      <strong>{ru.types.catalogEditTitle}: {id}</strong>

      <label style={fieldStyle}>
        <span style={labelStyle}>{ru.types.symbolLabel} *</span>
        <input value={symbol} onChange={(e) => setSymbol(e.target.value)} maxLength={2} style={{ width: 60, marginTop: 2 }} />
        {error !== null && <span style={errorStyle}>{error}</span>}
      </label>

      <label style={fieldStyle}>
        <span style={labelStyle}>{ru.types.nameLabel}</span>
        {/* maxLength 64 — ограничение сервера (400 при превышении). */}
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={64} style={{ width: '100%', boxSizing: 'border-box', marginTop: 2 }} />
      </label>

      <div className="btn-row" style={{ marginTop: 10 }}>
        <button type="button" className="btn" onClick={save}>
          {ru.common.save}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          {ru.common.cancel}
        </button>
      </div>
    </div>
  );
}

function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
