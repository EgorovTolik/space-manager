// Панель файлов (ТЗ 04 §1, имена скачиваемых файлов — ТЗ 02 §6, создание «с нуля» — 02 §7).
//
// Механики:
// - Спекация загружается ПЕРВОЙ (drag&drop или выбор файла); повторная загрузка при
//   несохранённых изменениях — с подтверждением «Текущие изменения будут потеряны».
// - «＋ Создать спеку…» — диалог W×H → SpecDoc с дефолтами ТЗ 02 §4 + две пустые маски.
// - Поля W×H редактируемы в любой момент (целые > 0); GRID_RESIZE применяется только
//   после подтверждения, если реально отбрасываются занятые клетки масок.
// - Маски: Загрузить (файл с несовпадающим размером загружается тоже — V-MASK-DIM в
//   баннере, редактирование canvas блокируется) / Добавить (пустая) / Удалить / Скачать.
// - Скачивание — Blob + <a download>; предупреждение о потере комментариев — при ПЕРВОМ
//   скачивании изменённой спеки (ТЗ 02 §4 п.1); подтверждение «Скачать как есть?» при
//   ошибках: спека — любые, маска — только этой маски (ТЗ 05 §3 п.3).
// - Маркер «изменено» у кнопок скачивания сбрасывается после скачивания файла (ТЗ 04 §8);
//   когда все файлы чистые — markClean() (глобальный dirty для beforeunload/подтверждений).
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, DragEvent, ChangeEvent, KeyboardEvent } from 'react';
import { ru } from '../i18n/ru';
import { isDirty, markClean, useEditor } from '../state/editorStore';
import type { MaskKind, Rules, SpecDoc } from '../lib/types';
import { dumpSpec, parseSpecWithWarnings } from '../lib/specYaml';
import { dumpMask, MaskParseError, parseBlockedMaskAny, parsePresetMaskAny } from '../lib/maskText';
import { downloadTextFile, maskDownloadName, maskErrorsFor, specDownloadName } from '../lib/fileUtils';

// Дефолты новой спеки (ТЗ 02 §4 п.4 — те же, что в парсинге docs/03).
const DEFAULT_RULES: Rules = {
  connectivity: 8,
  adjacency: { forbidden: [], allow: null },
  size: { min: null, max: null },
  convexity: { weight: 'soft' },
  fillAll: false,
  touchAll: false,
};

const sectionStyle: CSSProperties = { marginBottom: 14 };
const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 4 };
const btnStyle: CSSProperties = { padding: '3px 8px', cursor: 'pointer' };
const disabledBtnStyle: CSSProperties = { ...btnStyle, cursor: 'not-allowed', opacity: 0.5 };
const statusStyle: CSSProperties = { color: '#555', fontSize: 12, marginTop: 2 };
const errorStyle: CSSProperties = { color: '#c62828', fontSize: 12, marginTop: 4 };
const noteStyle: CSSProperties = {
  background: '#fff3cd',
  border: '1px solid #f0ad4e',
  borderRadius: 4,
  padding: '4px 6px',
  fontSize: 12,
  marginTop: 6,
};
const dropStyle: CSSProperties = {
  border: '1px dashed #999',
  borderRadius: 4,
  padding: '6px 8px',
  minHeight: 34,
  display: 'flex',
  alignItems: 'center',
};

export default function FilesPanel(): JSX.Element {
  const { state, dispatch } = useEditor();
  const spec = state.spec;

  // Имена исходно загруженных файлов (ТЗ 02 §6/§8: редактор не знает путей, только basename).
  const [specOriginalName, setSpecOriginalName] = useState<string | null>(null);
  const [blockedOrigName, setBlockedOrigName] = useState<string | null>(null);
  const [presetOrigName, setPresetOrigName] = useState<string | null>(null);

  // Маркер «изменено» на файл (ТЗ 04 §8) — сбрасывается скачиванием соответствующего файла.
  const [dirtyFiles, setDirtyFiles] = useState({ spec: false, blocked: false, preset: false });
  const commentWarnedRef = useRef(false); // предупреждение о комментариях — один раз на спеку

  // Поля W×H (ТЗ 04 §1): локальный текст + inline-ошибка; применение — Enter/«Применить».
  const [wText, setWText] = useState('');
  const [hText, setHText] = useState('');
  const [sizeError, setSizeError] = useState<string | null>(null);

  // Диалог создания спеки (ТЗ 02 §7) и одноразовое предупреждение о неизвестных полях.
  const [showCreate, setShowCreate] = useState(false);
  const [createW, setCreateW] = useState('');
  const [createH, setCreateH] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const specInputRef = useRef<HTMLInputElement | null>(null);
  const blockedInputRef = useRef<HTMLInputElement | null>(null);
  const presetInputRef = useRef<HTMLInputElement | null>(null);

  // Любое изменение модели помечает соответствующий файл «изменённым» (ТЗ 04 §8).
  useEffect(() => {
    if (state.spec) setDirtyFiles((d) => (d.spec ? d : { ...d, spec: true }));
  }, [state.spec]);
  useEffect(() => {
    if (state.blockedMask) setDirtyFiles((d) => (d.blocked ? d : { ...d, blocked: true }));
  }, [state.blockedMask]);
  useEffect(() => {
    if (state.presetMask) setDirtyFiles((d) => (d.preset ? d : { ...d, preset: true }));
  }, [state.presetMask]);

  // Все файлы скачаны/чисты — глобальный dirty сбрасывается (beforeunload, подтверждения).
  useEffect(() => {
    if (!dirtyFiles.spec && !dirtyFiles.blocked && !dirtyFiles.preset) markClean();
  }, [dirtyFiles]);

  // Синхронизация полей W×H при смене/загрузке спеки.
  useEffect(() => {
    if (state.spec) {
      setWText(String(state.spec.grid.width));
      setHText(String(state.spec.grid.height));
      setSizeError(null);
    }
  }, [state.spec]);

  // ── Загрузка спеки ────────────────────────────────────────────────────────────

  async function handleSpecFile(file: File): Promise<void> {
    if (isDirty() && !window.confirm(ru.files.overwriteConfirm)) return;
    try {
      const text = await file.text();
      const { doc, unknownFields } = parseSpecWithWarnings(text);
      dispatch({ type: 'SPEC_LOADED', doc });
      setSpecOriginalName(file.name);
      commentWarnedRef.current = false; // новая спека — предупреждение о комментариях снова «первое»
      setNotice(
        unknownFields.length > 0
          ? ru.files.unknownFieldsNote.replace('{fields}', unknownFields.join(', '))
          : null,
      );
    } catch (e) {
      window.alert(`${ru.files.parseErrorTitle} ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function onSpecDrop(e: DragEvent): void {
    e.preventDefault();
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) void handleSpecFile(f);
  }

  // ── Создание спеки «с нуля» (ТЗ 02 §7, Решение Б) ────────────────────────────

  function createSpec(): void {
    const w = parsePositiveInt(createW);
    const h = parsePositiveInt(createH);
    if (w === null || h === null) {
      setCreateError(ru.files.sizeError);
      return;
    }
    if (isDirty() && !window.confirm(ru.files.overwriteConfirm)) return;
    const doc: SpecDoc = {
      grid: { width: w, height: h },
      blockedFile: null,
      presetFile: null,
      types: {},
      rules: { ...DEFAULT_RULES, adjacency: { forbidden: [], allow: null }, size: { min: null, max: null } },
      clusters: [],
    };
    dispatch({ type: 'SPEC_LOADED', doc });
    // Решение Б: вместе со спекой создаются ДВЕ пустые маски (размер = grid).
    dispatch({ type: 'MASK_ADDED', kind: 'blocked' });
    dispatch({ type: 'MASK_ADDED', kind: 'preset' });
    setSpecOriginalName(null); // создана с нуля → скачивается как spec.yaml (ТЗ 02 §6)
    commentWarnedRef.current = false;
    setNotice(null);
    setShowCreate(false);
  }

  // ── Поля W×H (ТЗ 04 §1) ───────────────────────────────────────────────────────

  function applySize(): void {
    if (!spec) return;
    const w = parsePositiveInt(wText);
    const h = parsePositiveInt(hText);
    if (w === null || h === null) {
      setSizeError(ru.files.sizeError);
      return;
    }
    if (w === spec.grid.width && h === spec.grid.height) {
      setSizeError(null);
      return;
    }
    // Подтверждение — только если что-то реально отбрасывается (ТЗ 04 §1).
    const dropped = countDroppedCells(w, h);
    if (dropped > 0 && !window.confirm(ru.files.resizeConfirm)) return;
    dispatch({ type: 'GRID_RESIZE', w, h });
    setSizeError(null);
  }

  function onSizeKey(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter') applySize();
  }

  /** Занятые клетки масок вне нового размера (по собственным размерам каждой маски). */
  function countDroppedCells(w: number, h: number): number {
    let n = 0;
    const bm = state.blockedMask;
    if (bm) {
      for (let y = 0; y < bm.height; y++) {
        for (let x = 0; x < bm.width; x++) {
          if ((x >= w || y >= h) && bm.cells[y][x] === 'blocked') n++;
        }
      }
    }
    const pm = state.presetMask;
    if (pm) {
      for (let y = 0; y < pm.height; y++) {
        for (let x = 0; x < pm.width; x++) {
          if ((x >= w || y >= h) && pm.cells[y][x].kind === 'preset') n++;
        }
      }
    }
    return n;
  }

  // ── Маски ─────────────────────────────────────────────────────────────────────

  async function handleMaskFile(kind: MaskKind, file: File): Promise<void> {
    if (!spec) return;
    try {
      const text = await file.text();
      if (kind === 'blocked') {
        // Несовпадение размера НЕ отклоняет файл: маска загружается в своём размере,
        // V-MASK-DIM появится в баннере (store MASK_LOADED), canvas покажет заглушку.
        const mask = parseBlockedMaskAny(text);
        dispatch({ type: 'MASK_LOADED', kind, mask, fileName: file.name });
        setBlockedOrigName(file.name);
      } else {
        const symbols = Object.values(spec.types).map((t) => t.symbol);
        const res = parsePresetMaskAny(text, symbols);
        dispatch({ type: 'MASK_LOADED', kind, mask: res.mask, fileName: file.name, presetErrors: res.errors });
        setPresetOrigName(file.name);
      }
    } catch (e) {
      window.alert(`${ru.files.parseErrorTitle} ${e instanceof MaskParseError ? e.message : e instanceof Error ? e.message : String(e)}`);
    }
  }

  function addMask(kind: MaskKind): void {
    if (!spec) return;
    dispatch({ type: 'MASK_ADDED', kind });
    if (kind === 'blocked') setBlockedOrigName(null);
    else setPresetOrigName(null);
  }

  function removeMask(kind: MaskKind): void {
    const label = kind === 'blocked' ? ru.files.maskBlockedSection : ru.files.maskPresetSection;
    if (!window.confirm(ru.files.removeMaskConfirm.replace('{kind}', label))) return;
    dispatch({ type: 'MASK_CLEARED', kind });
    if (kind === 'blocked') setBlockedOrigName(null);
    else setPresetOrigName(null);
  }

  // ── Скачивание (ТЗ 02 §6, предупреждения — ТЗ 02 §4 п.1 / 05 §3 п.3) ───────────

  function downloadSpecFile(): void {
    if (!spec) return;
    const n = state.ui.errors.length;
    if (n > 0 && !window.confirm(ru.files.downloadAsIsErrors.replace('{n}', String(n)))) return;
    if (isDirty() && !commentWarnedRef.current) {
      commentWarnedRef.current = true; // предупреждение — только при ПЕРВОМ скачивании изменённой спеки
      if (!window.confirm(ru.files.commentLossConfirm)) return;
    }
    downloadTextFile(specDownloadName(specOriginalName), dumpSpec(spec));
    setDirtyFiles((d) => ({ ...d, spec: false }));
  }

  function downloadMaskFile(kind: MaskKind): void {
    if (!spec) return;
    const mask = kind === 'blocked' ? state.blockedMask : state.presetMask;
    if (!mask) return;
    // Подтверждение — только при ошибках ЭТОЙ маски (ТЗ 05 §3 п.3).
    if (maskErrorsFor(state.ui.errors, kind).length > 0 && !window.confirm(ru.files.maskDownloadAsIs)) return;
    const name = maskDownloadName(
      kind === 'blocked' ? spec.blockedFile : spec.presetFile,
      kind === 'blocked' ? blockedOrigName : presetOrigName,
      kind === 'blocked' ? 'blocked.txt' : 'preset.txt',
    );
    downloadTextFile(name, dumpMask(mask));
    setDirtyFiles((d) => ({ ...d, [kind]: false }));
  }

  // ── Статусы файлов (загружена / нет / размер ≠ сетка ⚠ — ТЗ 04 §1) ────────────

  function maskStatus(kind: MaskKind): string {
    const mask = kind === 'blocked' ? state.blockedMask : state.presetMask;
    if (!spec || !mask) return ru.files.notLoaded;
    const name =
      (kind === 'blocked' ? blockedOrigName : presetOrigName) ??
      (kind === 'blocked' ? spec.blockedFile : spec.presetFile) ??
      (kind === 'blocked' ? 'blocked.txt' : 'preset.txt');
    if (mask.width !== spec.grid.width || mask.height !== spec.grid.height) {
      return `имя: ${name} · ${ru.files.dimMismatchMark}`;
    }
    return `имя: ${name}`;
  }

  function onFileChosen(handler: (f: File) => void): (e: ChangeEvent<HTMLInputElement>) => void {
    return (e: ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files && e.target.files[0];
      if (f) handler(f);
      e.target.value = ''; // повторный выбор одного и того же файла срабатывает снова
    };
  }

  const dirtyDot = (b: boolean): string => (b ? ' ●' : '');

  return (
    <section className="panel" style={{ padding: 8 }}>
      <h2 style={{ marginTop: 0 }}>{ru.panels.files}</h2>

      {/* ── Спекация ── */}
      <div style={sectionStyle}>
        <strong>{ru.files.specSection}</strong>
        {spec ? (
          <div style={statusStyle}>
            имя: {specOriginalName ?? 'spec.yaml'}
          </div>
        ) : (
          <div
            style={{ ...dropStyle, marginTop: 4 }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onSpecDrop}
          >
            <span style={{ color: '#888' }}>drag&drop spec.yaml или:</span>
            <button type="button" style={{ ...btnStyle, marginLeft: 6 }} onClick={() => specInputRef.current?.click()}>
              📂 {ru.buttons.load}
            </button>
          </div>
        )}
        <div style={rowStyle}>
          <button
            type="button"
            style={btnStyle}
            disabled={!spec}
            title={spec ? undefined : ru.grid.noSpec}
            onClick={() => specInputRef.current?.click()}
          >
            📂 {ru.buttons.load}
          </button>
          <button
            type="button"
            style={btnStyle}
            onClick={() => {
              setShowCreate((v) => !v);
              setCreateError(null);
            }}
          >
            {ru.files.createSpec}
          </button>
          <button
            type="button"
            style={spec ? btnStyle : disabledBtnStyle}
            disabled={!spec}
            title={dirtyFiles.spec ? ru.files.commentLossConfirm : undefined}
            onClick={downloadSpecFile}
          >
            ⬇ {ru.buttons.download}{dirtyDot(dirtyFiles.spec)}
          </button>
        </div>

        {showCreate && (
          <div style={{ ...noteStyle, borderColor: '#9ec5fe', background: '#e7f1ff' }}>
            <div>{ru.files.createSpecTitle}</div>
            <div style={rowStyle}>
              <label>
                {ru.files.width}:{' '}
                <input value={createW} onChange={(e) => setCreateW(e.target.value)} style={{ width: 60 }} />
              </label>
              <label>
                {ru.files.height}:{' '}
                <input value={createH} onChange={(e) => setCreateH(e.target.value)} style={{ width: 60 }} />
              </label>
              <button type="button" style={btnStyle} onClick={createSpec}>
                {ru.common.apply}
              </button>
            </div>
            {createError && <div style={errorStyle}>{createError}</div>}
          </div>
        )}

        {/* Редактируемые W×H (ТЗ 04 §1) */}
        {spec && (
          <>
            <div style={rowStyle}>
              <span style={{ color: '#555', fontSize: 12 }}>{ru.files.sizeLabel}:</span>
              <input
                value={wText}
                onChange={(e) => setWText(e.target.value)}
                onKeyDown={onSizeKey}
                style={{ width: 60 }}
                aria-label={ru.files.width}
              />
              <span>×</span>
              <input
                value={hText}
                onChange={(e) => setHText(e.target.value)}
                onKeyDown={onSizeKey}
                style={{ width: 60 }}
                aria-label={ru.files.height}
              />
              <button type="button" style={btnStyle} onClick={applySize}>
                {ru.common.apply}
              </button>
            </div>
            {sizeError && <div style={errorStyle}>{sizeError}</div>}
          </>
        )}

        {notice && <div style={noteStyle}>{notice}</div>}
      </div>

      {/* ── Маска блокировок ── */}
      <MaskSection
        title={ru.files.maskBlockedSection}
        status={maskStatus('blocked')}
        disabled={!spec}
        dirty={dirtyFiles.blocked}
        onUpload={() => blockedInputRef.current?.click()}
        onAdd={() => addMask('blocked')}
        onRemove={() => removeMask('blocked')}
        onDownload={() => downloadMaskFile('blocked')}
      />

      {/* ── Preset-карта ── */}
      <MaskSection
        title={ru.files.maskPresetSection}
        status={maskStatus('preset')}
        disabled={!spec}
        dirty={dirtyFiles.preset}
        onUpload={() => presetInputRef.current?.click()}
        onAdd={() => addMask('preset')}
        onRemove={() => removeMask('preset')}
        onDownload={() => downloadMaskFile('preset')}
      />

      {/* Скрытые file-inputs */}
      <input
        ref={specInputRef}
        type="file"
        accept=".yaml,.yml,text/yaml"
        style={{ display: 'none' }}
        onChange={onFileChosen((f) => void handleSpecFile(f))}
      />
      <input
        ref={blockedInputRef}
        type="file"
        accept=".txt,text/plain"
        style={{ display: 'none' }}
        onChange={onFileChosen((f) => void handleMaskFile('blocked', f))}
      />
      <input
        ref={presetInputRef}
        type="file"
        accept=".txt,text/plain"
        style={{ display: 'none' }}
        onChange={onFileChosen((f) => void handleMaskFile('preset', f))}
      />
    </section>
  );
}

// Секция одной маски (ТЗ 04 §1): статус + Загрузить / Добавить / Удалить / Скачать.
function MaskSection(props: {
  title: string;
  status: string;
  disabled: boolean;
  dirty: boolean;
  onUpload: () => void;
  onAdd: () => void;
  onRemove: () => void;
  onDownload: () => void;
}): JSX.Element {
  const s = props.disabled ? disabledBtnStyle : btnStyle;
  return (
    <div style={sectionStyle}>
      <strong>{props.title}</strong>
      <div style={statusStyle}>{props.status}</div>
      <div style={rowStyle}>
        <button type="button" style={s} disabled={props.disabled} title={props.disabled ? ru.grid.noSpec : undefined} onClick={props.onUpload}>
          📂 {ru.buttons.load}
        </button>
        <button type="button" style={s} disabled={props.disabled} onClick={props.onAdd}>
          {ru.files.addMask}
        </button>
        <button type="button" style={s} disabled={props.disabled} onClick={props.onRemove}>
          ✕ {ru.buttons.remove}
        </button>
      </div>
      <div style={rowStyle}>
        <button type="button" style={s} disabled={props.disabled} onClick={props.onDownload}>
          ⬇ {ru.buttons.download}{props.dirty ? ' ●' : ''}
        </button>
      </div>
    </div>
  );
}

/** Целое > 0 из текстового поля; null — невалидно (сообщение TЗ V-GRID-DIMS показывает вызывающий). */
function parsePositiveInt(s: string): number | null {
  const t = s.trim();
  if (!/^\d+$/.test(t)) return null;
  const v = Number(t);
  return Number.isInteger(v) && v > 0 ? v : null;
}
