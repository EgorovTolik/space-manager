// Инлайн-фикстуры e2e (спекации 10×10 под размер эталонных масок examples/).
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Спекация 10×10 с типами A/B — совпадает с символами examples/preset_example.txt. */
export const SPEC_10X10 = `grid:
  width: 10
  height: 10

blockedFile: null
presetFile: null

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

/** Спекация 10×10 с суммой долей 110% — V-CLUST-SUM (ТЗ 05 §2.1). */
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

/** Спекация 10×10 только с типом A — preset_example.txt (символ B) станет «чужим». */
export const SPEC_TYPE_A_ONLY = `grid:
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
    areaPercent: 50
    shape: free
`;

/** Тmp-каталог фикстур + запись YAML-спекаций; возвращает пути. */
export function makeFixturesDir(): { dir: string; spec10: string; sum110: string; typeAOnly: string } {
  const dir = mkdtempSync(join(tmpdir(), 'spaec-e2e-fix-'));
  const spec10 = join(dir, 'spec_10x10.yaml');
  const sum110 = join(dir, 'spec_sum110.yaml');
  const typeAOnly = join(dir, 'spec_typea_only.yaml');
  writeFileSync(spec10, SPEC_10X10);
  writeFileSync(sum110, SPEC_SUM_110);
  writeFileSync(typeAOnly, SPEC_TYPE_A_ONLY);
  return { dir, spec10, sum110, typeAOnly };
}

// examples/ корневого проекта: editor/tests/e2e → ../../../examples
const projectExamples = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', 'examples');
export const EXAMPLES = {
  specBasic: join(projectExamples, 'spec_basic.yaml'),
  blockedBasic: join(projectExamples, 'blocked_basic.txt'),
  presetExample: join(projectExamples, 'preset_example.txt'),
};
