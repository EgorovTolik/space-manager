// Палитра preset-редактора (ТЗ 04 §3.3): фиксированные 20 различимых цветов,
// назначаемые типам ПО ПОРЯДКУ ДОБАВЛЕНИЯ; коллизии исключаются — каждый тип
// получает первый ещё не занятый цвет. Чистая функция без React/DOM.

export const TYPE_COLORS: readonly string[] = [
  '#e6194b', // 1  crimson
  '#3cb44b', // 2  green
  '#4363d8', // 3  blue
  '#f58231', // 4  orange
  '#911eb4', // 5  purple
  '#0e7c7b', // 6  teal
  '#0072b2', // 7  azure
  '#d55e00', // 8  vermillion
  '#cc79a7', // 9  pink
  '#56b4e9', // 10 sky
  '#f0e442', // 11 yellow (тёмный текст)
  '#9a6324', // 12 brown
  '#800000', // 13 maroon
  '#000075', // 14 navy
  '#3b3b3b', // 15 dark gray
  '#7d3c98', // 16 violet
  '#1e8449', // 17 forest
  '#ba4a00', // 18 rust
  '#2e4053', // 19 slate
  '#af392f', // 20 brick
];

/** Цвет текста символа на фоне палитры (светлые фоны → тёмный текст). */
export function textColorFor(bg: string): string {
  return bg === '#f0e442' ? '#1a1a1a' : '#ffffff';
}

/**
 * Настройка цветов для реестра типов. Порядок id = порядок добавления
 * (в JS-объекте — порядок вставки). Возвращает:
 *   byType  — цвет по id типа;
 *   bySymbol — цвет по символу (клетки preset хранят символ, вводная №7);
 *   symbolToType — id типа по символу (для подсказок §3.6 ТЗ).
 */
export function buildTypePalette(
  typeEntries: [string, { symbol: string }][],
): {
  byType: ReadonlyMap<string, string>;
  bySymbol: ReadonlyMap<string, string>;
  symbolToType: ReadonlyMap<string, string>;
} {
  const byType = new Map<string, string>();
  const used = new Set<string>();
  for (let i = 0; i < typeEntries.length; i++) {
    const [id] = typeEntries[i];
    // первый свободный цвет; при >20 типах — циклический возврат к палитре
    let color = TYPE_COLORS[i % TYPE_COLORS.length];
    while (used.has(color)) {
      color = TYPE_COLORS[(TYPE_COLORS.indexOf(color) + 1) % TYPE_COLORS.length];
    }
    used.add(color);
    byType.set(id, color);
  }
  const bySymbol = new Map<string, string>();
  const symbolToType = new Map<string, string>();
  for (const [id, def] of typeEntries) {
    bySymbol.set(def.symbol, byType.get(id) ?? TYPE_COLORS[0]);
    symbolToType.set(def.symbol, id);
  }
  return { byType, bySymbol, symbolToType };
}
