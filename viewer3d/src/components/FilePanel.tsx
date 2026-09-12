// Панель «Файл» (ТЗ 04 §2): загрузка отчёта (кнопка + drag&drop), FileReader,
// статусы, ошибки парсинга V-* (баннер с первым сообщением + список в details).

import { useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { useViewer } from '../state/viewerStore';
import { parseReport, ReportParseError, type ParseIssue } from '../lib/reportParser';
import { ru } from '../i18n/ru';

interface ParseErrorState {
  message: string;
  issues: ParseIssue[];
}

export function FilePanel() {
  const { state, dispatch } = useViewer();
  const inputRef = useRef<HTMLInputElement>(null);
  const [parseError, setParseError] = useState<ParseErrorState | null>(null);
  const report = state.report;

  // Чтение — FileReader.readAsText (ТЗ 04 §2). Успех → REPORT_LOADED (полная замена
  // состояния, без подтверждения). Ошибка → локальный баннер, состояние не меняется.
  const loadFile = (file: File): void => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = parseReport(String(reader.result ?? ''));
        setParseError(null);
        dispatch({ type: 'REPORT_LOADED', report: parsed, fileName: file.name });
      } catch (e) {
        if (e instanceof ReportParseError) {
          setParseError({ message: e.message, issues: e.issues.filter((i) => i.level === 'error') });
        } else {
          setParseError({ message: e instanceof Error ? e.message : String(e), issues: [] });
        }
      }
    };
    reader.readAsText(file, 'utf-8');
  };

  const onDrop = (e: DragEvent<HTMLElement>): void => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file !== undefined) loadFile(file);
  };

  const warningsCount =
    (report?.infeasible ? 1 : 0) +
    (report?.issues.filter((i) => i.level === 'warning').length ?? 0) +
    (report?.warningsSection.length ?? 0);

  return (
    <section
      className="panel panel-files"
      aria-label={ru.panelFiles}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <h2>{ru.panelFiles}</h2>
      <div className="muted">{ru.fileStatus}</div>
      <input
        ref={inputRef}
        type="file"
        accept=".txt,text/plain"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file !== undefined) loadFile(file);
          e.target.value = ''; // повторная загрузка того же файла тоже срабатывает
        }}
      />
      <button type="button" onClick={() => inputRef.current?.click()}>
        {ru.loadReportButton}
      </button>
      {report === null ? (
        <div className="muted">{ru.noReportLoaded}</div>
      ) : (
        <ul className="file-status">
          <li>
            {ru.fileNameLabel} {state.fileName ?? '—'}
          </li>
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
