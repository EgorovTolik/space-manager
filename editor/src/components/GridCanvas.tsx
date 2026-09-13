// Canvas-редактор сетки (ТЗ 04 §3): режимы маски, инструменты (кисть/прямоугольник/
// ластик), палитра preset из типов, viewport (панорамирование МЛМ и Space+ЛКМ, зум к
// курсору колесом, «fit» по `0`, миникарта, строка статуса), hit-testing и горячие
// клавиши (§3.7), запрет рисования масок друг поверх друга (§3.6), подсветка ошибок
// красным пунктиром (§3.5) и валидация на лету через validateAll с debounce 300 мс (§7).
//
// Производительность: рендер только видимых клеток (crop, ТЗ 04 §3.4), stroke-клетки
// применяются батчами не чаще одного раза в кадр (requestAnimationFrame), перерисовка —
// не более одного redraw на кадр. Чистая геометрия вынесена в lib/gridView.ts.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { ru } from '../i18n/ru';
import { useEditor } from '../state/editorStore';
import type { BlockedCellValue, CellValue, PresetCellValue } from '../lib/types';
import { cellValueKey, floodFill } from '../lib/fill';
import { bresenham } from '../lib/bresenham';
import { validateAll } from '../lib/validation';
import { cellPx, clampZoom, fitCellPx, hitTest, visibleRange, zoomAtCursor } from '../lib/gridView';
import { buildTypePalette, textColorFor } from '../lib/typeColors';

// Канонические цвета (ТЗ 04 §3.1)
const C_BLOCKED = '#333333';
const C_FREE_BLOCKED = '#ffffff';
const C_FREE_PRESET = '#f5f5f5';
const C_GRID_LINE = '#dddddd';
const C_BLOCKED_CONTEXT = 'rgba(204, 204, 204, 0.4)'; // #cccccc, 40%
const C_ERROR = '#e53935';
const C_UNKNOWN_SYMBOL = '#888888';
const C_RECT_SEL = '#f5a623';

const TEXT_ZOOM = 8; // при z ≥ 8 — текст символа в клетке preset (ТЗ 04 §3.4)
const VALIDATION_DEBOUNCE_MS = 300; // ТЗ 04 §7
const MINIMAP_MAX_PX = 200; // миникарта ≤ 200 px по большей стороне (ТЗ 04 §3.4)
const HINT_TTL_MS = 3000;

type MaskKind = 'blocked' | 'preset';

interface StrokeGesture {
  kind: 'stroke';
  mask: MaskKind;
  value: CellValue;
  visited: Set<string>;
  pending: [number, number][];
  flushScheduled: boolean;
}

interface PanGesture {
  kind: 'pan';
  startClientX: number;
  startClientY: number;
  startPanX: number;
  startPanY: number;
}

interface RectGesture {
  kind: 'rect';
  mask: MaskKind;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

// Линия (ST-2): drag как у прямоугольника; по pointerup — Брезенхэм от старта к концу.
interface LineGesture {
  kind: 'line';
  mask: MaskKind;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

type Gesture = StrokeGesture | PanGesture | RectGesture | LineGesture;

export default function GridCanvas(): JSX.Element {
  const { state, dispatch } = useEditor();

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const miniRef = useRef<HTMLCanvasElement | null>(null);

  // Размер области viewport (px) — из ResizeObserver
  const [view, setView] = useState({ w: 0, h: 0 });
  // Клетка под курсором для строки статуса (ТЗ 04 §3.4)
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  // Временная подсказка (защита §3.6, undo-подсказка, палитра)
  const [hint, setHintState] = useState<string | null>(null);

  // Актуальные значения для native-обработчиков и rAF-колбэков (без stale closures)
  const stateRef = useRef(state);
  stateRef.current = state;
  const viewRef = useRef(view);
  viewRef.current = view;

  const gestureRef = useRef<Gesture | null>(null);
  const spaceHeldRef = useRef(false);
  const hintTimerRef = useRef<number | null>(null);
  // Прямоугольник-рамка для предпросмотра (рисуется на canvas, не в React)
  const rectSelRef = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  // Линия для предпросмотра drag (ST-2) — аналогично rectSelRef
  const lineSelRef = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  const setHint = useCallback((msg: string) => {
    setHintState(msg);
    if (hintTimerRef.current !== null) window.clearTimeout(hintTimerRef.current);
    hintTimerRef.current = window.setTimeout(() => setHintState(null), HINT_TTL_MS);
  }, []);

  // ── Вывод на canvas ────────────────────────────────────────────────────────

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const st = stateRef.current;
    const { w: viewW, h: viewH } = viewRef.current;
    if (viewW <= 0 || viewH <= 0) return;
    if (canvas.width !== viewW) canvas.width = viewW;
    if (canvas.height !== viewH) canvas.height = viewH;

    const spec = st.spec;
    if (!spec) {
      ctx.fillStyle = C_FREE_BLOCKED;
      ctx.fillRect(0, 0, viewW, viewH);
      return;
    }
    const gridW = spec.grid.width;
    const gridH = spec.grid.height;
    const base = fitCellPx(viewW, viewH, gridW, gridH);
    const size = cellPx(base, st.ui.zoom);

    // Какой вид маски рисуем: активный режим, если его маска загружена, иначе —
    // другой загруженный (кнопка режима сама неактивна без маски, ТЗ 04 §3.1)
    const blockedMask = st.blockedMask;
    const presetMask = st.presetMask;
    let kind: MaskKind | null = null;
    if (st.ui.maskMode === 'blocked') {
      kind = blockedMask ? 'blocked' : presetMask ? 'preset' : null;
    } else {
      kind = presetMask ? 'preset' : blockedMask ? 'blocked' : null;
    }

    ctx.fillStyle = kind === 'preset' ? C_FREE_PRESET : C_FREE_BLOCKED;
    ctx.fillRect(0, 0, viewW, viewH);
    if (!kind) return; // заглушка «маски не загружены» — DOM-оверлей

    const range = visibleRange(viewW, viewH, st.ui.pan, size, gridW, gridH);
    if (range.empty) return;

    // Если размер маски ≠ grid (V-MASK-DIM, ТЗ 04 §3.5) — рисуем только пересечение,
    // за его пределами клетки маски не существуют. Границы — по СОБСТВЕННОМУ размеру
    // каждой маски (в ошибочном состоянии они могут различаться).
    const bmW = blockedMask ? Math.min(gridW, blockedMask.width) : 0;
    const bmH = blockedMask ? Math.min(gridH, blockedMask.height) : 0;
    const pmW = presetMask ? Math.min(gridW, presetMask.width) : 0;
    const pmH = presetMask ? Math.min(gridH, presetMask.height) : 0;

    const palette = buildTypePalette(Object.entries(spec.types));
    const panX = st.ui.pan.x;
    const panY = st.ui.pan.y;

    // Занятые клетки в видимом диапазоне (crop)
    for (let y = range.y0; y <= range.y1; y++) {
      for (let x = range.x0; x <= range.x1; x++) {
        const px = panX + x * size;
        const py = panY + y * size;
        if (kind === 'blocked') {
          if (blockedMask && x < bmW && y < bmH && blockedMask.cells[y][x] === 'blocked') {
            ctx.fillStyle = C_BLOCKED;
            ctx.fillRect(px, py, size, size);
          }
        } else {
          // Контекст: блокировки маски блокировок — полупрозрачный серый (ТЗ 04 §3.1)
          if (blockedMask && x < bmW && y < bmH && blockedMask.cells[y][x] === 'blocked') {
            ctx.fillStyle = C_BLOCKED_CONTEXT;
            ctx.fillRect(px, py, size, size);
          }
          const c = presetMask && x < pmW && y < pmH ? presetMask.cells[y][x] : null;
          if (c && c.kind === 'preset') {
            const color = palette.bySymbol.get(c.symbol) ?? C_UNKNOWN_SYMBOL;
            ctx.fillStyle = color;
            ctx.fillRect(px, py, size, size);
            // Текст символа при зуме ≥ 8 (ТЗ 04 §3.4)
            if (st.ui.zoom >= TEXT_ZOOM && size >= 12) {
              ctx.fillStyle = textColorFor(color);
              ctx.font = `bold ${Math.floor(size * 0.7)}px system-ui, sans-serif`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(c.symbol, px + size / 2, py + size / 2);
            }
          }
        }
      }
    }

    // Сетка линий (ТЗ 04 §3.1)
    ctx.strokeStyle = C_GRID_LINE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const firstPxX = panX + range.x0 * size;
    for (let i = range.x0; i <= range.x1 + 1; i++) {
      const px = Math.round(panX + i * size) + 0.5;
      ctx.moveTo(px, panY + range.y0 * size);
      ctx.lineTo(px, panY + (range.y1 + 1) * size);
    }
    for (let j = range.y0; j <= range.y1 + 1; j++) {
      const py = Math.round(panY + j * size) + 0.5;
      ctx.moveTo(firstPxX, py);
      ctx.lineTo(panX + (range.x1 + 1) * size, py);
    }
    ctx.stroke();

    // Подсветка ошибок: клетки cells[] — красный пунктир (ТЗ 04 §3.5 / §7)
    if (st.ui.errors.length > 0) {
      ctx.strokeStyle = C_ERROR;
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1.5;
      const seen = new Set<string>();
      for (const err of st.ui.errors) {
        if (!err.cells) continue;
        for (const [ex, ey] of err.cells) {
          const key = `${ex},${ey}`;
          if (seen.has(key)) continue;
          seen.add(key);
          ctx.strokeRect(panX + ex * size + 1, panY + ey * size + 1, size - 2, size - 2);
        }
      }
      ctx.setLineDash([]);
    }

    // Рамка прямоугольной заливки (drag, ТЗ 04 §3.7)
    const sel = rectSelRef.current;
    if (sel) {
      const x0 = Math.min(sel.x0, sel.x1);
      const y0 = Math.min(sel.y0, sel.y1);
      const x1 = Math.max(sel.x0, sel.x1);
      const y1 = Math.max(sel.y0, sel.y1);
      ctx.strokeStyle = C_RECT_SEL;
      ctx.lineWidth = 2;
      ctx.strokeRect(panX + x0 * size, panY + y0 * size, (x1 - x0 + 1) * size, (y1 - y0 + 1) * size);
    }

    // Предпросмотр линии (drag, ST-2): полупрозрачные клетки вдоль Брезенхэма
    // в стиле C_RECT_SEL; предпросмотр не зависит от размера (линия ≤ grid).
    const line = lineSelRef.current;
    if (line) {
      ctx.fillStyle = 'rgba(245, 166, 35, 0.45)'; // C_RECT_SEL с прозрачностью
      for (const [lx, ly] of bresenham(line.x0, line.y0, line.x1, line.y1)) {
        ctx.fillRect(panX + lx * size, panY + ly * size, size, size);
      }
    }

    drawMinimap(palette);
  }, []);

  // Миникарта: мини-превью всей сетки + рамка текущего viewport; клик — перемещение
  // центра (ТЗ 04 §3.4). Отдельный небольшой canvas ≤ 200 px по большей стороне.
  const drawMinimap = useCallback((palette: ReturnType<typeof buildTypePalette>) => {
    const mini = miniRef.current;
    if (!mini) return;
    const st = stateRef.current;
    const spec = st.spec;
    if (!spec) {
      mini.width = 0;
      mini.height = 0;
      return;
    }
    const gridW = spec.grid.width;
    const gridH = spec.grid.height;
    const scale = Math.min(MINIMAP_MAX_PX / gridW, MINIMAP_MAX_PX / gridH);
    const mw = Math.max(1, Math.round(gridW * scale));
    const mh = Math.max(1, Math.round(gridH * scale));
    if (mini.width !== mw) mini.width = mw;
    if (mini.height !== mh) mini.height = mh;
    const mctx = mini.getContext('2d');
    if (!mctx) return;

    mctx.fillStyle = '#ffffff';
    mctx.fillRect(0, 0, mw, mh);
    for (let y = 0; y < gridH; y++) {
      for (let x = 0; x < gridW; x++) {
        let color: string | null = null;
        const bm = st.blockedMask;
        const pm = st.presetMask;
        if (bm && x < bm.width && y < bm.height && bm.cells[y][x] === 'blocked') {
          color = C_BLOCKED;
        } else if (pm && x < pm.width && y < pm.height) {
          const c = pm.cells[y][x];
          if (c.kind === 'preset') color = palette.bySymbol.get(c.symbol) ?? C_UNKNOWN_SYMBOL;
        }
        if (color) {
          mctx.fillStyle = color;
          mctx.fillRect(Math.floor(x * scale), Math.floor(y * scale), Math.ceil(scale), Math.ceil(scale));
        }
      }
    }
    // Рамка видимой области
    const { w: viewW, h: viewH } = viewRef.current;
    if (viewW > 0 && viewH > 0) {
      const base = fitCellPx(viewW, viewH, gridW, gridH);
      const size = cellPx(base, st.ui.zoom);
      const range = visibleRange(viewW, viewH, st.ui.pan, size, gridW, gridH);
      if (!range.empty) {
        mctx.strokeStyle = '#1565c0';
        mctx.lineWidth = 1;
        mctx.strokeRect(
          range.x0 * scale - 0.5,
          range.y0 * scale - 0.5,
          (range.x1 - range.x0 + 1) * scale + 1,
          (range.y1 - range.y0 + 1) * scale + 1,
        );
      }
    }
  }, []);

  const drawRef = useRef(draw);
  drawRef.current = draw;

  // Размер canvas (атрибуты width/height) синхронизируем с viewport'ом СИНХРОННО
  // при каждом изменении view: иначе элемент «догоняет» размер в rAF внутри draw(),
  // и между кадрами DOM-геометрия ≠ fit (hover/click по boundingBox попадают не в ту клетку).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || view.w <= 0 || view.h <= 0) return;
    if (canvas.width !== view.w) canvas.width = view.w;
    if (canvas.height !== view.h) canvas.height = view.h;
  }, [view]);

  // Не более одного redraw на кадр (ТЗ 04 §3.7)
  const drawScheduled = useRef(false);
  const requestDraw = useCallback(() => {
    if (drawScheduled.current) return;
    drawScheduled.current = true;
    requestAnimationFrame(() => {
      drawScheduled.current = false;
      drawRef.current();
    });
  }, []);

  // Перерисовка при любом изменении модели/UI/размера области
  useEffect(() => {
    requestDraw();
  }, [state, view, requestDraw]);

  // ── Валидация на лету (ТЗ 04 §7): debounce 300 мс по изменению spec/масок ──
  const { spec, blockedMask, presetMask } = state;
  useEffect(() => {
    const t = window.setTimeout(() => {
      // Ошибки чтения preset-файла (ui.presetFileErrors) пробрасываются в validateAll
      // (ТЗ 05 §2.2): файл с неизвестными символами загружается, клетки — free.
      dispatch({
        type: 'UI_SET_ERRORS',
        errors: validateAll({ spec, blockedMask, presetMask, presetParseErrors: state.ui.presetFileErrors }),
      });
    }, VALIDATION_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [spec, blockedMask, presetMask, state.ui.presetFileErrors, dispatch]);

  // Выбранный символ палитры исчез (тип удалён) — сбрасываем выбор
  useEffect(() => {
    const s = state.ui.paletteSymbol;
    if (!s || !state.spec) return;
    if (!Object.values(state.spec.types).some((t) => t.symbol === s)) {
      dispatch({ type: 'UI_SET_PALETTE_SYMBOL', symbol: null });
    }
  }, [state.spec, state.ui.paletteSymbol, dispatch]);

  // ── Размер области (ResizeObserver) ────────────────────────────────────────
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setView({ w: Math.floor(entry.contentRect.width), h: Math.floor(entry.contentRect.height) });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Вспомогательное: текущая геометрия и редактируемость ──────────────────

  function currentGeometry() {
    const st = stateRef.current;
    const spec = st.spec;
    if (!spec) return null;
    const base = fitCellPx(viewRef.current.w, viewRef.current.h, spec.grid.width, spec.grid.height);
    const size = cellPx(base, st.ui.zoom);
    return { size, gridW: spec.grid.width, gridH: spec.grid.height };
  }

  function activeMaskKind(): MaskKind | null {
    const st = stateRef.current;
    if (!st.spec) return null;
    const preferBlocked = st.ui.maskMode === 'blocked';
    const primary: MaskKind = preferBlocked ? 'blocked' : 'preset';
    const secondary: MaskKind = preferBlocked ? 'preset' : 'blocked';
    if ((primary === 'blocked' ? st.blockedMask : st.presetMask)) return primary;
    if ((secondary === 'blocked' ? st.blockedMask : st.presetMask)) return secondary;
    return null;
  }

  // Маска редактируема, только если её размер совпадает с grid (ТЗ 04 §3.5)
  function isEditable(kind: MaskKind): boolean {
    const st = stateRef.current;
    if (!st.spec) return false;
    const m = kind === 'blocked' ? st.blockedMask : st.presetMask;
    if (!m) return false;
    return m.width === st.spec.grid.width && m.height === st.spec.grid.height;
  }

  // Запрет рисования масок друг поверх друга (ТЗ 04 §3.6): подсказка или null
  function crossMaskHint(kind: MaskKind, x: number, y: number): string | null {
    const st = stateRef.current;
    if (!st.spec) return ru.grid.noSpec;
    if (kind === 'blocked') {
      const pm = st.presetMask;
      if (pm && y < pm.height && x < pm.width) {
        const c = pm.cells[y][x];
        if (c.kind === 'preset') {
          const palette = buildTypePalette(Object.entries(st.spec.types));
          return ru.grid.occupiedByPreset.replace('{type}', palette.symbolToType.get(c.symbol) ?? c.symbol);
        }
      }
      return null;
    }
    const bm = st.blockedMask;
    if (bm && y < bm.height && x < bm.width && bm.cells[y][x] === 'blocked') {
      return ru.grid.blockedCell;
    }
    return null;
  }

  // ── Заливка (ST-2): одиночный клик → flood-fill связной области за ОДИН
  //    STROKE_APPLY (готовый список клеток, без rAF-потока). Клетки другой маски —
  //    граница области. Область любого размера (включая > 20000 клеток) заливается
  //    одним батчем: перерисовка один раз, предпросмотра нет.
  function applyFill(kind: MaskKind, cx: number, cy: number): void {
    const st = stateRef.current;
    if (!st.spec) return;
    const hint = crossMaskHint(kind, cx, cy);
    if (hint) {
      setHint(hint);
      return;
    }

    if (kind === 'blocked') {
      const bm = st.blockedMask;
      const pm = st.presetMask;
      if (!bm) return;
      // Клетки, занятые preset-маской, — граница области (защита §3.6).
      const eff: ('blocked' | 'free' | null)[][] = bm.cells.map((row, y) =>
        row.map((v, x) =>
          pm && x < pm.width && y < pm.height && pm.cells[y][x].kind === 'preset' ? null : v,
        ),
      );
      const start = eff[cy]?.[cx];
      if (start == null) return; // недостижимо: crossMaskHint выше
      // Toggle-семантика кисти, расширенная на всю 8-связную область.
      const value: BlockedCellValue = start === 'blocked' ? 'free' : 'blocked';
      const cells = floodFill(eff, cx, cy, (a, b) => a === b);
      dispatch({ type: 'STROKE_APPLY', kind: 'blocked', cells, value });
      return;
    }

    // preset-маска: symbol из палитры обязателен (как у кисти)
    const symbol = st.ui.paletteSymbol;
    if (!symbol) {
      setHint(ru.grid.paletteHint);
      return;
    }
    const pm = st.presetMask;
    const bm = st.blockedMask;
    if (!pm) return;
    // Клетки blocked-маски — граница области.
    const eff: (PresetCellValue | null)[][] = pm.cells.map((row, y) =>
      row.map((v, x) =>
        bm && x < bm.width && y < bm.height && bm.cells[y][x] === 'blocked' ? null : v,
      ),
    );
    const start = eff[cy]?.[cx];
    // Клик по области, уже равной целевому символу — noop (как в Paint).
    if (!start || (start.kind === 'preset' && start.symbol === symbol)) return;
    const cells = floodFill(eff, cx, cy, (a, b) => cellValueKey(a) === cellValueKey(b));
    dispatch({ type: 'STROKE_APPLY', kind: 'preset', cells, value: { kind: 'preset', symbol } });
  }

  // ── Stroke: батчи через rAF, не чаще раза в кадр (ТЗ 04 §3.7) ─────────────

  const flushStroke = useCallback(() => {
    const g = gestureRef.current;
    if (!g || g.kind !== 'stroke') return;
    if (g.pending.length > 0) {
      dispatch({ type: 'STROKE_APPLY', kind: g.mask, cells: g.pending, value: g.value });
      g.pending = [];
    }
  }, [dispatch]);

  const scheduleStrokeFlush = useCallback(() => {
    const g = gestureRef.current;
    if (!g || g.kind !== 'stroke' || g.flushScheduled) return;
    g.flushScheduled = true;
    requestAnimationFrame(() => {
      const cur = gestureRef.current;
      if (cur && cur.kind === 'stroke') cur.flushScheduled = false;
      flushStroke();
    });
  }, [flushStroke]);

  // ── Обработчики указателя (ТЗ 04 §3.7) ────────────────────────────────────

  function localPos(e: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  // Pointer Capture в try/catch: для синтетических событий (headless/тесты) активного
  // указателя может не быть — поведение без capture идентично внутри одного canvas.
  function capturePointer(id: number): void {
    try {
      canvasRef.current?.setPointerCapture(id);
    } catch {
      /* noop */
    }
  }
  function releasePointer(el: HTMLCanvasElement | null, id: number): void {
    if (!el) return;
    try {
      el.releasePointerCapture(id);
    } catch {
      /* noop */
    }
  }

  function onPointerDown(e: ReactPointerEvent<HTMLCanvasElement>): void {
    if (e.button === 2) return; // контекстное меню — preventDefault ниже, действий нет
    e.preventDefault();
    const st = stateRef.current;
    if (!st.spec) return;

    // Панорамирование: МЛК drag или Space+ЛКМ (ТЗ 04 §3.7)
    if (e.button === 1 || (e.button === 0 && spaceHeldRef.current)) {
      gestureRef.current = {
        kind: 'pan',
        startClientX: e.clientX,
        startClientY: e.clientY,
        startPanX: st.ui.pan.x,
        startPanY: st.ui.pan.y,
      };
      capturePointer(e.pointerId);
      return;
    }
    if (e.button !== 0) return;

    const kind = activeMaskKind();
    if (!kind || !isEditable(kind)) {
      setHint(ru.grid.maskNotLoaded);
      return;
    }
    const geo = currentGeometry();
    if (!geo) return;
    const pos = localPos(e);
    const cell = hitTest(pos.x, pos.y, st.ui.pan, geo.size, geo.gridW, geo.gridH);
    if (!cell) return; // клик вне сетки ничего не делает (ТЗ 04 §3.7)

    const { tool } = st.ui;
    if (tool === 'rect') {
      gestureRef.current = { kind: 'rect', mask: kind, x0: cell.x, y0: cell.y, x1: cell.x, y1: cell.y };
      rectSelRef.current = { x0: cell.x, y0: cell.y, x1: cell.x, y1: cell.y };
      requestDraw();
      capturePointer(e.pointerId);
      return;
    }

    // Линия (ST-2): как прямоугольник — начало фиксируется, предпросмотр по drag,
    // применение по pointerup в endGesture.
    if (tool === 'line') {
      gestureRef.current = { kind: 'line', mask: kind, x0: cell.x, y0: cell.y, x1: cell.x, y1: cell.y };
      lineSelRef.current = { x0: cell.x, y0: cell.y, x1: cell.x, y1: cell.y };
      requestDraw();
      capturePointer(e.pointerId);
      return;
    }

    // Заливка (ST-2): одиночный клик — flood-fill области одним батчем.
    if (tool === 'fill') {
      applyFill(kind, cell.x, cell.y);
      return;
    }

    const hint = crossMaskHint(kind, cell.x, cell.y);
    if (hint) {
      setHint(hint);
      return;
    }

    let value: CellValue;
    if (kind === 'blocked') {
      // Кисть — toggle (§3.2): одиночный клик ставит/снимает «*». Для drag-рисования
      // значение зафиксировано по первой клетке stroke'а (toggle только без движения).
      const cur = st.blockedMask ? st.blockedMask.cells[cell.y][cell.x] : 'free';
      if (tool === 'eraser') {
        if (cur === 'free') return; // ластик по свободной клетке — noop, не помечаем dirty
        value = 'free';
      } else {
        value = cur === 'blocked' ? 'free' : 'blocked';
      }
    } else {
      const symbol = st.ui.paletteSymbol;
      if (tool === 'brush') {
        if (!symbol) {
          setHint(ru.grid.paletteHint);
          return;
        }
        value = { kind: 'preset', symbol };
      } else {
        const cur = st.presetMask ? st.presetMask.cells[cell.y][cell.x] : null;
        if (!cur || cur.kind === 'free') return; // ластик по свободной клетке — noop
        value = { kind: 'free' };
      }
    }

    const g: StrokeGesture = {
      kind: 'stroke',
      mask: kind,
      value,
      visited: new Set(),
      pending: [],
      flushScheduled: false,
    };
    gestureRef.current = g;
    g.visited.add(`${cell.x},${cell.y}`);
    g.pending.push([cell.x, cell.y]);
    scheduleStrokeFlush();
    capturePointer(e.pointerId);
  }

  function onPointerMove(e: ReactPointerEvent<HTMLCanvasElement>): void {
    const st = stateRef.current;
    if (!st.spec) return;
    const pos = localPos(e);
    const geo = currentGeometry();
    const cell = geo ? hitTest(pos.x, pos.y, st.ui.pan, geo.size, geo.gridW, geo.gridH) : null;
    setCursor((prev) => (prev?.x === cell?.x && prev?.y === cell?.y ? prev : cell));

    const g = gestureRef.current;
    if (!g) return;
    if (g.kind === 'pan') {
      dispatch({
        type: 'UI_SET_PAN',
        pan: { x: g.startPanX + (e.clientX - g.startClientX), y: g.startPanY + (e.clientY - g.startClientY) },
      });
      return;
    }
    if (g.kind === 'rect') {
      if (cell) {
        g.x1 = cell.x;
        g.y1 = cell.y;
        rectSelRef.current = { x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1 };
        requestDraw();
      }
      return;
    }
    if (g.kind === 'line') {
      if (cell) {
        g.x1 = cell.x;
        g.y1 = cell.y;
        lineSelRef.current = { x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1 };
        requestDraw();
      }
      return;
    }
    // stroke: каждая новая клетка за stroke — один раз (мультименжество, ТЗ 04 §3.7)
    if (!cell) return;
    const key = `${cell.x},${cell.y}`;
    if (g.visited.has(key)) return;
    g.visited.add(key);
    if (crossMaskHint(g.mask, cell.x, cell.y)) return; // занятая клетка пропускается
    g.pending.push([cell.x, cell.y]);
    scheduleStrokeFlush();
  }

  function endGesture(e: ReactPointerEvent<HTMLCanvasElement>): void {
    const g = gestureRef.current;
    if (!g) return;
    gestureRef.current = null;
    releasePointer(canvasRef.current, e.pointerId);
    // Stroke: незафлешенные клетки применяем СИНХРОННО — быстрый клик (pointerup
    // до следующего rAF-кадра) не должен терять одиночное действие кисти/ластика.
    if (g.kind === 'stroke' && g.pending.length > 0) {
      dispatch({ type: 'STROKE_APPLY', kind: g.mask, cells: g.pending, value: g.value });
    } else if (g.kind === 'rect') {
      const st = stateRef.current;
      if (st.spec && isEditable(g.mask)) {
        let value: CellValue | null = null;
        if (g.mask === 'blocked') {
          value = 'blocked';
        } else if (st.ui.paletteSymbol) {
          value = { kind: 'preset', symbol: st.ui.paletteSymbol };
        }
        if (value) {
          dispatch({ type: 'RECT_FILL', kind: g.mask, x1: g.x0, y1: g.y0, x2: g.x1, y2: g.y1, value });
        } else {
          setHint(ru.grid.paletteHint);
        }
      }
      rectSelRef.current = null;
      requestDraw();
    } else if (g.kind === 'line') {
      // Линия (ST-2): Брезенхэм от старта к концу включительно, семантика значения —
      // как у RECT_FILL (blocked → 'blocked'; preset → symbol из палитры). Применяется
      // одним STROKE_APPLY; занятые другой маской клетки не пропускаются — ровно как
      // в RECT_FILL (store применяет список клеток целиком).
      const st = stateRef.current;
      if (st.spec && isEditable(g.mask)) {
        let value: CellValue | null = null;
        if (g.mask === 'blocked') {
          value = 'blocked';
        } else if (st.ui.paletteSymbol) {
          value = { kind: 'preset', symbol: st.ui.paletteSymbol };
        }
        if (value) {
          dispatch({ type: 'STROKE_APPLY', kind: g.mask, cells: bresenham(g.x0, g.y0, g.x1, g.y1), value });
        } else {
          setHint(ru.grid.paletteHint);
        }
      }
      lineSelRef.current = null;
      requestDraw();
    }
  }

  function onPointerUp(e: ReactPointerEvent<HTMLCanvasElement>): void {
    endGesture(e);
  }

  function onPointerCancel(e: ReactPointerEvent<HTMLCanvasElement>): void {
    gestureRef.current = null; // незавершённый stroke не применяется
    rectSelRef.current = null;
    lineSelRef.current = null;
    releasePointer(canvasRef.current, e.pointerId);
    requestDraw();
  }

  function onPointerLeave(): void {
    setCursor(null);
  }

  // ── Зум колесом (нативный non-passive listener, чтобы preventDefault сработал) ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const st = stateRef.current;
      if (!st.spec) return;
      const rect = canvas.getBoundingClientRect();
      const cursorPos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const factor = e.deltaY < 0 ? 1.25 : 1 / 1.25;
      const nextZoom = clampZoom(st.ui.zoom * factor);
      if (nextZoom === st.ui.zoom) return;
      dispatch({ type: 'UI_SET_PAN', pan: zoomAtCursor(cursorPos, st.ui.pan, st.ui.zoom, nextZoom) });
      dispatch({ type: 'UI_SET_ZOOM', zoom: nextZoom });
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [dispatch]);

  // ── Горячие клавиши (ТЗ 04 §3.7; не в текстовых полях) ────────────────────
  useEffect(() => {
    const inField = (t: EventTarget | null): boolean =>
      t instanceof HTMLElement &&
      (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

    const onKeyDown = (e: KeyboardEvent): void => {
      if (inField(e.target)) return;
      const st = stateRef.current;
      if (e.code === 'Space') {
        spaceHeldRef.current = true;
        if (st.spec) e.preventDefault(); // не даём странице скроллиться
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        setHint(ru.grid.undoSoon);
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const viewCenter = { x: viewRef.current.w / 2, y: viewRef.current.h / 2 };
      switch (e.key) {
        case '1':
          dispatch({ type: 'UI_SET_TOOL', tool: 'brush' });
          break;
        case '2':
          dispatch({ type: 'UI_SET_TOOL', tool: 'rect' });
          break;
        case '3':
          dispatch({ type: 'UI_SET_TOOL', tool: 'eraser' });
          break;
        case '4':
          dispatch({ type: 'UI_SET_TOOL', tool: 'fill' });
          break;
        case '5':
          dispatch({ type: 'UI_SET_TOOL', tool: 'line' });
          break;
        case 'b':
        case 'B':
          if (st.blockedMask) dispatch({ type: 'UI_SET_MASK_MODE', mode: 'blocked' });
          break;
        case 'p':
        case 'P':
          if (st.presetMask) dispatch({ type: 'UI_SET_MASK_MODE', mode: 'preset' });
          break;
        case '0':
          dispatch({ type: 'UI_SET_ZOOM', zoom: 1 }); // fit-to-screen
          break;
        case '+':
        case '=': {
          if (!st.spec) return;
          const nz = clampZoom(st.ui.zoom * 1.25);
          dispatch({ type: 'UI_SET_PAN', pan: zoomAtCursor(viewCenter, st.ui.pan, st.ui.zoom, nz) });
          dispatch({ type: 'UI_SET_ZOOM', zoom: nz });
          break;
        }
        case '-': {
          if (!st.spec) return;
          const nz = clampZoom(st.ui.zoom / 1.25);
          dispatch({ type: 'UI_SET_PAN', pan: zoomAtCursor(viewCenter, st.ui.pan, st.ui.zoom, nz) });
          dispatch({ type: 'UI_SET_ZOOM', zoom: nz });
          break;
        }
        default:
          break;
      }
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.code === 'Space') spaceHeldRef.current = false;
    };
    const onBlur = (): void => {
      // окно потеряло фокус — keyup может не прийти; сбрасываем «Space зажат»
      spaceHeldRef.current = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [dispatch, setHint]);

  // ── Клик по миникарте — перемещение центра viewport (ТЗ 04 §3.4) ──────────
  function onMinimapClick(e: React.MouseEvent<HTMLCanvasElement>): void {
    const st = stateRef.current;
    const geo = currentGeometry();
    if (!st.spec || !geo) return;
    const gridW = st.spec.grid.width;
    const gridH = st.spec.grid.height;
    const scale = Math.min(MINIMAP_MAX_PX / gridW, MINIMAP_MAX_PX / gridH);
    const targetX = e.nativeEvent.offsetX / scale;
    const targetY = e.nativeEvent.offsetY / scale;
    dispatch({
      type: 'UI_SET_PAN',
      pan: {
        x: viewRef.current.w / 2 - (targetX + 0.5) * geo.size,
        y: viewRef.current.h / 2 - (targetY + 0.5) * geo.size,
      },
    });
  }

  // ── Панель инструментов и палитра ──────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (hintTimerRef.current !== null) window.clearTimeout(hintTimerRef.current);
    };
  }, []);

  function clearActiveMask(): void {
    const kind = activeMaskKind();
    if (!kind || !isEditable(kind)) return;
    if (window.confirm(ru.grid.clearConfirm)) {
      dispatch({ type: 'MASK_CLEAR_ALL', kind });
    }
  }

  const styleBtn = (active: boolean, disabled = false): CSSProperties => ({
    padding: '3px 10px',
    margin: '0 2px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.45 : 1,
    border: `1px solid ${active ? '#1565c0' : '#bbb'}`,
    borderRadius: '4px',
    background: active ? '#e3f2fd' : '#fff',
    fontWeight: active ? 700 : 400,
  });

  const specDoc = state.spec;
  const palette = buildTypePalette(Object.entries(specDoc?.types ?? {}));
  const displayKind = specDoc ? activeMaskKind() : null; // для UI-подсветки/инструментов
  const editable = displayKind !== null && isEditable(displayKind);

  const blockedLoaded = !!state.blockedMask;
  const presetLoaded = !!state.presetMask;
  const mismatchText = (kind: MaskKind | null): string | null => {
    if (!specDoc || !kind) return null;
    const m = kind === 'blocked' ? state.blockedMask : state.presetMask;
    if (!m) return null;
    if (m.width === specDoc.grid.width && m.height === specDoc.grid.height) return null;
    return ru.grid.dimMismatch
      .replace('{fw}', String(m.width))
      .replace('{fh}', String(m.height))
      .replace('{gw}', String(specDoc.grid.width))
      .replace('{gh}', String(specDoc.grid.height));
  };

  const zoomLabel = state.ui.zoom < 10 ? state.ui.zoom.toFixed(2) : String(Math.round(state.ui.zoom));
  const statusText = specDoc
    ? `${cursor ? `x=${cursor.x} y=${cursor.y}` : ru.grid.cursor} · zoom ${zoomLabel}× · клеток всего ${specDoc.grid.width}×${specDoc.grid.height}`
    : '';

  return (
    <section className="panel" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px', padding: '4px' }}>
        {/* Режимы (ТЗ 04 §3.1) */}
        <button
          type="button"
          style={styleBtn(state.ui.maskMode === 'blocked' && displayKind === 'blocked', !blockedLoaded)}
          title={blockedLoaded ? undefined : ru.grid.maskNotLoaded}
          disabled={!blockedLoaded}
          onClick={() => dispatch({ type: 'UI_SET_MASK_MODE', mode: 'blocked' })}
        >
          {ru.grid.modeBlocked} (B)
        </button>
        <button
          type="button"
          style={styleBtn(state.ui.maskMode === 'preset' && displayKind === 'preset', !presetLoaded)}
          title={presetLoaded ? undefined : ru.grid.maskNotLoaded}
          disabled={!presetLoaded}
          onClick={() => dispatch({ type: 'UI_SET_MASK_MODE', mode: 'preset' })}
        >
          {ru.grid.modePreset} (P)
        </button>

        <span style={{ width: 1 }} />

        {/* Инструменты (ТЗ 04 §3.2) */}
        {(
          [
            ['brush', ru.grid.toolBrush],
            ['rect', ru.grid.toolRect],
            ['eraser', ru.grid.toolEraser],
            ['fill', ru.grid.toolFill],
            ['line', ru.grid.toolLine],
          ] as const
        ).map(([tool, label]) => (
          <button
            key={tool}
            type="button"
            style={styleBtn(state.ui.tool === tool)}
            disabled={!editable}
            title={editable ? undefined : ru.grid.maskNotLoaded}
            onClick={() => dispatch({ type: 'UI_SET_TOOL', tool })}
          >
            {label}
          </button>
        ))}

        <button type="button" style={styleBtn(false, !editable)} disabled={!editable} onClick={clearActiveMask}>
          {ru.buttons.clearAll}
        </button>

        {/* Палитра preset (ТЗ 04 §3.3): чипы из spec.types, цвет — по порядку добавления */}
        {specDoc && displayKind === 'preset' && (
          <span style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: '2px' }}>
            {Object.entries(specDoc.types).map(([id, def]) => {
              const active = state.ui.paletteSymbol === def.symbol;
              return (
                <button
                  key={id}
                  type="button"
                  title={`${def.symbol} · ${id}${def.name ? ` · ${def.name}` : ''}`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '2px 8px',
                    border: `2px solid ${active ? '#1565c0' : palette.byType.get(id) ?? '#999'}`,
                    borderRadius: '4px',
                    background: '#fff',
                    cursor: 'pointer',
                  }}
                  onClick={() => dispatch({ type: 'UI_SET_PALETTE_SYMBOL', symbol: def.symbol })}
                >
                  <span
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: '2px',
                      background: palette.byType.get(id) ?? '#999',
                      display: 'inline-block',
                    }}
                  />
                  {def.symbol}
                  <span style={{ color: '#666' }}>{id}</span>
                </button>
              );
            })}
          </span>
        )}
      </div>

      {/* Viewport (ТЗ 04 §3.4) */}
      <div
        ref={wrapRef}
        style={{ position: 'relative', flex: 1, minHeight: 200, border: '1px solid #ccc', background: '#fff' }}
      >
        <canvas
          ref={canvasRef}
          style={{ display: 'block', cursor: 'crosshair', touchAction: 'none' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onPointerLeave={onPointerLeave}
          onContextMenu={(e) => e.preventDefault()} // правая кнопка — без контекстного меню (ТЗ 04 §3.7)
        />
        <canvas
          ref={miniRef}
          onClick={onMinimapClick}
          style={{
            position: 'absolute',
            right: 8,
            bottom: 8,
            border: '1px solid #888',
            background: '#fff',
            cursor: 'pointer',
            display: specDoc ? 'block' : 'none',
          }}
        />
        {!specDoc && (
          <div style={overlayStyle}>{ru.grid.noSpec}</div>
        )}
        {specDoc && !displayKind && <div style={overlayStyle}>{ru.grid.noMasks}</div>}
        {specDoc && displayKind && mismatchText(displayKind) && (
          <div style={{ ...overlayStyle, background: '#fff3cd', border: '1px solid #f0ad4e' }}>
            {mismatchText(displayKind)} — редактирование заблокировано до исправления (смена размера сетки или
            перезагрузка маски).
          </div>
        )}
      </div>

      {/* Строка статуса (ТЗ 04 §3.4) */}
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 6px', color: '#555', fontSize: 12 }}>
        <span>{statusText}</span>
        {hint && <span style={{ color: '#c62828' }}>{hint}</span>}
      </div>
    </section>
  );
}

const overlayStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#888',
  background: 'rgba(255, 255, 255, 0.7)',
  padding: '16px',
  textAlign: 'center',
};
