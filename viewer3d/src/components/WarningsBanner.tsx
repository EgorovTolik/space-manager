// Баннер предупреждений (ТЗ 04 §9): красный блок infeasible + список W-* issues +
// строки секции «ПРЕДУПРЕЖДЕНИЯ» отчёта. Сворачивается (счётчик остаётся видим).

import { useEffect, useState } from 'react';
import { useViewer } from '../state/viewerStore';
import { ru } from '../i18n/ru';

export function WarningsBanner() {
  const { state } = useViewer();
  const report = state.report;
  const [collapsed, setCollapsed] = useState(false);

  // при смене отчёта — развёрнутый вид
  useEffect(() => {
    setCollapsed(false);
  }, [report]);

  if (report === null) return null;
  const warnings = report.issues.filter((i) => i.level === 'warning');
  const sectionLines = report.warningsSection;
  const count = (report.infeasible ? 1 : 0) + warnings.length + sectionLines.length;
  if (count === 0) return null;

  return (
    <div className="warnings-banner" role="status">
      <span>
        {ru.warningsCountLabel} {count}
      </span>{' '}
      <button type="button" onClick={() => setCollapsed((v) => !v)}>
        {collapsed ? ru.warningsBannerExpand : ru.warningsBannerCollapse}
      </button>
      {!collapsed && (
        <>
          {report.infeasible && report.infeasibleText !== null && (
            <div className="infeasible">{report.infeasibleText}</div>
          )}
          {warnings.length > 0 && (
            <ul>
              {warnings.map((issue) => (
                <li key={`${issue.code}-${issue.message}`}>
                  [{issue.code}] {issue.message}
                </li>
              ))}
            </ul>
          )}
          {sectionLines.length > 0 && (
            <ul className="warnings-section">
              {sectionLines.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
