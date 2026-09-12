// Состояние приложения (ТЗ 01 §2.3): ViewerState + исчерпывающий набор actions,
// React-контекст и хук. Паттерн — editor/src/state/editorStore.ts.

import { createContext, useContext, useReducer } from 'react';
import type { Dispatch, ReactNode } from 'react';
import type { ParsedReport } from '../lib/reportParser';

/** Пресет вида камеры (ТЗ 04 §4.4). */
export type CameraPreset = 'iso' | 'top' | 'front';

/** Параметры отображения; дефолты — таблица ТЗ 04 §3. */
export interface ViewParams {
  scale: number; // S — мировых единиц на клетку
  wallHeight: number; // Hw
  wallThickness: number; // T
  unitLabel: string; // подпись единицы
  showBlocked: boolean;
  wallsOpacity: number; // 0..1
  hideWalls: boolean;
  showLabels: boolean;
}

/** Дефолты параметров (ТЗ 04 §3, кнопка «Сбросить параметры»). */
export const DEFAULT_PARAMS: ViewParams = {
  scale: 1,
  wallHeight: 3,
  wallThickness: 0.25,
  unitLabel: 'м',
  showBlocked: true,
  wallsOpacity: 1,
  hideWalls: false,
  showLabels: true,
};

export interface ViewerState {
  report: ParsedReport | null; // null = файл не загружен
  fileName: string | null; // basename загруженного файла
  params: ViewParams;
  selection: number | null; // index выбранной комнаты (ParsedReport.rooms[i].index) или null
  cameraPreset: CameraPreset; // последний применённый пресет (04 §4.4)
}

/** Начальное состояние: отчёт не загружен, параметры — дефолты, вид — изометрия. */
export const initialViewerState: ViewerState = {
  report: null,
  fileName: null,
  params: DEFAULT_PARAMS,
  selection: null,
  cameraPreset: 'iso',
};

/** Исчерпывающий список действий (ТЗ 01 §2.3, таблица). */
export type ViewerAction =
  | { type: 'REPORT_LOADED'; report: ParsedReport; fileName: string }
  | { type: 'PARAMS_SET'; patch: Partial<ViewParams> }
  | { type: 'SELECT_ROOM'; roomId: number | null }
  | { type: 'CAMERA_PRESET'; preset: CameraPreset }
  | { type: 'RESET_PARAMS' };

/**
 * Чистый редьюсер. Правила эффектов — ТЗ 01 §2.3:
 * - REPORT_LOADED: полная замена report/fileName, сброс selection, пресет → «Изометрия»;
 * - PARAMS_SET: точечное обновление params (пересчёт геометрии — в эффекте, не здесь);
 * - SELECT_ROOM: выделение комнаты или снятие (null);
 * - CAMERA_PRESET: фиксация последнего пресета;
 * - RESET_PARAMS: params → дефолты.
 * Ошибки парсинга в состояние НЕ пишутся (report остаётся предыдущим/null).
 */
export function viewerReducer(state: ViewerState, action: ViewerAction): ViewerState {
  switch (action.type) {
    case 'REPORT_LOADED':
      return {
        report: action.report,
        fileName: action.fileName,
        params: state.params,
        selection: null,
        cameraPreset: 'iso',
      };
    case 'PARAMS_SET':
      return { ...state, params: { ...state.params, ...action.patch } };
    case 'SELECT_ROOM':
      return { ...state, selection: action.roomId };
    case 'CAMERA_PRESET':
      return { ...state, cameraPreset: action.preset };
    case 'RESET_PARAMS':
      return { ...state, params: DEFAULT_PARAMS };
    default:
      return state;
  }
}

interface ViewerStoreValue {
  state: ViewerState;
  dispatch: Dispatch<ViewerAction>;
}

const ViewerStoreContext = createContext<ViewerStoreValue | null>(null);

/** Провайдер состояния для всего дерева SPA. */
export function ViewerProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(viewerReducer, initialViewerState);
  return (
    <ViewerStoreContext.Provider value={{ state, dispatch }}>
      {children}
    </ViewerStoreContext.Provider>
  );
}

/** Хук доступа к состоянию; бросает при использовании вне ViewerProvider. */
export function useViewer(): ViewerStoreValue {
  const value = useContext(ViewerStoreContext);
  if (value === null) {
    throw new Error('useViewer: компонент должен находиться внутри <ViewerProvider>');
  }
  return value;
}
