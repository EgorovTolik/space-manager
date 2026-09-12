// lib/specYaml.ts — parse/dump YAML-спекации (ТЗ 02 §4, форматы docs/03).
//
// parseSpec: js-yaml + приведение к модели SpecDoc с проверками типов;
//   дефолты — по docs/03 (name: null, allow: null, size.min/max: null,
//   convexity.weight: soft, fillAll: false, touchAll: false, shape: free).
//   Неизвестные поля отбрасываются и перечисляются в unknownFields
//   (ТЗ 02 §4 п.5 — одноразовое предупреждение UI).
//
// dumpSpec: сериализация из структурной модели. Индент 2, порядок ключей по
//   docs/03 §1, канонический пример-эталон ТЗ 02 §4 воспроизводится побайтово:
//   символ типа всегда в двойных кавычках, null/[] — явно, blockedFile/presetFile
//   — basename без './' (ТЗ 02 §4 «нюансы»). Комментарии НЕ восстанавливаются
//   (ограничение v1).

import * as yaml from 'js-yaml';
import type { ClusterEntry, Rules, ShapeKind, SpecDoc, TypeDef } from './types';

/** Ошибка парсинга/структуры YAML-спеки. Сообщение — на русском. */
export class SpecParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpecParseError';
  }
}

const SHAPES: readonly ShapeKind[] = ['free', 'rectangle', 'circle'];

interface ParseResult {
  doc: SpecDoc;
  /** Пасы неизвестных полей, напр. 'rules.newFeature', 'clusters[1].extra'. */
  unknownFields: string[];
}

// ── Вспомогательные проверки ───────────────────────────────────────────────

function fail(where: string, message: string): never {
  throw new SpecParseError(`Поле «${where}»: ${message}`);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function checkInt(v: unknown, where: string, opts: { min?: number } = {}): number {
  if (typeof v !== 'number' || !Number.isInteger(v)) {
    fail(where, `ожидается целое число, получено: ${JSON.stringify(v)}`);
  }
  if (opts.min !== undefined && v < opts.min) {
    fail(where, `ожидается целое ≥ ${opts.min}, получено: ${v}`);
  }
  return v;
}

function checkString(v: unknown, where: string): string {
  if (typeof v !== 'string') {
    fail(where, `ожидается строка, получено: ${JSON.stringify(v)}`);
  }
  return v;
}

function checkBool(v: unknown, where: string): boolean {
  if (typeof v !== 'boolean') {
    fail(where, `ожидается true или false, получено: ${JSON.stringify(v)}`);
  }
  return v;
}

function noteUnknown(unknown: string[], key: string, prefix: string): void {
  unknown.push(prefix ? `${prefix}.${key}` : String(key));
}

// ── Парсинг блоков ─────────────────────────────────────────────────────────

const KNOWN_TOP = new Set(['grid', 'blockedFile', 'presetFile', 'types', 'rules', 'clusters']);
const KNOWN_TYPE_DEF = new Set(['symbol', 'name']);
const KNOWN_RULES = new Set([
  'connectivity', 'adjacency', 'size', 'convexity', 'fillAll', 'touchAll',
]);
const KNOWN_ADJACENCY = new Set(['forbidden', 'allow']);
const KNOWN_SIZE = new Set(['min', 'max']);
const KNOWN_CONVEXITY = new Set(['weight']);
const KNOWN_CLUSTER = new Set(['id', 'type', 'areaPercent', 'shape']);

function parseFileRef(v: unknown, where: string): string | null {
  if (v === undefined || v === null) return null;
  return checkString(v, where);
}

function parseTypes(raw: unknown, unknown: string[]): Record<string, TypeDef> {
  if (raw === undefined || raw === null) return {};
  if (!isPlainObject(raw)) fail('types', 'ожидается блок «id: { symbol, name }»');
  const types: Record<string, TypeDef> = {};
  for (const [id, defRaw] of Object.entries(raw)) {
    if (typeof id !== 'string' || id.length === 0) {
      fail('types', 'ключ типа не может быть пустым');
    }
    if (!isPlainObject(defRaw)) {
      fail(`types.${id}`, 'ожидается объект со полями symbol/name');
    }
    const def: TypeDef = { symbol: '', name: null };
    for (const [key, value] of Object.entries(defRaw)) {
      if (key === 'symbol') {
        const s = checkString(value, `types.${id}.symbol`);
        if (s.length !== 1) {
          fail(`types.${id}.symbol`, 'ожидается ровно один символ, получено: ' + JSON.stringify(s));
        }
        def.symbol = s;
      } else if (key === 'name') {
        def.name = value === null ? null : checkString(value, `types.${id}.name`);
      } else {
        noteUnknown(unknown, key, `types.${id}`);
      }
    }
    types[id] = def;
  }
  return types;
}

function parseAdjacencyPairs(v: unknown, where: string): [string, string][] {
  if (!Array.isArray(v)) fail(where, 'ожидается список пар [типA, типB]');
  return v.map((pair, i) => {
    if (!Array.isArray(pair) || pair.length !== 2) {
      fail(`${where}[${i}]`, 'ожидается пара из двух id типов');
    }
    return [checkString(pair[0], `${where}[${i}][0]`), checkString(pair[1], `${where}[${i}][1]`)] as [string, string];
  });
}

function parseRules(raw: unknown, unknown: string[]): Rules {
  const rules: Rules = {
    connectivity: 8,
    adjacency: { forbidden: [], allow: null },
    size: { min: null, max: null },
    convexity: { weight: 'soft' },
    fillAll: false,
    touchAll: false,
  };
  if (raw === undefined || raw === null) return rules;
  if (!isPlainObject(raw)) fail('rules', 'ожидается блок правил');

  for (const [key, value] of Object.entries(raw)) {
    switch (key) {
      case 'connectivity': {
        const c = checkInt(value, 'rules.connectivity');
        if (c !== 4 && c !== 8) fail('rules.connectivity', `допустимо 4 или 8, получено: ${c}`);
        rules.connectivity = c;
        break;
      }
      case 'adjacency': {
        const adj = isPlainObject(value) ? value : fail('rules.adjacency', 'ожидается блок adjacency');
        for (const [k2, v2] of Object.entries(adj)) {
          if (k2 === 'forbidden') rules.adjacency.forbidden = parseAdjacencyPairs(v2, 'rules.adjacency.forbidden');
          else if (k2 === 'allow') rules.adjacency.allow = v2 === null ? null : parseAdjacencyPairs(v2, 'rules.adjacency.allow');
          else noteUnknown(unknown, k2, 'rules.adjacency');
        }
        break;
      }
      case 'size': {
        const size = isPlainObject(value) ? value : fail('rules.size', 'ожидается блок size');
        for (const [k2, v2] of Object.entries(size)) {
          if (k2 === 'min') rules.size.min = v2 === null ? null : checkInt(v2, 'rules.size.min', { min: 0 });
          else if (k2 === 'max') rules.size.max = v2 === null ? null : checkInt(v2, 'rules.size.max', { min: 0 });
          else noteUnknown(unknown, k2, 'rules.size');
        }
        break;
      }
      case 'convexity': {
        const conv = isPlainObject(value) ? value : fail('rules.convexity', 'ожидается блок convexity');
        for (const [k2, v2] of Object.entries(conv)) {
          if (k2 === 'weight') {
            const w = checkString(v2, 'rules.convexity.weight');
            if (w !== 'soft' && w !== 'hard') fail('rules.convexity.weight', `допустимо soft или hard, получено: ${w}`);
            rules.convexity.weight = w;
          } else {
            noteUnknown(unknown, k2, 'rules.convexity');
          }
        }
        break;
      }
      case 'fillAll':
        rules.fillAll = checkBool(value, 'rules.fillAll');
        break;
      case 'touchAll':
        rules.touchAll = checkBool(value, 'rules.touchAll');
        break;
      default:
        noteUnknown(unknown, key, 'rules');
    }
  }
  return rules;
}

function parseClusters(raw: unknown, unknown: string[]): ClusterEntry[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) fail('clusters', 'ожидается список кластеров');
  return raw.map((item, i) => {
    const where = `clusters[${i}]`;
    if (!isPlainObject(item)) fail(where, 'ожидается объект');
    const entry: ClusterEntry = { id: '', type: '', areaPercent: 0, shape: 'free' };
    let hasId = false;
    for (const [key, value] of Object.entries(item)) {
      switch (key) {
        case 'id':
          entry.id = checkString(value, `${where}.id`);
          if (entry.id.length === 0) fail(`${where}.id`, 'не может быть пустым');
          hasId = true;
          break;
        case 'type':
          entry.type = checkString(value, `${where}.type`);
          break;
        case 'areaPercent': {
          const p = checkIntOrFloat(value, `${where}.areaPercent`);
          if (!(p > 0 && p <= 100)) fail(`${where}.areaPercent`, `ожидается число в (0..100], получено: ${p}`);
          entry.areaPercent = p;
          break;
        }
        case 'shape': {
          const s = checkString(value, `${where}.shape`);
          if (!SHAPES.includes(s as ShapeKind)) fail(`${where}.shape`, `допустимо free / rectangle / circle, получено: ${s}`);
          entry.shape = s as ShapeKind;
          break;
        }
        default:
          noteUnknown(unknown, key, where);
      }
    }
    if (!hasId) fail(where, 'отсутствует обязательное поле id');
    return entry;
  });
}

function checkIntOrFloat(v: unknown, where: string): number {
  if (typeof v !== 'number' || Number.isNaN(v)) {
    fail(where, `ожидается число, получено: ${JSON.stringify(v)}`);
  }
  return v;
}

// ── Публичный API парсинга ─────────────────────────────────────────────────

/** Полное разложение: модель + список неизвестных полей (ТЗ 02 §4 п.5). */
export function parseSpecWithWarnings(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = yaml.load(text);
  } catch (e) {
    throw new SpecParseError(`Не удалось разобрать YAML: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!isPlainObject(raw)) {
    throw new SpecParseError('Спекация должна быть YAML-документом с ключами верхнего уровня (grid, types, …)');
  }

  const unknown: string[] = [];

  for (const key of Object.keys(raw)) {
    if (!KNOWN_TOP.has(key)) noteUnknown(unknown, key, '');
  }

  // grid
  const gridRaw = raw.grid;
  if (!isPlainObject(gridRaw)) fail('grid', 'обязателен блок grid: { width, height }');
  const width = checkInt(gridRaw.width, 'grid.width', { min: 1 });
  const height = checkInt(gridRaw.height, 'grid.height', { min: 1 });

  const doc: SpecDoc = {
    grid: { width, height },
    blockedFile: parseFileRef(raw.blockedFile, 'blockedFile'),
    presetFile: parseFileRef(raw.presetFile, 'presetFile'),
    types: parseTypes(raw.types, unknown),
    rules: parseRules(raw.rules, unknown),
    clusters: parseClusters(raw.clusters, unknown),
  };
  return { doc, unknownFields: unknown };
}

/** Разбор YAML-спеки → SpecDoc. Бросает SpecParseError с причиной на русском. */
export function parseSpec(text: string): SpecDoc {
  return parseSpecWithWarnings(text).doc;
}

// ── Сериализация (dump) ────────────────────────────────────────────────────

/** YAML-скаляр: без кавычек если безопасно, иначе в двойных кавычках. */
function yamlScalar(value: string): string {
  const plain =
    value.length > 0 &&
    !/^[?\-!&*#|>%@`"'{}\[\],]/.test(value) &&
    /[^ \t]/.test(value) &&
    value === value.trim() &&
    !/[:\s]$/.test(value) &&
    !/: /.test(value) &&
    !/(^|\s)#/.test(value) &&
    !/^(true|false|null|yes|no|on|off)$/i.test(value) &&
    !/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(value);
  if (plain) return value;
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
}

/** Строка всегда в двойных кавычках (для symbol типов, ТЗ 02 §4). */
function yamlQuoted(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
}

/** Число «как введено»: целое без `.0`, дробное — в десятичной записи. */
function yamlNumber(value: number): string {
  return String(value);
}

/** basename без пути (ТЗ 02 §4 «нюансы» и §6: редактор не знает путей). */
function basenameOnly(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

function dumpTypeEntries(types: Record<string, TypeDef>, out: string[]): void {
  const ids = Object.keys(types);
  if (ids.length === 0) {
    out.push('types: {}');
    return;
  }
  out.push('types:');
  for (const id of ids) {
    const def = types[id];
    const parts = [`symbol: ${yamlQuoted(def.symbol)}`];
    if (def.name !== null) parts.push(`name: ${yamlScalar(def.name)}`);
    out.push(`  ${yamlScalar(id)}: { ${parts.join(', ')} }`);
  }
}

function dumpPairList(pairs: [string, string][], indent: string, out: string[]): void {
  for (const [a, b] of pairs) {
    out.push(`${indent}- [${yamlScalar(a)}, ${yamlScalar(b)}]`);
  }
}

function dumpRules(rules: Rules, out: string[]): void {
  out.push('rules:');
  out.push(`  connectivity: ${yamlNumber(rules.connectivity)}`);
  out.push('  adjacency:');
  if (rules.adjacency.forbidden.length === 0) {
    out.push('    forbidden: []');
  } else {
    out.push('    forbidden:');
    dumpPairList(rules.adjacency.forbidden, '      ', out);
  }
  if (rules.adjacency.allow === null) {
    out.push('    allow: null');
  } else {
    out.push('    allow:');
    dumpPairList(rules.adjacency.allow, '      ', out);
  }
  out.push('  size:');
  out.push(`    min: ${rules.size.min === null ? 'null' : yamlNumber(rules.size.min)}`);
  out.push(`    max: ${rules.size.max === null ? 'null' : yamlNumber(rules.size.max)}`);
  out.push('  convexity:');
  out.push(`    weight: ${rules.convexity.weight}`);
  out.push(`  fillAll: ${rules.fillAll}`);
  out.push(`  touchAll: ${rules.touchAll}`);
}

function dumpClusters(clusters: ClusterEntry[], out: string[]): void {
  if (clusters.length === 0) {
    out.push('clusters: []');
    return;
  }
  out.push('clusters:');
  for (const c of clusters) {
    out.push(`  - id: ${yamlScalar(c.id)}`);
    out.push(`    type: ${yamlScalar(c.type)}`);
    out.push(`    areaPercent: ${yamlNumber(c.areaPercent)}`);
    out.push(`    shape: ${c.shape}`);
  }
}

/** Сериализация SpecDoc → канонический YAML (эталон — ТЗ 02 §4). */
export function dumpSpec(doc: SpecDoc): string {
  const out: string[] = [];
  out.push('grid:');
  out.push(`  width: ${yamlNumber(doc.grid.width)}`);
  out.push(`  height: ${yamlNumber(doc.grid.height)}`);
  out.push(`blockedFile: ${doc.blockedFile === null ? 'null' : yamlScalar(basenameOnly(doc.blockedFile))}`);
  out.push(`presetFile: ${doc.presetFile === null ? 'null' : yamlScalar(basenameOnly(doc.presetFile))}`);
  dumpTypeEntries(doc.types, out);
  dumpRules(doc.rules, out);
  dumpClusters(doc.clusters, out);
  return out.join('\n') + '\n';
}
