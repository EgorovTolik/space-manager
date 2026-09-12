// Баннер предупреждений (ТЗ 04 §9) — заглушка скелета: рисуется только когда есть
// что показать (infeasible / W-* / строки секции ПРЕДУПРЕЖДЕНИЯ).

import { useViewer } from '../state/viewerStore';
import { ru } from '../i18n/ru';

export function WarningsBanner() {
  const { state } = useViewer();
  const report = state.report;
  if (report === null) return null;

  const warningsSection = report.warningsSection.length;
  const hasContent = report.infeasible || report.issues.length > 0 || warningsSection > 0;
  if (!hasContent) return null;

  const count =
    (report.infeasible ? 1 : 0) + report.issues.length + warningsSection;
  return (
    <div className="warnings-banner" role="status">
      {report.infeasible && <div className="infeasible">{report.infeasibleText ?? ''}</div>}
      <span>
        {ru.warningsCountLabel} {count} · {ru.warningsBannerCollapse}
      </span>
    </div>
  );
}
