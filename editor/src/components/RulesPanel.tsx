// Панель правил (ТЗ 04 §6). Правила размещения из spec.rules.
//
// Секции: связность (read-only индикатор), соседство — запрещённые пары + whitelist
// allow (переключатель; выкл = null/default-open, вкл = список пар), размер min/max
// (целые ≥ 0 или пусто → null; min > max — V-SIZE в баннере), выпуклость (read-only,
// «hard — зарезервировано»), fillAll и touchAll (чекбоксы с подсказками).
// Пары неупорядоченные (A×B = B×A); дубликаты и пара из одного типа блокируются.
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { ru } from '../i18n/ru';
import { useEditor } from '../state/editorStore';
import type { Rules } from '../lib/types';
import { pairsContain } from '../lib/fileUtils';

// Кнопки — единая система styles.css (.btn). Все ряды панели — строки с
// инпутами/текстом (правило 3): кнопки остаются auto-ширины.
const sectionStyle: CSSProperties = { marginTop: 12 };
const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 4 };
const errorStyle: CSSProperties = { color: '#c62828', fontSize: 12, marginTop: 4 };
const hintStyle: CSSProperties = { fontSize: 11, color: '#888', marginTop: 2 };

export default function RulesPanel(): JSX.Element {
  const { state, dispatch } = useEditor();
  const spec = state.spec;

  // Формы добавления пар (forbidden и allow используют общий компонент).
  const [forbidA, setForbidA] = useState('');
  const [forbidB, setForbidB] = useState('');
  const [forbidError, setForbidError] = useState<string | null>(null);
  const [allowA, setAllowA] = useState('');
  const [allowB, setAllowB] = useState('');
  const [allowError, setAllowError] = useState<string | null>(null);

  // Поля size — локальный текст (пусто = null), применение по Enter/blur.
  const [minText, setMinText] = useState('');
  const [maxText, setMaxText] = useState('');
  const [sizeError, setSizeError] = useState<string | null>(null);

  useEffect(() => {
    if (spec) {
      setMinText(spec.rules.size.min === null ? '' : String(spec.rules.size.min));
      setMaxText(spec.rules.size.max === null ? '' : String(spec.rules.size.max));
      setSizeError(null);
    }
  }, [spec]);

  if (!spec) {
    return (
      <section className="panel" style={{ padding: 8, color: '#888' }}>
        {ru.grid.noSpec}
      </section>
    );
  }

  const rules = spec.rules;
  const typeIds = Object.keys(spec.types);

  function updateRules(patch: Partial<Rules>): void {
    dispatch({ type: 'RULES_UPDATE', patch });
  }

  // ── Пары adjacency ────────────────────────────────────────────────────────────

  function addPair(list: 'forbidden' | 'allow'): void {
    const a = list === 'forbidden' ? forbidA : allowA;
    const b = list === 'forbidden' ? forbidB : allowB;
    const setErr = list === 'forbidden' ? setForbidError : setAllowError;
    if (a.length === 0 || b.length === 0) {
      setErr(ru.rules.pairSameType);
      return;
    }
    if (a === b) {
      setErr(ru.rules.pairSameType);
      return;
    }
    const pairs = list === 'forbidden' ? rules.adjacency.forbidden : rules.adjacency.allow ?? [];
    if (pairsContain(pairs, a, b)) {
      setErr(ru.rules.pairDup);
      return;
    }
    if (list === 'forbidden') {
      updateRules({ adjacency: { ...rules.adjacency, forbidden: [...rules.adjacency.forbidden, [a, b]] } });
      setForbidA('');
      setForbidB('');
    } else {
      updateRules({ adjacency: { ...rules.adjacency, allow: [...(rules.adjacency.allow ?? []), [a, b]] } });
      setAllowA('');
      setAllowB('');
    }
    setErr(null);
  }

  function removePair(list: 'forbidden' | 'allow', idx: number): void {
    if (list === 'forbidden') {
      updateRules({ adjacency: { ...rules.adjacency, forbidden: rules.adjacency.forbidden.filter((_, i) => i !== idx) } });
    } else if (rules.adjacency.allow) {
      updateRules({ adjacency: { ...rules.adjacency, allow: rules.adjacency.allow.filter((_, i) => i !== idx) } });
    }
  }

  function toggleAllow(): void {
    // Выкл = allow: null (default-open); вкл из null → пустой список пар.
    updateRules({
      adjacency: {
        ...rules.adjacency,
        allow: rules.adjacency.allow === null ? [] : null,
      },
    });
  }

  // ── Размер (min/max: целые ≥ 0 или пусто → null) ─────────────────────────────

  function applySizeBound(which: 'min' | 'max'): void {
    const text = which === 'min' ? minText : maxText;
    const parsed = parseBound(text);
    if (parsed === undefined) {
      setSizeError(ru.rules.sizeInvalid);
      return;
    }
    setSizeError(null);
    updateRules({ size: { ...rules.size, [which]: parsed } });
  }

  // ── UI-блоки ──────────────────────────────────────────────────────────────────

  const typeOptions = (value: string, onChange: (v: string) => void) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ maxWidth: 120 }}>
      <option value="">{typeIds.length > 0 ? '—' : ru.clusters.noTypes}</option>
      {typeIds.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </select>
  );

  return (
    <section className="panel" style={{ padding: 8 }}>
      <h2 style={{ marginTop: 0 }}>{ru.panels.rules}</h2>

      {/* Связность — read-only (текущий срез: 8, ТЗ 02 §2) */}
      <div style={sectionStyle}>
        <strong>{ru.rules.connectivityLabel}:</strong>{' '}
        <code>connectivity: {rules.connectivity}</code>
      </div>

      {/* Запрещённые пары */}
      <div style={sectionStyle}>
        <strong>{ru.rules.adjacencyForbidden}</strong>
        {rules.adjacency.forbidden.length === 0 ? (
          <div style={hintStyle}>нет пар</div>
        ) : (
          rules.adjacency.forbidden.map(([a, b], i) => (
            <div key={`${a}-${b}-${i}`} style={rowStyle}>
              <span>
                {a} × {b}
              </span>
              <button type="button" className="btn" title="Удалить пару" onClick={() => removePair('forbidden', i)}>
                ✕
              </button>
            </div>
          ))
        )}
        <div style={rowStyle}>
          {typeOptions(forbidA, setForbidA)}
          <span>×</span>
          {typeOptions(forbidB, setForbidB)}
          {/* Ряд с селекторами — кнопка auto-ширины (правило 3 styles.css). */}
          <button type="button" className="btn" onClick={() => addPair('forbidden')}>
            {ru.rules.addPair}
          </button>
        </div>
        {forbidError && <div style={errorStyle}>{forbidError}</div>}
      </div>

      {/* Whitelist (allow) */}
      <div style={sectionStyle}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={rules.adjacency.allow !== null} onChange={toggleAllow} />
          {ru.rules.adjacencyAllowToggle}
        </label>
        <div style={hintStyle}>{ru.rules.allowHint}</div>
        {rules.adjacency.allow !== null && (
          <>
            {rules.adjacency.allow.length === 0 ? (
              <div style={hintStyle}>список пуст — разрешены только добавленные пары</div>
            ) : (
              rules.adjacency.allow.map(([a, b], i) => (
                <div key={`${a}-${b}-${i}`} style={rowStyle}>
                  <span>
                    {a} × {b}
                  </span>
                  <button type="button" className="btn" title="Удалить пару" onClick={() => removePair('allow', i)}>
                    ✕
                  </button>
                </div>
              ))
            )}
            <div style={rowStyle}>
              {typeOptions(allowA, setAllowA)}
              <span>×</span>
              {typeOptions(allowB, setAllowB)}
              {/* Ряд с селекторами — кнопка auto-ширины (правило 3 styles.css). */}
              <button type="button" className="btn" onClick={() => addPair('allow')}>
                {ru.rules.addPair}
              </button>
            </div>
            {allowError && <div style={errorStyle}>{allowError}</div>}
          </>
        )}
      </div>

      {/* Размер */}
      <div style={sectionStyle}>
        <strong>{ru.rules.sizeLabel}:</strong>
        <div style={rowStyle}>
          <label>
            {ru.rules.minLabel}:{' '}
            <input
              value={minText}
              onChange={(e) => setMinText(e.target.value)}
              onBlur={() => applySizeBound('min')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applySizeBound('min');
              }}
              style={{ width: 60 }}
            />
          </label>
          <label>
            {ru.rules.maxLabel}:{' '}
            <input
              value={maxText}
              onChange={(e) => setMaxText(e.target.value)}
              onBlur={() => applySizeBound('max')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applySizeBound('max');
              }}
              style={{ width: 60 }}
            />
          </label>
        </div>
        <div style={hintStyle}>{ru.rules.sizeHint}</div>
        {sizeError && <div style={errorStyle}>{sizeError}</div>}
      </div>

      {/* Выпуклость — read-only */}
      <div style={sectionStyle}>
        <strong>{ru.rules.convexityLabel}:</strong> <code>{rules.convexity.weight}</code>
        {rules.convexity.weight === 'hard' && <div style={hintStyle}>{ru.rules.hardReserved}</div>}
      </div>

      {/* fillAll / touchAll */}
      <div style={sectionStyle}>
        <label title="docs/03 §1, docs/04 §6" style={{ display: 'block', marginBottom: 6 }}>
          <input type="checkbox" checked={rules.fillAll} onChange={(e) => updateRules({ fillAll: e.target.checked })} />{' '}
          {ru.rules.fillAllLabel}
        </label>
        <label title="docs/04 §9" style={{ display: 'block' }}>
          <input type="checkbox" checked={rules.touchAll} onChange={(e) => updateRules({ touchAll: e.target.checked })} />{' '}
          {ru.rules.touchAllLabel}
        </label>
      </div>
    </section>
  );
}

/** Целое ≥ 0 из текста; пусто → null; undefined — невалидный ввод. */
function parseBound(s: string): number | null | undefined {
  const t = s.trim();
  if (t === '') return null;
  if (!/^\d+$/.test(t)) return undefined;
  const v = Number(t);
  return Number.isInteger(v) && v >= 0 ? v : undefined;
}
