// Парсинг отчёта result-*.txt для LLM-модуля (ТЗ docs-llm/03 §5).
// Чистые функции без IO: секция «== КАРТА ==», таблица «запрошено / фактически /
// отклонение», связные области карты по 8-окрестности.
export interface TableRow {
  id: string;
  type: string;
  /** Доля (%) — строкой, как в отчёте («—» у preset-кластеров). */
  share: string;
  target: number;
  actual: number;
  /** Текст отклонения, напр. «+1 (+3%)», «-4 (-14%)», «0». */
  deviation: string;
  /** ок / недостача / превышение. */
  status: string;
}

export interface MapRegion {
  symbol: string;
  cells: number;
  bbox: [number, number, number, number]; // [x0, y0, x1, y1]
}

const MAP_HEADER = '== КАРТА ==';
const TABLE_HEADER_PREFIX = '== ТАБЛИЦА';

function isSectionHeader(line: string): boolean {
  return line.startsWith('==');
}

/**
 * Строки секции «== КАРТА ==» (после заголовка, до пустой строки/следующей
 * секции). null — секции нет или пуста.
 */
export function extractMapLines(report: string): string[] | null {
  const lines = report.split('\n');
  const idx = lines.findIndex((l) => l.trim() === MAP_HEADER);
  if (idx === -1) return null;
  // После заголовка может идти пустая строка (секции отчёта склеены "\n\n").
  let i = idx + 1;
  while (i < lines.length && lines[i] === '') i++;
  const out: string[] = [];
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line === '' || isSectionHeader(line)) break;
    out.push(line);
  }
  return out.length > 0 ? out : null;
}

/**
 * Строки таблицы «запрошено / фактически / отклонение» (без заголовка и
 * разделителя). Пустой массив — секции нет.
 */
export function parseTableRows(report: string): TableRow[] {
  const lines = report.split('\n');
  const idx = lines.findIndex((l) => l.trim().startsWith(TABLE_HEADER_PREFIX));
  if (idx === -1) return [];
  // Пропускаем до первой непустой строки — заголовок таблицы.
  let i = idx + 1;
  while (i < lines.length && lines[i] === '') i++;
  if (i >= lines.length || isSectionHeader(lines[i])) return [];
  i++; // заголовок
  while (i < lines.length && lines[i] === '') i++;
  if (i >= lines.length || !lines[i].includes('-')) return [];
  i++; // разделитель «--- | ---»

  const rows: TableRow[] = [];
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line === '' || isSectionHeader(line)) break;
    const cells = line.split(' | ').map((c) => c.trim());
    if (cells.length < 7) continue; // строка не по формату — пропускаем
    const target = Number.parseInt(cells[3], 10);
    const actual = Number.parseInt(cells[4], 10);
    if (!Number.isFinite(target) || !Number.isFinite(actual)) continue;
    rows.push({
      id: cells[0],
      type: cells[1],
      share: cells[2],
      target,
      actual,
      deviation: cells[5],
      status: cells[6],
    });
  }
  return rows;
}

/**
 * Связные области карты по символам (8-окрестность; символы «.» и «*» не
 * учитываются). Ограничение то же, что у валидатора (04 §6): два кластера
 * одного типа, соприкасающиеся на маске, дают ОДНУ область.
 */
export function connectedRegions(map: string[][]): MapRegion[] {
  const height = map.length;
  const width = height > 0 ? map[0].length : 0;
  const seen = new Set<string>();
  const regions: MapRegion[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const symbol = map[y][x];
      if (symbol === '.' || symbol === '*' || seen.has(`${x},${y}`)) continue;
      // BFS по 8-окрестности.
      let cells = 0;
      let x0 = x, y0 = y, x1 = x, y1 = y;
      const queue: Array<[number, number]> = [[x, y]];
      seen.add(`${x},${y}`);
      while (queue.length > 0) {
        const [cx, cy] = queue.pop() as [number, number];
        cells++;
        if (cx < x0) x0 = cx;
        if (cy < y0) y0 = cy;
        if (cx > x1) x1 = cx;
        if (cy > y1) y1 = cy;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const key = `${nx},${ny}`;
            if (seen.has(key) || map[ny][nx] !== symbol) continue;
            seen.add(key);
            queue.push([nx, ny]);
          }
        }
      }
      regions.push({ symbol, cells, bbox: [x0, y0, x1, y1] });
    }
  }
  regions.sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0] || a.symbol.localeCompare(b.symbol));
  return regions;
}

/** Компактная сводка по кластерам для LLM (JSON-объект, 03 §5 п.2). */
export function buildClusterSummary(rows: TableRow[]): Record<string, unknown> {
  return {
    clusters: rows.map((r) => ({
      id: r.id,
      type: r.type,
      target: r.target,
      actual: r.actual,
      deviation: r.deviation,
      status: r.status,
    })),
  };
}

/** Геометрия с привязкой типа по символам реестра (03 §5 п.3). */
export function buildGeometrySummary(
  mapLines: string[],
  types: Record<string, { symbol: string; name: string | null }>,
): Record<string, unknown> {
  const symbolToType = new Map<string, string>();
  for (const [typeId, t] of Object.entries(types)) symbolToType.set(t.symbol, typeId);
  return {
    regions: connectedRegions(mapLines.map((line) => [...line])).map((r) => ({
      type: symbolToType.get(r.symbol) ?? null,
      symbol: r.symbol,
      cells: r.cells,
      bbox: r.bbox,
    })),
  };
}
