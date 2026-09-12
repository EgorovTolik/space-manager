// Палитра цветов символов (ТЗ 02 §8). Чистый модуль: без React/DOM/three.

import type { CellChar } from './reportParser';

/** Фиксированная палитра из 16 различимых цветов (ТЗ 02 §8). */
export const PALETTE: string[] = [
  '#4e79a7', // синий
  '#f28e2b', // оранжевый
  '#59a14f', // зелёный
  '#e15759', // красный
  '#76b7b2', // бирюзовый
  '#edc948', // жёлтый
  '#af7aa1', // пурпурный
  '#ff9da7', // розовый
  '#9c755f', // коричневый
  '#bab0ab', // серый-бежевый
  '#1f77b4', // тёмно-синий
  '#d62728', // тёмно-красный
  '#2ca02c', // тёмно-зелёный
  '#9467bd', // фиолетовый
  '#8c564b', // шоколадный
  '#e377c2', // малиновый
];

/** Цвет псевдотипа «неизвестный» ('?') — вне палитры (ТЗ 02 §8). */
export const UNKNOWN_SYMBOL_COLOR = '#808080';

/** Служебные символы карты, не получающие цвета типов. */
const NON_TYPE_CHARS: ReadonlySet<string> = new Set(['.', '*']);

/**
 * Назначение цветов символам карты: по порядку первого появления в растровом
 * обходе (сначала строки y, внутри — x) — детерминировано (ТЗ 02 §8).
 * '.' и '*' пропускаются; '?' → UNKNOWN_SYMBOL_COLOR (индекс палитры не тратится);
 * при > 15 типах цвета зацикливаются.
 */
export function symbolPalette(map: CellChar[][]): Map<string, string> {
  const result = new Map<string, string>();
  let next = 0;
  for (let y = 0; y < map.length; y += 1) {
    const row = map[y];
    for (let x = 0; x < row.length; x += 1) {
      const symbol: CellChar = row[x];
      if (NON_TYPE_CHARS.has(symbol) || result.has(symbol)) continue;
      if (symbol === '?') {
        result.set(symbol, UNKNOWN_SYMBOL_COLOR);
      } else {
        result.set(symbol, PALETTE[next % PALETTE.length]);
        next += 1;
      }
    }
  }
  return result;
}
