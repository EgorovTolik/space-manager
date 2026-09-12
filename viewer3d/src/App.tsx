// Layout приложения (ТЗ 04 §1): трёхколоночная раскладка.
//   левая  — FilePanel + ParamsPanel
//   центр  — Toolbar + WarningsBanner + 3D-сцена + строка статуса
//   правая — RoomsPanel + InfoPanel + Legend

import { FilePanel } from './components/FilePanel';
import { ParamsPanel } from './components/ParamsPanel';
import { RoomsPanel } from './components/RoomsPanel';
import { InfoPanel } from './components/InfoPanel';
import { Legend } from './components/Legend';
import { WarningsBanner } from './components/WarningsBanner';
import { Toolbar } from './components/Toolbar';
import { Scene } from './scene/Scene';
import { useViewer } from './state/viewerStore';
import { ru } from './i18n/ru';

function StatusLine() {
  const { state } = useViewer();
  if (state.report === null) return null;
  // Строка статуса по ТЗ 04 §4.5; число боксов стен появится со сценой (подзадача 5).
  return <div className="status-line">{ru.statusLine(state.report.width, state.report.height, state.params.scale, state.params.unitLabel, state.report.rooms.length, 0)}</div>;
}

export function App() {
  const { state } = useViewer();
  return (
    <div className="app">
      <header className="app-header">
        <h1>{ru.appTitle}</h1>
      </header>
      <div className="app-body">
        <aside className="col-left">
          <FilePanel />
          <ParamsPanel />
        </aside>
        <main className="col-center">
          <Toolbar />
          <WarningsBanner />
          <div className="scene-wrap">
            <Scene />
            {state.report === null && (
              <div className="scene-placeholder">{ru.scenePlaceholder}</div>
            )}
          </div>
          <StatusLine />
        </main>
        <aside className="col-right">
          <RoomsPanel />
          <InfoPanel />
          <Legend />
        </aside>
      </div>
    </div>
  );
}
