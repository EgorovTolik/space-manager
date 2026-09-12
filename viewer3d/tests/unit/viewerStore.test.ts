// Unit-тесты state-модуля (ТЗ 01 §2.3): все actions редьюсера + дефолты.

import { describe, it, expect } from 'vitest';
import {
  viewerReducer,
  initialViewerState,
  DEFAULT_PARAMS,
} from '../../src/state/viewerStore';
import type { ViewerState } from '../../src/state/viewerStore';
import type { ParsedReport } from '../../src/lib/reportParser';

const fakeReport: ParsedReport = {
  width: 4,
  height: 3,
  map: [],
  rooms: [
    {
      index: 1,
      label: 'room1',
      symbol: 'A',
      typeId: null,
      tableRow: null,
      cells: [[0, 0]],
      size: 1,
      bbox: { x0: 0, y0: 0, x1: 0, y1: 0 },
      centroid: { x: 0.5, y: 0.5 },
    },
  ],
  blockedCells: [],
  unknownCells: [],
  tableRows: [],
  unmatchedRows: [],
  infeasible: false,
  infeasibleText: null,
  warningsSection: [],
  issues: [],
};

const loadedState: ViewerState = {
  ...initialViewerState,
  report: fakeReport,
  fileName: 'result-20260913-000000.txt',
  selection: 1,
  cameraPreset: 'top',
};

describe('viewerReducer', () => {
  it('initialViewerState: отчёт не загружен, параметры — дефолты, пресет iso', () => {
    expect(initialViewerState.report).toBeNull();
    expect(initialViewerState.fileName).toBeNull();
    expect(initialViewerState.params).toEqual(DEFAULT_PARAMS);
    expect(initialViewerState.selection).toBeNull();
    expect(initialViewerState.cameraPreset).toBe('iso');
  });

  it('REPORT_LOADED: полная замена report/fileName, сброс selection, пресет → iso', () => {
    const next = viewerReducer(loadedState, {
      type: 'REPORT_LOADED',
      report: fakeReport,
      fileName: 'result-new.txt',
    });
    expect(next.report).toBe(fakeReport);
    expect(next.fileName).toBe('result-new.txt');
    expect(next.selection).toBeNull();
    expect(next.cameraPreset).toBe('iso');
    // params не затрагиваются загрузкой
    const withCustom: ViewerState = { ...loadedState, params: { ...DEFAULT_PARAMS, scale: 2 } };
    expect(viewerReducer(withCustom, { type: 'REPORT_LOADED', report: fakeReport, fileName: 'x' }).params.scale).toBe(2);
  });

  it('PARAMS_SET: точечное обновление params, остальное не трогает', () => {
    const next = viewerReducer(initialViewerState, { type: 'PARAMS_SET', patch: { scale: 2.5, hideWalls: true } });
    expect(next.params.scale).toBe(2.5);
    expect(next.params.hideWalls).toBe(true);
    expect(next.params.wallHeight).toBe(DEFAULT_PARAMS.wallHeight);
    expect(next.report).toBeNull();
  });

  it('SELECT_ROOM: выделение и снятие (null)', () => {
    expect(viewerReducer(initialViewerState, { type: 'SELECT_ROOM', roomId: 1 }).selection).toBe(1);
    expect(viewerReducer(loadedState, { type: 'SELECT_ROOM', roomId: null }).selection).toBeNull();
  });

  it('CAMERA_PRESET: фиксация пресета, остальное не трогает', () => {
    const next = viewerReducer(initialViewerState, { type: 'CAMERA_PRESET', preset: 'front' });
    expect(next.cameraPreset).toBe('front');
    expect(next.selection).toBeNull();
  });

  it('RESET_PARAMS: params → дефолты даже после изменений', () => {
    const dirty: ViewerState = {
      ...initialViewerState,
      params: { ...DEFAULT_PARAMS, scale: 5, wallHeight: 7, unitLabel: 'фт' },
    };
    const next = viewerReducer(dirty, { type: 'RESET_PARAMS' });
    expect(next.params).toEqual(DEFAULT_PARAMS);
    // отчёт и selection не сбрасываются
    expect(viewerReducer(loadedState, { type: 'RESET_PARAMS' }).report).toBe(fakeReport);
  });

  it('дефолты ViewParams совпадают с таблицей ТЗ 04 §3', () => {
    expect(DEFAULT_PARAMS).toEqual({
      scale: 1,
      wallHeight: 3,
      wallThickness: 0.25,
      unitLabel: 'м',
      showBlocked: true,
      wallsOpacity: 1,
      hideWalls: false,
      showLabels: true,
    });
  });
});
