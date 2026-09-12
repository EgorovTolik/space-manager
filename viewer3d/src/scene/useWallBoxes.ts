// Пересчёт боксов стен с debounce (ТЗ 04 §3: пересчёт при смене S/T — 200 мс;
// Hw и оптические параметры XZ-геометрию не требуют).

import { useEffect, useMemo, useState } from 'react';
import type { ParsedReport } from '../lib/reportParser';
import { buildWallBoxes, type WallBox } from '../lib/walls';

/** Задержка пересчёта геометрии стен, мс (ТЗ 04 §3). */
export const WALLS_RECOMPUTE_DEBOUNCE_MS = 200;

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/**
 * Боксы стен для загруженного отчёта. `scale`/`thickness` — с debounce 200 мс;
 * report = null → пустой массив (сцена не строится).
 */
export function useWallBoxes(
  report: ParsedReport | null,
  scale: number,
  thickness: number,
): WallBox[] {
  const debouncedScale = useDebouncedValue(scale, WALLS_RECOMPUTE_DEBOUNCE_MS);
  const debouncedThickness = useDebouncedValue(thickness, WALLS_RECOMPUTE_DEBOUNCE_MS);
  return useMemo(() => {
    if (report === null) return [];
    return buildWallBoxes(report.map, { scale: debouncedScale, wallThickness: debouncedThickness });
  }, [report, debouncedScale, debouncedThickness]);
}
