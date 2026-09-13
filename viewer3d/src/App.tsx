// Layout приложения (ТЗ 04 §1): трёхколоночная раскладка.
//   левая  — ProjectPanel + ParamsPanel
//   центр  — Toolbar + WarningsBanner + 3D-сцена + строка статуса
//   правая — RoomsPanel + InfoPanel + Legend
// Плюс: горячие клавиши (ТЗ 04 §12) и общий пересчёт боксов стен (debounce 200 мс).

import { useEffect } from 'react';
import { ProjectPanel } from './components/ProjectPanel';
import { ParamsPanel } from './components/ParamsPanel';
import { RoomsPanel } from './components/RoomsPanel';
import { InfoPanel } from './components/InfoPanel';
import { Legend } from './components/Legend';
import { WarningsBanner } from './components/WarningsBanner';
import { Toolbar } from './components/Toolbar';
import { Scene } from './scene/Scene';
import { useWallBoxes } from './scene/useWallBoxes';
import { useViewer } from './state/viewerStore';
import type { CameraPreset } from './state/viewerStore';
import { ru } from './i18n/ru';

const KEY_TO_PRESET: Record<string, CameraPreset> = { '1': 'iso', '2': 'top', '3': 'front' };

/** Горячие клавиши (ТЗ 04 §12): 1/2/3 — пресеты, Esc — снять выделение.
 *  Игнорируются, когда фокус в текстовом поле. */
function useHotkeys(): void {
  const { dispatch } = useViewer();
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const el = document.activeElement as HTMLElement | null;
      if (
        el !== null &&
        (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
      ) {
        return;
      }
      const preset = KEY_TO_PRESET[e.key];
      if (preset !== undefined) {
        dispatch({ type: 'CAMERA_PRESET', preset });
      } else if (e.key === 'Escape') {
        dispatch({ type: 'SELECT_ROOM', roomId: null });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dispatch]);
}

function StatusLine({ wallBoxesCount }: { wallBoxesCount: number }) {
  const { state } = useViewer();
  if (state.report === null) return null;
  // Строка статуса по ТЗ 04 §4.5 + docs-unified/04 §2.2 (префикс «проект · файл»)
  return (
    <div className="status-line">
      {ru.statusLine(
        state.report.width,
        state.report.height,
        state.params.scale,
        state.params.unitLabel,
        state.report.rooms.length,
        wallBoxesCount,
        state.projectName,
        state.resultName,
      )}
    </div>
  );
}

export function App() {
  const { state } = useViewer();
  useHotkeys();
  // Боксы стен (debounce S/T — 200 мс) считаются здесь: их использует и сцена,
  // и строка статуса («стен: N боксов»).
  const wallBoxes = useWallBoxes(state.report, state.params.scale, state.params.wallThickness);

  return (
    <div className="app">
      <header className="app-header">
        {/* Замечание 1: самая левая кнопка — зелёная «К проектам» (менеджер, /). */}
        <a href="/" className="to-projects">
          {ru.toProjects}
        </a>
        <h1>{ru.appTitle}</h1>
      </header>
      <div className="app-body">
        <aside className="col-left">
          <ProjectPanel />
          <ParamsPanel />
        </aside>
        <main className="col-center">
          <Toolbar />
          <WarningsBanner />
          <div className="scene-wrap">
            <Scene wallBoxes={wallBoxes} />
            {state.report === null && (
              <div className="scene-placeholder">{ru.scenePlaceholder}</div>
            )}
          </div>
          <StatusLine wallBoxesCount={wallBoxes.length} />
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
