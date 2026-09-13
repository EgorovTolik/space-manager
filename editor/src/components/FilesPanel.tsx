// ProjectFilesPanel (docs-unified/04-integrations.md §1.3–§1.8).
//
// Проектный режим ПОЛНОСТЬЮ заменяет standalone «загрузил файл → скачал»:
// - выбор проекта из списка (`GET /api/projects`) → файлы читаются с сервера;
//   имена масок нормализуются: спека, ссылающаяся на нестандартное имя маски
//   (после импорта архива), читается по исходному имени, а в модели получает
//   каноническое blocked.txt / preset.txt (§1.3 п.2);
// - «💾 Сохранить в проект» → `PUT …/files` полным состоянием канонической тройки
//   (отсутствующая маска = удаление файла, 02 §6.9);
// - «⚡ Генерировать размещение» → автосохранение (если dirty) + `POST …/generate`;
//   блок результата: exit 0 (зелёная строка + ссылка Viewer3D), exit 1 (infeasible —
//   причина из блока до «== КАРТА ==»), HTTP-ошибка (422 — подсказка про валидацию);
// - блок «Отчёты генераций» — история `result-*` проекта (`GET …/results`): имя+дата,
//   «Открыть отчёт» (inline <details> с текстом, GET …/file?name=…) и ссылка «В 3D»;
// - проекты: в селекторе показывается человекочитаемое `name`, а URL/API-запросы
//   используют `slug` (замечание 2 единого сервиса).
//
// Сохраняются секции, оперирующие МОДЕЛЬЮ, а не файлами (docs-unified/04 §1.2):
// W×H, «＋ Создать спеку…», управление масками (Добавить/Удалить), заметка о
// неизвестных полях. Dirty-отслеживание — по базлайну сериализации модели
// (загрузка/сохранение сбрасывают dirty; любое изменение модели после — ●).
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { ru } from '../i18n/ru';
import { isDirty, markClean, useEditor } from '../state/editorStore';
import type { MaskKind, Rules, SpecDoc } from '../lib/types';
import { dumpSpec, parseSpecWithWarnings } from '../lib/specYaml';
import { dumpMask, MaskParseError, parseBlockedMaskAny, parsePresetMaskAny } from '../lib/maskText';
import {
  ApiError,
  generatePlacement,
  listProjects,
  listResults,
  loadProjectFile,
  saveProjectFiles,
} from '../lib/api';
import type { GenerateResult, ProjectInfo, ResultInfo } from '../lib/api';

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
const okStyle: CSSProperties = { color: '#2e7d32', fontSize: 12, marginTop: 4 };
const noteStyle: CSSProperties = {
  background: '#fff3cd',
  border: '1px solid #f0ad4e',
  borderRadius: 4,
  padding: '4px 6px',
  fontSize: 12,
  marginTop: 6,
};

interface Baseline {
  spec: string | null;
  blocked: string | null;
  preset: string | null;
}

export default function ProjectFilesPanel(): JSX.Element {
  const { state, dispatch } = useEditor();
  const spec = state.spec;

  // ── Состояние панели (локальное React-состояние, store не меняется — §1.3) ───
  const [projects, setProjects] = useState<ProjectInfo[] | null>(null);
  // Выбранный проект — его SLUG (машинный идентификатор); в UI показываем name.
  const [selected, setSelected] = useState<string | null>(null);
  // История result-* выбранного проекта (замечание 4); null — не загружена/нет проекта.
  const [results, setResults] = useState<ResultInfo[] | null>(null);
  const [loadingProject, setLoadingProject] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [projectNotFound, setProjectNotFound] = useState<string | null>(null);
  const [fileMissing, setFileMissing] = useState<{ blocked: boolean; preset: boolean }>({
    blocked: false,
    preset: false,
  });

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  // Seed генератора: параметр запуска (не спека) — пустой ввод = не передаётся (0).
  const [seedText, setSeedText] = useState('');
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState<GenerateResult | null>(null);
  const [genError, setGenError] = useState<{ message: string; input: boolean } | null>(null);

  // ── Dirty-отслеживание (базлайн сериализации) ────────────────────────────────
  // Базлайн — сериализация модели в момент загрузки/сохранения. «Изменено» =
  // текущая сериализация отличается. Вычисляется на рендере (дёшево: сотня
  // клеток), чтобы сразу отражать и смену базлайна после сохранения.
  const baselineRef = useRef<Baseline>({ spec: null, blocked: null, preset: null });
  const b = baselineRef.current;
  const curSer: Baseline = {
    spec: state.spec ? dumpSpec(state.spec) : null,
    blocked: state.blockedMask ? dumpMask(state.blockedMask) : null,
    preset: state.presetMask ? dumpMask(state.presetMask) : null,
  };
  const dirtyFiles = {
    spec: curSer.spec !== b.spec,
    blocked: curSer.blocked !== b.blocked,
    preset: curSer.preset !== b.preset,
  };

  // Любое изменение модели после базлайна → «изменено» на соответствующий файл.
  // Эффект работает ПОСЛЕ рендера (редьюсер store уже пометил dirty=true от
  // закешированных dispatch-ей загрузки) — поэтому сброс глобального dirty здесь:
  // если состояние побайтово совпало с базлайном, изменений для сохранения нет.
  useEffect(() => {
    if (!dirtyFiles.spec && !dirtyFiles.blocked && !dirtyFiles.preset) {
      markClean(); // идемпотентно; побеждает над dirty=true из редьюсера загрузки
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.spec, state.blockedMask, state.presetMask]);

  // ── Поля W×H (ТЗ 04 §1 — сохраняется из standalone) ──────────────────────────
  const [wText, setWText] = useState('');
  const [hText, setHText] = useState('');
  const [sizeError, setSizeError] = useState<string | null>(null);

  // Синхронизация полей W×H с загруженной спекой (баг-фикс: в проектном режиме поля
  // оставались пустыми — '' при инициализации не обновлялись при загрузке проекта).
  // Ключи — выбранный проект и размеры сетки: обычные правки кластеров/масок
  // (новый объект state.spec при тех же grid) введённый, ещё неприменённый текст не сбрасывают.
  useEffect(() => {
    if (spec !== null) {
      setWText(String(spec.grid.width));
      setHText(String(spec.grid.height));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, spec?.grid.width, spec?.grid.height]);

  // Диалог создания спеки (ТЗ 02 §7) и одноразовое предупреждение о неизвестных полях.
  const [showCreate, setShowCreate] = useState(false);
  const [createW, setCreateW] = useState('');
  const [createH, setCreateH] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // ── Список проектов + URL-параметр ?project= (docs-unified/04 §1.8) ───────────

  useEffect(() => {
    let cancelled = false;
    listProjects()
      .then((list) => {
        if (cancelled) return;
        setProjects(list);
        const urlProject = new URLSearchParams(window.location.search).get('project');
        if (urlProject && urlProject.length > 0) {
          // URL-параметр несёт slug (ссылки менеджера/редактора); name — фолбэк.
          const match =
            list.find((p) => p.slug === urlProject) ?? list.find((p) => p.name === urlProject);
          if (match) {
            setSelected(match.slug); // селектор показывает автозагруженный проект
            void loadProject(match.slug);
          } else {
            setProjectNotFound(urlProject);
          }
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(errText(e));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onProjectChosen(slug: string): void {
    if (slug.length === 0) return;
    setSelected(slug);
    setProjectNotFound(null);
    const url = new URL(window.location.href);
    url.searchParams.set('project', slug);
    window.history.replaceState(null, '', url.toString());
    void loadProject(slug);
  }

  // ── Загрузка проекта (docs-unified/04 §1.3) ───────────────────────────────────

  async function loadProject(slug: string): Promise<void> {
    if (isDirty() && !window.confirm(ru.files.overwriteConfirm)) return;
    setLoadingProject(true);
    setLoadError(null);
    setSaveError(null);
    setSavedAt(null);
    setGenResult(null);
    setGenError(null);
    setResults(null); // история предыдущего проекта не показывается
    setFileMissing({ blocked: false, preset: false });
    try {
      const specText = await loadProjectFile(slug, 'spec.yaml');
      const { doc, unknownFields } = parseSpecWithWarnings(specText);
      // Нормализация имён масок (§1.3 п.2): содержимое читаем по ИСХОДНОМУ имени,
      // в модели — каноническое blocked.txt / preset.txt.
      const origBlocked = doc.blockedFile;
      const origPreset = doc.presetFile;
      if (doc.blockedFile !== null) doc.blockedFile = 'blocked.txt';
      if (doc.presetFile !== null) doc.presetFile = 'preset.txt';

      // Маски предыдущего проекта не должны оставаться после переключения.
      if (state.blockedMask) dispatch({ type: 'MASK_CLEARED', kind: 'blocked' });
      if (state.presetMask) dispatch({ type: 'MASK_CLEARED', kind: 'preset' });
      dispatch({ type: 'SPEC_LOADED', doc });

      setNotice(
        unknownFields.length > 0
          ? ru.files.unknownFieldsNote.replace('{fields}', unknownFields.join(', '))
          : null,
      );

      const missing = { blocked: false, preset: false };
      let loadedBlocked: ReturnType<typeof parseBlockedMaskAny> | null = null;
      let loadedPreset: string | null = null; // сериализация для базлайна
      if (origBlocked) {
        try {
          const text = await loadProjectFile(slug, origBlocked);
          const mask = parseBlockedMaskAny(text);
          dispatch({ type: 'MASK_LOADED', kind: 'blocked', mask, fileName: 'blocked.txt' });
          loadedBlocked = mask;
        } catch (e) {
          if (!isFileNotFound(e)) throw e;
          missing.blocked = true; // «файл не найден на сервере» — статус секции, не ошибка валидации
        }
      }
      if (origPreset) {
        try {
          const text = await loadProjectFile(slug, origPreset);
          const symbols = Object.values(doc.types).map((t) => t.symbol);
          const res = parsePresetMaskAny(text, symbols);
          dispatch({
            type: 'MASK_LOADED',
            kind: 'preset',
            mask: res.mask,
            fileName: 'preset.txt',
            presetErrors: res.errors,
          });
          loadedPreset = dumpMask(res.mask);
        } catch (e) {
          if (!isFileNotFound(e)) throw e;
          missing.preset = true;
        }
      }

      setFileMissing(missing);
      baselineRef.current = {
        spec: dumpSpec(doc),
        blocked: loadedBlocked ? dumpMask(loadedBlocked) : null,
        preset: loadedPreset,
      };
      markClean(); // загрузка — не «изменение» (beforeunload/подтверждения)
      void refreshResults(slug); // блок «Отчёты генераций» (замечание 4)
    } catch (e) {
      setLoadError(`${ru.project.loadError} ${errText(e)}`);
      // Состояние до этой загрузки НЕ сбрасывается (§1.3 п.4).
    } finally {
      setLoadingProject(false);
    }
  }

  // ── «＋ Создать спеку…» (ТЗ 02 §7 — сохраняется из standalone) ────────────────

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

  // ── Маски: Добавить / Удалить (управление моделью — сохраняется) ──────────────

  function addMask(kind: MaskKind): void {
    if (!spec) return;
    dispatch({ type: 'MASK_ADDED', kind });
    setFileMissing((m) => ({ ...m, [kind]: false }));
  }

  function removeMask(kind: MaskKind): void {
    const label = kind === 'blocked' ? ru.files.maskBlockedSection : ru.files.maskPresetSection;
    if (!window.confirm(ru.files.removeMaskConfirm.replace('{kind}', label))) return;
    dispatch({ type: 'MASK_CLEARED', kind });
  }

  // ── «💾 Сохранить в проект» (docs-unified/04 §1.5) ────────────────────────────

  async function saveToProject(): Promise<boolean> {
    if (!spec || !selected) return false;
    setSaving(true);
    setSaveError(null);
    try {
      const files: Record<string, string> = { 'spec.yaml': dumpSpec(spec) };
      if (state.blockedMask !== null) files['blocked.txt'] = dumpMask(state.blockedMask);
      if (state.presetMask !== null) files['preset.txt'] = dumpMask(state.presetMask);
      await saveProjectFiles(selected, files);
      baselineRef.current = {
        spec: files['spec.yaml'],
        blocked: files['blocked.txt'] ?? null,
        preset: files['preset.txt'] ?? null,
      };
      markClean();
      setSavedAt(new Date());
      return true;
    } catch (e) {
      setSaveError(`${ru.project.saveErrorTitle} ${errText(e)}`);
      return false;
    } finally {
      setSaving(false);
    }
  }

  // ── «Отчёты генераций»: история result-* проекта (замечание 4) ───────────────

  async function refreshResults(slug: string): Promise<void> {
    try {
      setResults(await listResults(slug));
    } catch {
      setResults([]); // API-сбой не критичен для редактирования — блок пустой
    }
  }

  // ── «⚡ Генерировать размещение» (docs-unified/04 §1.6) ───────────────────────

  async function onGenerate(): Promise<void> {
    if (!spec || !selected || generating) return;
    setGenerating(true);
    setGenResult(null);
    setGenError(null);
    try {
      // 1. Автосохранение: генерация работает с тем, что на диске.
      if (isDirty()) {
        const ok = await saveToProject();
        if (!ok) return; // ошибка сохранения прерывает генерацию
      }
      // Seed — опциональный integer ≥ 0; пустой ввод = не передаётся (DEFAULT_SEED солвера).
      let seed: number | undefined;
      const tSeed = seedText.trim();
      if (tSeed !== '') {
        const n = Number(tSeed);
        if (!Number.isInteger(n) || n < 0) {
          setGenError({ message: ru.project.seedInvalid, input: false });
          return;
        }
        seed = n;
      }
      // 2. POST generate (серверный таймаут 60 с вернёт 504 — клиентский не нужен).
      const res = await generatePlacement(selected, seed === undefined ? undefined : { seed });
      setGenResult(res);
      void refreshResults(selected); // новая ревизия — наверху списка (замечание 4)
    } catch (e) {
      const input = e instanceof ApiError && e.status === 422; // SOLVER_INPUT
      setGenError({ message: errText(e), input });
    } finally {
      setGenerating(false);
    }
  }

  /** Текст причины невозможности — строки отчёта ДО маркера «== КАРТА ==» (04 §1.6). */
  function infeasibleReason(report: string): string {
    const head = report.split('== КАРТА ==')[0].trim();
    const lines = head.split('\n').filter((l) => l.trim().length > 0);
    return lines.slice(1).join('\n'); // первая строка «НЕ УДАЛОСЬ…» показана отдельным заголовком
  }

  // ── Статусы секций ────────────────────────────────────────────────────────────

  function maskStatus(kind: MaskKind): string {
    const mask = kind === 'blocked' ? state.blockedMask : state.presetMask;
    if (!spec || !mask) return ru.files.notLoaded;
    const name = kind === 'blocked' ? 'blocked.txt' : 'preset.txt';
    if (fileMissing[kind]) return ru.project.fileMissing;
    if (mask.width !== spec.grid.width || mask.height !== spec.grid.height) {
      return `имя: ${name} · ${ru.files.dimMismatchMark}`;
    }
    return `имя: ${name}`;
  }

  const busy = saving || generating;
  const canSave = Boolean(spec && selected) && !busy;
  const dirtyDot = (b: boolean): string => (b ? ' ●' : '');
  const anyDirty = dirtyFiles.spec || dirtyFiles.blocked || dirtyFiles.preset;

  return (
    <section className="panel" style={{ padding: 8 }}>
      <h2 style={{ marginTop: 0 }}>{ru.panels.files}</h2>

      {/* ── Проект (docs-unified/04 §1.3) ── */}
      <div style={sectionStyle}>
        <strong>{ru.project.section}</strong>
        <div style={rowStyle}>
          <select
            aria-label={ru.project.selectAria}
            value={selected ?? ''}
            disabled={loadingProject || projects === null}
            onChange={(e) => onProjectChosen(e.target.value)}
            style={{ flex: 1, minWidth: 0 }}
          >
            <option value="">{ru.project.placeholder}</option>
            {(projects ?? []).map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        {loadingProject && (
          <div style={statusStyle}>{ru.project.loading}</div>
        )}
        {!loadingProject && projects !== null && selected && !loadError && (
          <div style={statusStyle}>
            {ru.project.loaded.replace(
              '{name}',
              (projects ?? []).find((p) => p.slug === selected)?.name ?? selected,
            )}
          </div>
        )}
        {!loadingProject && projects !== null && projects.length === 0 && (
          <div style={errorStyle}>{ru.project.noProjects}</div>
        )}
        {projectNotFound && (
          <div style={errorStyle}>
            {ru.project.notFoundBanner.replace('{name}', projectNotFound)}
          </div>
        )}
        {loadError && <div style={errorStyle}>{loadError}</div>}
      </div>

      {/* ── Спекация ── */}
      <div style={sectionStyle}>
        <strong>{ru.files.specSection}</strong>
        {spec ? (
          <div style={statusStyle}>имя: spec.yaml</div>
        ) : (
          <div style={statusStyle}>{ru.project.notSelected}</div>
        )}
        <div style={rowStyle}>
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
        onAdd={() => addMask('blocked')}
        onRemove={() => removeMask('blocked')}
      />

      {/* ── Preset-карта ── */}
      <MaskSection
        title={ru.files.maskPresetSection}
        status={maskStatus('preset')}
        disabled={!spec}
        onAdd={() => addMask('preset')}
        onRemove={() => removeMask('preset')}
      />

      {/* ── Сохранение и генерация (docs-unified/04 §1.5–§1.6) ── */}
      <div style={{ ...sectionStyle, borderTop: '1px solid #ddd', paddingTop: 8 }}>
        <div style={rowStyle}>
          <button
            type="button"
            style={canSave ? btnStyle : disabledBtnStyle}
            disabled={!canSave}
            title={!spec ? ru.grid.noSpec : !selected ? ru.project.notSelected : undefined}
            onClick={() => void saveToProject()}
          >
            {saving ? ru.project.saving : ru.project.saveBtn}
            {dirtyDot(anyDirty)}
          </button>
        </div>
        <div style={rowStyle}>
          <button
            type="button"
            style={canSave ? btnStyle : disabledBtnStyle}
            disabled={!canSave}
            aria-busy={generating || undefined}
            title={!spec ? ru.grid.noSpec : !selected ? ru.project.notSelected : undefined}
            onClick={() => void onGenerate()}
          >
            {generating ? ru.project.generating : ru.project.generateBtn}
          </button>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#555' }}>
            {ru.project.seedLabel}
            <input
              value={seedText}
              onChange={(e) => setSeedText(e.target.value)}
              disabled={!canSave || generating}
              placeholder={ru.project.seedPlaceholder}
              aria-label={ru.project.seedLabel}
              style={{ width: 90, marginTop: 0 }}
            />
          </label>
        </div>
        <div style={{ color: '#888', fontSize: 11, marginTop: 2 }}>{ru.project.seedHint}</div>

        {savedAt && !anyDirty && (
          <div style={statusStyle}>
            {ru.project.savedAt.replace('{time}', savedAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }))}
          </div>
        )}
        {saveError && <div style={errorStyle}>{saveError}</div>}

        {/* Блок результата генерации (04 §1.6) */}
        {genResult && genResult.feasible && (
          <div style={{ ...okStyle, marginTop: 8 }}>
            <div>{ru.project.genSuccess.replace('{file}', genResult.resultFile)}</div>
            <div>
              <a
                href={`/viewer3d?project=${encodeURIComponent(selected ?? '')}&result=${encodeURIComponent(genResult.resultFile)}`}
              >
                {ru.project.openViewer3d}
              </a>{' '}
              · <code>{genResult.resultFile}</code>
            </div>
            <details style={{ marginTop: 4 }}>
              <summary style={{ cursor: 'pointer', fontSize: 12 }}>{ru.project.reportDetails}</summary>
              <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11, margin: '4px 0' }}>{genResult.report}</pre>
            </details>
          </div>
        )}
        {genResult && !genResult.feasible && (
          <div style={{ ...errorStyle, marginTop: 8 }}>
            <div>{ru.project.infeasibleLead}</div>
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, margin: '4px 0' }}>
              {infeasibleReason(genResult.report)}
            </pre>
            <details style={{ marginTop: 4 }}>
              <summary style={{ cursor: 'pointer', fontSize: 12 }}>{ru.project.reportDetails}</summary>
              <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11, margin: '4px 0' }}>{genResult.report}</pre>
            </details>
          </div>
        )}
        {genError && (
          <div style={{ ...errorStyle, marginTop: 8 }}>
            <div>{ru.project.genErrorTitle} {genError.message}</div>
            {genError.input && <div>{ru.project.genInputHint}</div>}
          </div>
        )}
      </div>

      {/* ── Отчёты генераций: история result-* проекта (замечание 4) ── */}
      {selected !== null && results !== null && (
        <div style={{ ...sectionStyle, borderTop: '1px solid #ddd', paddingTop: 8 }}>
          <strong>{ru.project.historyTitle}</strong>
          {results.length === 0 ? (
            <div style={statusStyle}>{ru.project.historyEmpty}</div>
          ) : (
            results.map((r) => <ResultRow key={r.name} slug={selected} info={r} />)
          )}
        </div>
      )}
    </section>
  );
}

// Секция одной маски (docs-unified/04 §1.2): статус + Добавить / Удалить
// (загрузка и скачивание файлов удалены — проектный режим).
function MaskSection(props: {
  title: string;
  status: string;
  disabled: boolean;
  onAdd: () => void;
  onRemove: () => void;
}): JSX.Element {
  const s = props.disabled ? disabledBtnStyle : btnStyle;
  return (
    <div style={sectionStyle}>
      <strong>{props.title}</strong>
      <div style={statusStyle}>{props.status}</div>
      <div style={rowStyle}>
        <button type="button" style={s} disabled={props.disabled} title={props.disabled ? ru.grid.noSpec : undefined} onClick={props.onAdd}>
          {ru.files.addMask}
        </button>
        <button type="button" style={s} disabled={props.disabled} onClick={props.onRemove}>
          ✕ {ru.buttons.remove}
        </button>
      </div>
    </div>
  );
}

// Строка истории «Отчёты генераций» (замечание 4): имя + дата, «Открыть отчёт»
// (inline-раскрытие <details> с полным текстом — GET …/file?name=…) и ссылка «В 3D»
// (/viewer3d?project=<slug>&result=<file>).
function ResultRow(props: { slug: string; info: ResultInfo }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(): Promise<void> {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (text === null && error === null) {
      try {
        setText(await loadProjectFile(props.slug, props.info.name));
      } catch (e) {
        setError(errText(e));
      }
    }
  }

  const when = new Date(props.info.mtimeIso);
  const dateLabel = Number.isNaN(when.getTime())
    ? props.info.mtimeIso
    : when.toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

  return (
    <div style={{ marginTop: 6 }}>
      <div style={rowStyle}>
        <span title={props.info.mtimeIso} style={{ fontSize: 12 }}>
          {props.info.name} · {dateLabel}
        </span>
        <button type="button" style={btnStyle} onClick={() => void toggle()}>
          {open ? ru.project.closeReport : ru.project.openReport}
        </button>
        <a
          href={`/viewer3d?project=${encodeURIComponent(props.slug)}&result=${encodeURIComponent(props.info.name)}`}
        >
          {ru.project.report3d}
        </a>
      </div>
      {open && error !== null && (
        <div style={errorStyle}>
          {ru.project.reportLoadError} {error}
        </div>
      )}
      {open && text !== null && (
        <details open style={{ marginTop: 4 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12 }}>{props.info.name}</summary>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11, margin: '4px 0' }}>{text}</pre>
        </details>
      )}
    </div>
  );
}

/** Целое > 0 из текстового поля; null — невалидно. */
function parsePositiveInt(s: string): number | null {
  const t = s.trim();
  if (!/^\d+$/.test(t)) return null;
  const v = Number(t);
  return Number.isInteger(v) && v > 0 ? v : null;
}

/** HTTP 404 FILE_NOT_FOUND — «файл не найден на сервере» (§1.3 п.3). */
function isFileNotFound(e: unknown): boolean {
  return e instanceof ApiError && e.status === 404;
}

function errText(e: unknown): string {
  if (e instanceof MaskParseError || e instanceof Error) return e.message;
  return String(e);
}
