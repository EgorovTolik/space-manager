// ProjectPanel (docs-unified/04-integrations.md §2.1–§2.5). Была FilePanel
// (standalone: file input + drag&drop + FileReader) — проектный режим ПОЛНОСТЬЮ
// заменяет загрузку с диска:
// - селектор проекта (`GET /api/projects`) + селектор ревизий `result-*`
//   (`GET …/<p>/results`, имя desc — свежая первая); ключевая фича — переключение
//   между ревизиями генерации без потери работы (§2.1);
// - файл подгружается с сервера: `loadResultFile(p, f)` → `parseReport` →
//   REPORT_LOADED {fileName, projectName, resultName} + setSnapshotTarget (§2.3);
// - URL-параметры ?project= / ?result= — автовыбор (§2.5), смена выбора —
//   history.replaceState;
// - двухуровневое имя проекта (замечание 2): в селекторе — человекочитаемое
//   `name` (русские буквы, пробелы), а API/URL/снапшот используют `slug`;
//   URL ?project= принимает и slug, и name.
// - статус PNG-снапшота: подписка на onSnapshotResult (scene/snapshot.ts) —
//   «Предпросмотр сохранён в проект: preview-<ts>.png» на 5 с / баннер ошибки (§2.4).
// Баннер ошибок парсинга (parseError) — та же логика, что у FilePanel.

import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useViewer } from '../state/viewerStore';
import { parseReport, ReportParseError, type ParseIssue } from '../lib/reportParser';
import {
  listProjects,
  listResults,
  loadResultFile,
  type ProjectInfo,
  type ResultFile,
} from '../lib/api';
import { onSnapshotResult, setSnapshotTarget } from '../scene/snapshot';
import { ru } from '../i18n/ru';

interface ParseErrorState {
  message: string;
  issues: ParseIssue[];
}

/** Статус PNG-снапшота в панели (docs-unified/04 §2.4). */
interface SnapshotStatus {
  kind: 'saved' | 'error';
  text: string;
}

const SNAPSHOT_OK_VISIBLE_MS = 5000; // «строка статуса на 5 с» (§2.4)

export function ProjectPanel() {
  const { state, dispatch } = useViewer();
  const report = state.report;

  // ── Состояние панели (локальное React-состояние — §2.3) ────────────────────
  const [projects, setProjects] = useState<ProjectInfo[] | null>(null);
  // Выбранный проект — его SLUG (машинный идентификатор); в UI показываем name.
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [results, setResults] = useState<ResultFile[] | null>(null);
  const [selectedResult, setSelectedResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [projectNotFound, setProjectNotFound] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [parseError, setParseError] = useState<ParseErrorState | null>(null);
  const [snapshotStatus, setSnapshotStatus] = useState<SnapshotStatus | null>(null);

  // Защита от гонок: устаревшие асинхронные загрузки игнорируются.
  const loadSeqRef = useRef(0);
  const snapTimerRef = useRef<number | null>(null);
  // Зеркало списка проектов для displayName-поиска: в URL-автозагрузке state
  // ещё не обновился (setProjects и selectProject идут в одном then).
  const projectsRef = useRef<ProjectInfo[] | null>(null);
  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  // ── Статус PNG-снапшота (docs-unified/04 §2.4) ──────────────────────────────
  useEffect(() => {
    const off = onSnapshotResult((r) => {
      if ('savedToProject' in r) {
        setSnapshotStatus({ kind: 'saved', text: ru.snapshotSaved(r.savedToProject) });
        if (snapTimerRef.current !== null) window.clearTimeout(snapTimerRef.current);
        snapTimerRef.current = window.setTimeout(() => setSnapshotStatus(null), SNAPSHOT_OK_VISIBLE_MS);
      } else if ('error' in r) {
        // Ошибка — до замены новым результатом/загрузкой (нет 5-с таймера).
        setSnapshotStatus({ kind: 'error', text: ru.snapshotErrorBanner(r.error) });
      }
      // {downloaded} — dev-only fallback, в панели не показываем.
    });
    return () => {
      off();
      if (snapTimerRef.current !== null) window.clearTimeout(snapTimerRef.current);
    };
  }, []);

  // ── Загрузка ревизии (§2.3 п.2) ─────────────────────────────────────────────
  // projectSlug — для API/URL/снапшота; displayName — человекочитаемое имя в
  // строках статуса (замечание 2).
  async function loadRevision(projectSlug: string, file: string, displayName: string): Promise<void> {
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setLoadError(null);
    setSnapshotStatus(null);
    try {
      const text = await loadResultFile(projectSlug, file);
      if (seq !== loadSeqRef.current) return; // проект/ревизия уже переключены
      let parsed: ReturnType<typeof parseReport>;
      try {
        parsed = parseReport(text);
      } catch (e) {
        // Ошибка парсинга — существующий баннер; состояние НЕ меняется (§2.3).
        if (e instanceof ReportParseError) {
          setParseError({ message: e.message, issues: e.issues.filter((i) => i.level === 'error') });
        } else {
          setParseError({ message: e instanceof Error ? e.message : String(e), issues: [] });
        }
        return;
      }
      setParseError(null);
      dispatch({
        type: 'REPORT_LOADED',
        report: parsed,
        fileName: file,
        projectName: displayName, // статус — человекочитаемое имя (замечание 2)
        resultName: file,
      });
      // Цель снапшота — выбранный проект (§2.2/§2.4): путь API — по SLUG.
      setSnapshotTarget({ projectName: projectSlug });
      syncUrl(projectSlug, file); // ?project=&result= отражают текущую ревизию (§2.5)
    } catch (e) {
      if (seq !== loadSeqRef.current) return;
      setLoadError(ru.loadErrorBanner(e instanceof Error ? e.message : String(e)));
      // Состояние до этой загрузки НЕ сбрасывается.
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }

  // ── Выбор проекта (§2.3 п.1): список ревизий + автовыбор ────────────────────
  async function selectProject(slug: string, urlResult?: string | null): Promise<void> {
    const seq = ++loadSeqRef.current;
    setSelectedProject(slug);
    setProjectNotFound(null);
    setResults(null);
    setSelectedResult(null);
    setLoading(true);
    setLoadError(null);
    syncUrl(slug, null);
    const displayName =
      (projectsRef.current ?? []).find((p) => p.slug === slug)?.name ?? slug;
    try {
      const list = await listResults(slug);
      if (seq !== loadSeqRef.current) return;
      setResults(list);
      if (list.length === 0) {
        // Ревизий нет — сцена не строится, статус «нет файлов result-*».
        return;
      }
      // Автовыбор: ?result= из URL (если есть в списке), иначе первый (самый свежий).
      const wanted = urlResult !== undefined && urlResult !== null ? urlResult : null;
      const auto =
        wanted !== null && list.some((r) => r.name === wanted) ? wanted : list[0].name;
      setSelectedResult(auto);
      await loadRevision(slug, auto, displayName);
    } catch (e) {
      if (seq !== loadSeqRef.current) return;
      setLoadError(ru.loadErrorBanner(e instanceof Error ? e.message : String(e)));
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }

  /** URL-параметры ?project=&result= — replaceState (§2.5). */
  function syncUrl(project: string, result: string | null): void {
    const url = new URL(window.location.href);
    if (project.length > 0) url.searchParams.set('project', project);
    else url.searchParams.delete('project');
    if (result !== null) url.searchParams.set('result', result);
    else url.searchParams.delete('result');
    window.history.replaceState(null, '', url.toString());
  }

  // ── Старт: список проектов + URL-параметры (§2.5) ───────────────────────────
  useEffect(() => {
    let cancelled = false;
    listProjects()
      .then((list) => {
        if (cancelled) return;
        projectsRef.current = list; // до selectProject — displayName-поиск (§2.5)
        setProjects(list);
        const params = new URLSearchParams(window.location.search);
        const urlProject = params.get('project');
        if (urlProject !== null && urlProject.length > 0) {
          // URL-параметр несёт slug (ссылки редактора/менеджера); name — фолбэк.
          const match =
            list.find((p) => p.slug === urlProject) ?? list.find((p) => p.name === urlProject);
          if (match !== undefined) {
            setSelectedProject(match.slug);
            void selectProject(match.slug, params.get('result'));
          } else {
            setProjectNotFound(urlProject);
          }
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setLoadError(ru.loadErrorBanner(e instanceof Error ? e.message : String(e)));
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onProjectChange(e: ChangeEvent<HTMLSelectElement>): void {
    const slug = e.target.value; // в селекторе value — slug (замечание 2)
    if (slug.length === 0) return;
    void selectProject(slug, null);
  }

  function onResultChange(e: ChangeEvent<HTMLSelectElement>): void {
    const file = e.target.value;
    if (file.length === 0 || selectedProject === null) return;
    setSelectedResult(file);
    const displayName =
      (projectsRef.current ?? []).find((p) => p.slug === selectedProject)?.name ?? selectedProject;
    void loadRevision(selectedProject, file, displayName);
  }

  // ── Статусы ──────────────────────────────────────────────────────────────────
  const warningsCount =
    (report?.infeasible ? 1 : 0) +
    (report?.issues.filter((i) => i.level === 'warning').length ?? 0) +
    (report?.warningsSection.length ?? 0);

  let emptyHint: string | null = null;
  if (projects !== null && projects.length === 0) emptyHint = ru.noProjects;
  else if (selectedProject !== null && results !== null && results.length === 0) {
    emptyHint = ru.noResults;
  }

  return (
    <section className="panel panel-files" aria-label={ru.panelFiles}>
      <h2>{ru.panelFiles}</h2>

      {/* Селектор проекта (§2.3 п.1) */}
      <select
        className="params-input"
        aria-label={ru.projectSelectAria}
        value={selectedProject ?? ''}
        disabled={loading || projects === null}
        onChange={onProjectChange}
      >
        <option value="">{ru.projectPlaceholder}</option>
        {(projects ?? []).map((p) => (
          <option key={p.slug} value={p.slug}>
            {p.name}
          </option>
        ))}
      </select>

      {/* Селектор ревизий result-* — ключевая фича переключения (§2.1) */}
      <select
        className="params-input"
        aria-label={ru.revisionSelectAria}
        value={selectedResult ?? ''}
        disabled={loading || results === null || results.length === 0}
        onChange={onResultChange}
      >
        <option value="">{ru.revisionPlaceholder}</option>
        {(results ?? []).map((r) => (
          <option key={r.name} value={r.name}>
            {r.name}
          </option>
        ))}
      </select>

      <div className="muted">{ru.fileStatus}</div>
      {loading && <div className="muted">{ru.loadingLabel}</div>}
      {projectNotFound !== null && (
        <div className="file-error" role="alert">
          {ru.projectNotFoundBanner(projectNotFound)}
        </div>
      )}
      {loadError !== null && (
        <div className="file-error" role="alert">
          {loadError}
        </div>
      )}

      {report === null ? (
        <div className="muted">{emptyHint ?? ru.noReportLoaded}</div>
      ) : (
        <ul className="file-status">
          <li>{ru.projectFileLine(state.projectName, state.fileName)}</li>
          <li>
            {ru.gridStatusLabel} {ru.gridStatus(report.width, report.height)}
          </li>
          <li>
            {ru.roomsStatusLabel} {report.rooms.length}
          </li>
          {report.infeasible && <li className="infeasible-mark">{ru.infeasibleMark}</li>}
          {warningsCount > 0 && <li>{ru.warningsCountLabel} {warningsCount}</li>}
        </ul>
      )}

      {/* Статус PNG-снапшота (docs-unified/04 §2.4) */}
      {snapshotStatus !== null &&
        (snapshotStatus.kind === 'saved' ? (
          <div className="muted">{snapshotStatus.text}</div>
        ) : (
          <div className="file-error" role="alert">
            {snapshotStatus.text}
          </div>
        ))}

      {parseError !== null && (
        <div className="file-error" role="alert">
          <strong>{ru.parseErrorBanner}:</strong> {parseError.message}
          {parseError.issues.length > 0 && (
            <details>
              <summary>{ru.expandDetails}</summary>
              <ul>
                {parseError.issues.map((issue) => (
                  <li key={`${issue.code}-${issue.message}`}>
                    [{issue.code}] {issue.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
