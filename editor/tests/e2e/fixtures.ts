// Инлайн-фикстуры e2e в проектном режиме (docs-unified/04-integrations.md §4):
// спекации — инлайн-тексты (детерминированы, не зависят от правок examples/);
// содержимое масок берётся из эталонных examples/*.txt; ответы солвера — фикстуры.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// examples/ корневого проекта: editor/tests/e2e → ../../../examples
const projectExamples = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', 'examples');
export const EXAMPLES = {
  blockedBasic: join(projectExamples, 'blocked_basic.txt'),
  presetExample: join(projectExamples, 'preset_example.txt'),
};

// ── Спекации (инлайн) ───────────────────────────────────────────────────────────

/** 50×50 с маской блокировок (каноническое имя blocked.txt) — кластеры room1/room2/corridor1, сумма 51 %. */
export const SPEC_50X50 = `grid:
  width: 50
  height: 50

blockedFile: blocked.txt
presetFile: null

types:
  ROOM1: { symbol: "R", name: Комната 1 }
  ROOM2: { symbol: "K", name: Комната 2 }
  CORRIDOR: { symbol: "C", name: Коридор }

rules:
  connectivity: 8
  adjacency:
    forbidden: []
    allow: null
  size:
    min: null
    max: null
  convexity:
    weight: soft
  fillAll: false
  touchAll: false

clusters:
  - id: room1
    type: ROOM1
    areaPercent: 30
    shape: free
  - id: room2
    type: ROOM2
    areaPercent: 15
    shape: free
  - id: corridor1
    type: CORRIDOR
    areaPercent: 6
    shape: free
`;

/** 10×10 с типами A/B и ДВУМЯ масками канонических имён — совпадает с символами examples/*.txt. */
export const SPEC_10X10_MASKED = `grid:
  width: 10
  height: 10

blockedFile: blocked.txt
presetFile: preset.txt

types:
  A: { symbol: "A", name: null }
  B: { symbol: "B", name: null }

rules:
  connectivity: 8
  adjacency:
    forbidden: []
    allow: null
  size:
    min: null
    max: null
  convexity:
    weight: soft
  fillAll: false
  touchAll: false

clusters:
  - id: a1
    type: A
    areaPercent: 40
    shape: free
  - id: b1
    type: B
    areaPercent: 30
    shape: free
`;

/** 10×10, сумма долей 110 % — V-CLUST-SUM (ТЗ 05 §2.1). Масок нет. */
export const SPEC_SUM_110 = `grid:
  width: 10
  height: 10

blockedFile: null
presetFile: null

types:
  A: { symbol: "A", name: null }

rules:
  connectivity: 8
  adjacency:
    forbidden: []
    allow: null
  size:
    min: null
    max: null
  convexity:
    weight: soft
  fillAll: false
  touchAll: false

clusters:
  - id: c1
    type: A
    areaPercent: 70
    shape: free
  - id: c2
    type: A
    areaPercent: 40
    shape: free
`;

/** 10×10 только с типом A и preset.txt (в examples/preset_example.txt есть B) — V-MASK-PRESET. */
export const SPEC_TYPE_A_ONLY = `grid:
  width: 10
  height: 10

blockedFile: null
presetFile: preset.txt

types:
  A: { symbol: "A", name: null }

rules:
  connectivity: 8
  adjacency:
    forbidden: []
    allow: null
  size:
    min: null
    max: null
  convexity:
    weight: soft
  fillAll: false
  touchAll: false

clusters:
  - id: c1
    type: A
    areaPercent: 50
    shape: free
`;

// ── Ответы солвера (docs-unified/02 §6.10, отчёты — ТЗ 03 §9) ───────────────────

export const RESULT_FILE = 'result-20260913-120000.txt';

export const REPORT_OK = [
  '== КАРТА ==',
  '',
  'AAAAAAAA..',
  'AAAAAAAA..',
  '.BBBBBBB..',
  '.BBBBBBB..',
  '.BBBBBBB..',
  '..........',
  '..........',
  '..........',
  '',
  '== ТАБЛИЦА: запрошено / фактически / отклонение ==',
  '',
  'id | type | доля (%) | цель (клеток) | факт (клеток) | отклонение | статус',
  'a1 | A    | 40       | 40            | 40            | 0          | ок',
  'b1 | B    | 30       | 30            | 30            | 0          | ок',
  '',
  '== ПРЕДУПРЕЖДЕНИЯ ==',
  '',
  'нет',
].join('\n');

/** exit 1: infeasible — причина в блоке ДО маркера «== КАРТА ==» (docs-unified/04 §1.6). */
export const REPORT_INFEASIBLE = [
  'НЕ УДАЛОСЬ РАЗМЕСТИТЬ ВСЕ КЛАСТЕРЫ.',
  'Причина: не хватает места для кластера c2 (цель 40, максимум 35): блокировки съедают слишком много площади.',
  'Рассмотрите: уменьшите долю кластеров или увеличьте сетку.',
  '',
  '== КАРТА ==',
  '',
  '..........',
  '',
  '== ПРЕДУПРЕЖДЕНИЯ ==',
  '',
  'нет',
].join('\n');
