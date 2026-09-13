// Исполнители действий LLM-агента (ТЗ docs-llm/03 §4–§7; 05 §1).
// Чистые функции валидации/преобразований + async-исполнители с DI (env).
// КРИТИЧНОЕ ПРАВИЛО (03 §6): существующие файлы проекта НИКОГДА не изменяются —
// коррекция создаёт НОВЫЙ файл; areaPercent-оверрайд — одноразовая временная
// копия спеки ВНЕ каталога проекта (файлы проекта не трогаются).
import os from 'node:os';
import fsp from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';

import { runSolver } from '../generate.js';
import {
  nextResultName,
  readMeta,
  RESULT_NAME_RE,
  writeMeta,
  type Clock,
} from '../workspace.js';
import { countFreeCells, maskToGrid, parseSpec, type SpecInfo } from './specInfo.js';
import { buildClusterSummary, buildGeometrySummary, extractMapLines, parseTableRows } from './reportParse.js';

// ---------------------------------------------------------------------------
// Лимиты прогона (ТЗ docs-llm/05 §2)
// ---------------------------------------------------------------------------

export interface LlmLimits {
  /** Максимум запусков run_generation + correct_result за прогон (≤ 50). */
  maxIterations: number;
  /** --time-budget каждого запуска, если LLM не передала свой (сек). */
  timeBudgetPerRun: number;
  /** Стеновое время всей сессии (сек). */
  totalTimeoutSec: number;
}

export const DEFAULT_LLM_LIMITS: LlmLimits = {
  maxIterations: 5,
  timeBudgetPerRun: 2.0,
  totalTimeoutSec: 180,
};

/** Допуск оверрайдов areaPercent от цели кластера (03 §4; тот же порог, что и валидатор). */
export const AREA_TOLERANCE_PERCENT = 10;

// ---------------------------------------------------------------------------
// Валидация оверрайдов run_generation (чистая функция, 03 §3–§4)
// ---------------------------------------------------------------------------

const ALLOWED_RUN_ARGS: ReadonlySet<string> = new Set(['seed', 'timeBudget', 'nodeBudget', 'areaPercent']);

export interface CheckedRunArgs {
  seed?: number;
  timeBudget?: number;
  nodeBudget?: number;
  areaPercent?: Record<string, number>;
}

export type OverrideCheck = { ok: true; args: CheckedRunArgs } | { ok: false; error: string };

/**
 * Проверка аргументов run_generation. Разрешены ТОЛЬКО seed / timeBudget /
 * nodeBudget / areaPercent (в пределах допуска ±10% от цели кластера).
 * Любые прочие ключи (touchAll, grid, маски, types, shape и т.п.) — ошибка.
 */
export function checkGenerationArgs(
  args: Record<string, unknown>,
  spec: SpecInfo,
  freeCells: number,
): OverrideCheck {
  const forbidden = Object.keys(args).filter((k) => !ALLOWED_RUN_ARGS.has(k));
  if (forbidden.length > 0) {
    return {
      ok: false,
      error:
        `аргумент ${forbidden.map((k) => `«${k}»`).join(', ')} запрещён в рамках LLM-прогона: ` +
        'можно менять только seed, timeBudget, nodeBudget и areaPercent (±10% от цели кластера). ' +
        'Повтори действие без запрещённых аргументов.',
    };
  }

  let seed: number | undefined;
  if (args.seed !== undefined) {
    if (typeof args.seed !== 'number' || !Number.isInteger(args.seed) || args.seed < 0) {
      return { ok: false, error: 'аргумент `seed` должен быть целым числом ≥ 0. Исправь аргументы и повтори действие.' };
    }
    seed = args.seed;
  }

  let timeBudget: number | undefined;
  if (args.timeBudget !== undefined) {
    if (typeof args.timeBudget !== 'number' || !Number.isFinite(args.timeBudget) || args.timeBudget <= 0) {
      return { ok: false, error: 'аргумент `timeBudget` должен быть числом > 0 (секунды). Исправь аргументы и повтори действие.' };
    }
    timeBudget = args.timeBudget;
  }

  let nodeBudget: number | undefined;
  if (args.nodeBudget !== undefined) {
    if (typeof args.nodeBudget !== 'number' || !Number.isInteger(args.nodeBudget) || args.nodeBudget <= 0) {
      return { ok: false, error: 'аргумент `nodeBudget` должен быть целым числом > 0. Исправь аргументы и повтори действие.' };
    }
    nodeBudget = args.nodeBudget;
  }

  let areaPercent: Record<string, number> | undefined;
  if (args.areaPercent !== undefined) {
    if (typeof args.areaPercent !== 'object' || args.areaPercent === null || Array.isArray(args.areaPercent)) {
      return { ok: false, error: 'аргумент `areaPercent` должен быть объектом { "<id кластера>": <доля % > }. Исправь аргументы.' };
    }
    areaPercent = {};
    for (const [clusterId, pct] of Object.entries(args.areaPercent as Record<string, unknown>)) {
      const cluster = spec.clusters.find((c) => c.id === clusterId);
      if (cluster === undefined) {
        return { ok: false, error: `кластер «${clusterId}» не найден в спеке проекта. Допустимые id: ${spec.clusters.map((c) => c.id).join(', ')}.` };
      }
      if (typeof pct !== 'number' || !Number.isFinite(pct)) {
        return { ok: false, error: `кластер «${clusterId}»: доля areaPercent должна быть числом (процент). Исправь аргументы.` };
      }
      const target = Math.round((freeCells * cluster.areaPercent) / 100);
      if (target <= 0) {
        return { ok: false, error: `кластер «${clusterId}»: цель 0 клеток — оверрайд доли не допускается.` };
      }
      const newTarget = Math.round((freeCells * pct) / 100);
      const tolerance = (AREA_TOLERANCE_PERCENT / 100) * target; // границы включительно
      if (Math.abs(newTarget - target) > tolerance) {
        const low = Math.round(target * (1 - AREA_TOLERANCE_PERCENT / 100));
        const high = Math.round(target * (1 + AREA_TOLERANCE_PERCENT / 100));
        return {
          ok: false,
          error:
            `кластер «${clusterId}»: запрошенная доля ${pct}% (≈${newTarget} клеток) выходит за допуск ` +
            `${AREA_TOLERANCE_PERCENT}% от цели ${target} клеток (разрешено ≈${low}–${high}). ` +
            'Уменьши оверрайд или используй correct_result.',
        };
      }
      areaPercent[clusterId] = pct;
    }
  }

  return { ok: true, args: { seed, timeBudget, nodeBudget, areaPercent } };
}

// ---------------------------------------------------------------------------
// Применение edits к карте (чистая функция, 03 §6)
// ---------------------------------------------------------------------------

export interface MapEdit {
  x: number;
  y: number;
  symbol: string;
}

/** Допустимые символы маски: {*, .} ∪ символы spec.types (03 §6). */
export function allowedMaskSymbols(spec: SpecInfo): ReadonlySet<string> {
  const set = new Set<string>(['*', '.']);
  for (const t of Object.values(spec.types)) set.add(t.symbol);
  return set;
}

export type EditsCheck =
  | { ok: true; edits: MapEdit[] }
  | { ok: false; error: string };

/** Валидация массива edits: непустой, координаты в пределах сетки, symbol допустим. */
export function checkMapEdits(
  rawEdits: unknown,
  spec: SpecInfo,
): EditsCheck {
  if (!Array.isArray(rawEdits) || rawEdits.length === 0) {
    return { ok: false, error: 'аргумент `edits` — непустой массив объектов {x, y, symbol}. Исправь аргументы.' };
  }
  const allowed = allowedMaskSymbols(spec);
  const edits: MapEdit[] = [];
  for (const [i, e] of (rawEdits as unknown[]).entries()) {
    if (typeof e !== 'object' || e === null) {
      return { ok: false, error: `edits[${i}] — объект {x, y, symbol}. Исправь аргументы.` };
    }
    const rec = e as Record<string, unknown>;
    if (typeof rec.x !== 'number' || !Number.isInteger(rec.x) || rec.x < 0 || rec.x >= spec.width) {
      return { ok: false, error: `edits[${i}].x — целое в пределах 0..${spec.width - 1}. Исправь координаты.` };
    }
    if (typeof rec.y !== 'number' || !Number.isInteger(rec.y) || rec.y < 0 || rec.y >= spec.height) {
      return { ok: false, error: `edits[${i}].y — целое в пределах 0..${spec.height - 1}. Исправь координаты.` };
    }
    if (typeof rec.symbol !== 'string' || rec.symbol.length !== 1 || !allowed.has(rec.symbol)) {
      const symbols = [...allowed].join('');
      return { ok: false, error: `edits[${i}].symbol — один символ из набора «${symbols}». Исправь аргументы.` };
    }
    edits.push({ x: rec.x, y: rec.y, symbol: rec.symbol });
  }
  return { ok: true, edits };
}

/** Применение edits к строкам КАРТЫ (возвращает НОВЫЙ массив; исходный не меняется). */
export function applyEditsToMap(mapLines: string[], edits: MapEdit[]): string[] {
  const grid = mapLines.map((line) => [...line]);
  for (const e of edits) {
    grid[e.y][e.x] = e.symbol;
  }
  return grid.map((row) => row.join(''));
}

/**
 * Замена секции «== КАРТА ==» в тексте отчёта на новые строки карты.
 * Остальной текст отчёта переносится как есть (формат не меняется).
 */
export function replaceMapSection(reportText: string, newMapLines: string[]): string {
  const lines = reportText.split('\n');
  const idx = lines.findIndex((l) => l.trim() === '== КАРТА ==');
  if (idx === -1) throw new Error('в отчёте нет секции «== КАРТА ==»');
  // Пустая строка после заголовка (склеенные секции "\n\n") сохраняется как есть.
  let start = idx + 1;
  while (start < lines.length && lines[start] === '') start++;
  let end = start;
  while (end < lines.length && lines[end] !== '' && !lines[end].startsWith('==')) end++;
  lines.splice(start, end - start, ...newMapLines);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Проверка имени result-файла проекта (03 §3.2)
// ---------------------------------------------------------------------------

function checkResultFileName(name: unknown): string | null {
  if (typeof name !== 'string' || name.length === 0) return null;
  // Только basename по регламенту: пути/../ и прочие имена отвергаются.
  if (!RESULT_NAME_RE.test(name)) return null;
  return name;
}

async function resultFileExists(projectDir: string, name: string): Promise<boolean> {
  try {
    const st = await fsp.stat(path.join(projectDir, name));
    return st.isFile();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Окружение исполнителей (DI; собирает агентный цикл)
// ---------------------------------------------------------------------------

export interface ActionEnv {
  projectDir: string;
  pythonBin: string;
  now: Clock;
  specText: string;
  spec: SpecInfo;
  /** Свободные клетки F (база процентов, docs/03 §3). */
  freeCells: number;
  limits: LlmLimits;
  /** Таймаут child-процесса валидатора, мс (таймаут обычной генерации). */
  validateTimeoutMs: number;
  /** Стоп сессии: SIGKILL child-процесса текущего запуска. */
  signal?: AbortSignal;
  isStopped: () => boolean;
}

export interface ActionResult {
  ok: boolean;
  /** Текст сообщения для LLM (Результат … / Ошибка …). */
  text: string;
  /** Короткая строка для журнала. */
  summary: string;
  /** Созданный result-файл (run_generation/correct_result при успехе). */
  file?: string;
  exitCode?: number;
  feasible?: boolean;
  /** finish: кандидаты сессии. */
  done?: { candidates: Array<{ file: string; comment: string }>; recommended?: string };
}

/** Необратимый сбой цикла (spawn, IO спеки) — сессия → error (05 §1.4). */
export class SessionFatalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionFatalError';
  }
}

// ---------------------------------------------------------------------------
// run_generation (03 §4)
// ---------------------------------------------------------------------------

/** Одноразовая временная копия спеки с оверрайдами areaPercent (вНЕ проекта). */
async function makeTempSpecCopy(
  projectDir: string,
  specText: string,
  overrides: Record<string, number>,
): Promise<{ tempDir: string; specPath: string }> {
  let raw: unknown;
  try {
    raw = yaml.load(specText);
  } catch (err) {
    throw new SessionFatalError(`не удалось разобрать spec.yaml для временной копии: ${(err as Error).message}`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SessionFatalError('spec.yaml: корневой объект отсутствует');
  }
  const doc = raw as Record<string, unknown>;
  const clusters = doc.clusters;
  if (!Array.isArray(clusters)) throw new SessionFatalError('spec.yaml: блок clusters отсутствует');
  let replaced = 0;
  for (const c of clusters) {
    if (typeof c !== 'object' || c === null) continue;
    const rec = c as Record<string, unknown>;
    if (typeof rec.id === 'string' && Object.prototype.hasOwnProperty.call(overrides, rec.id)) {
      rec.areaPercent = overrides[rec.id];
      replaced++;
    }
  }
  // Пути масок — абсолютные к файлам проекта (резолвятся от каталога спеки).
  for (const key of ['blockedFile', 'presetFile']) {
    const v = doc[key];
    if (typeof v === 'string' && v.length > 0) doc[key] = path.resolve(projectDir, v);
  }
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'space-manager-llm-'));
  const specPath = path.join(tempDir, 'spec.yaml');
  await fsp.writeFile(specPath, yaml.dump(doc), 'utf8');
  if (replaced !== Object.keys(overrides).length) {
    // checkGenerationArgs уже проверил id; на всякий случай — явная ошибка.
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    throw new SessionFatalError('spec.yaml: не удалось применить оверрайды areaPercent');
  }
  return { tempDir, specPath };
}

export async function runGeneration(env: ActionEnv, args: Record<string, unknown>): Promise<ActionResult> {
  const check = checkGenerationArgs(args, env.spec, env.freeCells);
  if (!check.ok) {
    return { ok: false, text: `Ошибка: ${check.error}`, summary: `ошибка: ${check.error}` };
  }
  const { seed, timeBudget, nodeBudget, areaPercent } = check.args;
  const budget = timeBudget ?? env.limits.timeBudgetPerRun;

  let tempDir: string | null = null;
  try {
    let specPath = path.join(env.projectDir, 'spec.yaml');
    if (areaPercent !== undefined && Object.keys(areaPercent).length > 0) {
      const tmp = await makeTempSpecCopy(env.projectDir, env.specText, areaPercent);
      tempDir = tmp.tempDir;
      specPath = tmp.specPath;
    }

    const resultName = await nextResultName(env.projectDir, env.now());
    const outPath = path.join(env.projectDir, resultName);
    const argv = [
      '-m', 'space_manager', 'place', specPath, '--out', outPath,
      ...(seed !== undefined ? ['--seed', String(seed)] : []),
      '--time-budget', String(budget),
      ...(nodeBudget !== undefined ? ['--node-budget', String(nodeBudget)] : []),
    ];

    const run = await runSolver(env.pythonBin, argv, {
      cwd: env.projectDir,
      // Защита от зависшего солвера (05 §2): бюджет запуска + 30 c, SIGKILL.
      timeoutMs: Math.round(budget * 1000) + 30_000,
      signal: env.signal,
    });

    if (run.timedOut || env.isStopped()) {
      // Стоп/таймаут во время запуска — частичный result-файл удаляется (05 §4).
      await fsp.rm(outPath, { force: true }).catch(() => undefined);
      if (env.isStopped()) {
        return { ok: false, text: 'Остановка сессии: запуск генератора был остановлен.', summary: 'остановлено пользователем во время запуска' };
      }
      return {
        ok: false,
        text: `Ошибка: запуск генератора превысил таймаут child-процесса (${Math.round(budget * 1000) + 30_000} мс) и был остановлен. Попробуй меньший timeBudget или другое действие.`,
        summary: `ошибка: таймаут запуска (${budget} с)`,
      };
    }
    if (run.spawnError !== null) {
      await fsp.rm(outPath, { force: true }).catch(() => undefined);
      throw new SessionFatalError(`сбой spawn солвера: ${run.spawnError}`);
    }

    const code = run.exitCode ?? 1;
    if (code === 2) {
      await fsp.rm(outPath, { force: true }).catch(() => undefined);
      const message = run.stderr.trim() || 'ОШИБКА ВХОДНЫХ ДАННЫХ: неизвестная ошибка';
      return { ok: false, text: `Ошибка: запуск генератора завершился с ошибкой входных данных (exit 2): ${message}`, summary: `ошибка: exit 2 — ${message.slice(0, 120)}` };
    }

    let report: string;
    try {
      report = await fsp.readFile(outPath, 'utf8');
    } catch {
      throw new SessionFatalError('солвер завершился, но файл отчёта не найден');
    }
    // Результат попадает в общую историю: latestResult обновляется как в generate.
    const meta = await readMeta(env.projectDir);
    await writeMeta(env.projectDir, { ...meta, latestResult: resultName, updatedAt: env.now().toISOString() });

    const mapLines = extractMapLines(report);
    const summary = buildClusterSummary(parseTableRows(report));
    if (mapLines !== null) {
      Object.assign(summary, buildGeometrySummary(mapLines, env.spec.types));
    }
    const feasible = code === 0;
    return {
      ok: true,
      file: resultName,
      exitCode: code,
      feasible,
      text: `Результат run_generation: ${JSON.stringify({
        file: resultName,
        exitCode: code,
        feasible,
        summary,
      })}`,
      summary: `файл ${resultName} (exit ${code}${feasible ? '' : ', infeasible'})`,
    };
  } finally {
    if (tempDir !== null) {
      await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

// ---------------------------------------------------------------------------
// read_result (03 §5)
// ---------------------------------------------------------------------------

export async function readResult(env: ActionEnv, args: Record<string, unknown>): Promise<ActionResult> {
  const name = checkResultFileName(args.file);
  if (name === null) {
    return {
      ok: false,
      text: `Ошибка: аргумент «${String(args.file)}» — имя должно быть basename существующего result-файла проекта (result-<YYYYMMDD-HHMMSS>.txt), без путей.`,
      summary: 'ошибка: неверное имя файла',
    };
  }
  if (!(await resultFileExists(env.projectDir, name))) {
    return { ok: false, text: `Ошибка: файл «${name}» не найден в проекте.`, summary: `ошибка: файл «${name}» отсутствует` };
  }
  const report = await fsp.readFile(path.join(env.projectDir, name), 'utf8');
  const mapLines = extractMapLines(report);
  const parts: string[] = [`Результат read_result:`, `--- ОТЧЁТ ${name} ---`, report];
  if (mapLines !== null) {
    parts.push('--- СВОДКА ПО КЛАСТЕРАМ (JSON) ---');
    parts.push(JSON.stringify(buildClusterSummary(parseTableRows(report))));
    parts.push('--- ГЕОМЕТРИЯ СВЯЗНЫХ ОБЛАСТЕЙ КАРТЫ (JSON) ---');
    parts.push(JSON.stringify(buildGeometrySummary(mapLines, env.spec.types)));
  } else {
    parts.push('--- СВОДКА ---');
    parts.push('В файле нет секции «== КАРТА ==» — это не стандартный result-отчёт.');
  }
  return { ok: true, file: name, text: parts.join('\n'), summary: `отчёт «${name}» прочитан` };
}

// ---------------------------------------------------------------------------
// correct_result (03 §6)
// ---------------------------------------------------------------------------

export async function correctResult(env: ActionEnv, args: Record<string, unknown>): Promise<ActionResult> {
  const baseName = checkResultFileName(args.baseFile);
  if (baseName === null) {
    return {
      ok: false,
      text: `Ошибка: аргумент «${String(args.baseFile)}» — имя должно быть basename существующего result-файла проекта, без путей.`,
      summary: 'ошибка: неверное имя baseFile',
    };
  }
  if (!(await resultFileExists(env.projectDir, baseName))) {
    return { ok: false, text: `Ошибка: файл «${baseName}» не найден в проекте.`, summary: `ошибка: файл «${baseName}» отсутствует` };
  }
  const editsCheck = checkMapEdits(args.edits, env.spec);
  if (!editsCheck.ok) {
    return { ok: false, text: `Ошибка: ${editsCheck.error}`, summary: `ошибка: ${editsCheck.error}` };
  }
  if (typeof args.reason !== 'string') {
    return { ok: false, text: 'Ошибка: аргумент `reason` — строка (почему вносится правка). Исправь аргументы.', summary: 'ошибка: отсутствует reason' };
  }

  const baseText = await fsp.readFile(path.join(env.projectDir, baseName), 'utf8');
  const mapLines = extractMapLines(baseText);
  if (mapLines === null) {
    return { ok: false, text: `Ошибка: в файле «${baseName}» нет секции «== КАРТА ==» — коррекция невозможна.`, summary: 'ошибка: нет секции КАРТА' };
  }

  // Новый файл на основе исходного; исходный НЕ изменяется (критичное правило).
  const newMap = applyEditsToMap(mapLines, editsCheck.edits);
  const newText = replaceMapSection(baseText, newMap);
  const newName = await nextResultName(env.projectDir, env.now());
  const newPath = path.join(env.projectDir, newName);
  await fsp.writeFile(newPath, newText, 'utf8');

  // Валидация обязательна: space_manager validate <новый> --spec spec.yaml.
  const run = await runSolver(
    env.pythonBin,
    ['-m', 'space_manager', 'validate', newPath, '--spec', path.join(env.projectDir, 'spec.yaml')],
    { cwd: env.projectDir, timeoutMs: env.validateTimeoutMs, signal: env.signal },
  );

  if (run.spawnError !== null) {
    await fsp.rm(newPath, { force: true }).catch(() => undefined);
    throw new SessionFatalError(`сбой spawn валидатора: ${run.spawnError}`);
  }
  if (run.timedOut || env.isStopped()) {
    await fsp.rm(newPath, { force: true }).catch(() => undefined);
    return { ok: false, text: 'Ошибка: запуск валидатора был остановлен.', summary: 'остановлено во время валидации' };
  }

  const code = run.exitCode ?? 1;
  if (code === 3) {
    // Невалидный файл удаляется — в проект и историю не попадает.
    await fsp.rm(newPath, { force: true }).catch(() => undefined);
    const violations = run.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('НАРУШЕНИЕ'));
    const list = (violations.length > 0 ? violations : ['не удалось разобрать список нарушений']).map(
      (v, i) => `  ${i + 1}) ${v.replace(/^НАРУШЕНИЕ /, '')}`,
    ).join('\n');
    return {
      ok: false,
      text:
        `Ошибка: correct_result — нарушения валидации нового файла ${newName}:\n${list}\n` +
        'Исправь edits и повтори correct_result (исходный файл не изменяется).',
      summary: `ошибка: нарушения валидации (${violations.length > 0 ? violations.length : '?'})`,
    };
  }
  if (code !== 0) {
    await fsp.rm(newPath, { force: true }).catch(() => undefined);
    const message = run.stderr.trim() || 'неизвестная ошибка валидации';
    return { ok: false, text: `Ошибка: валидатор завершился с кодом ${code}: ${message}`, summary: `ошибка: validate exit ${code}` };
  }

  // Валидно: файл остаётся в проекте; latestResult обновляется как при генерации.
  const meta = await readMeta(env.projectDir);
  await writeMeta(env.projectDir, { ...meta, latestResult: newName, updatedAt: env.now().toISOString() });
  const validateOut = run.stdout.trim();
  return {
    ok: true,
    file: newName,
    text:
      `Результат correct_result: ${JSON.stringify({ file: newName, validated: true })}` +
      (validateOut ? `\nВывод validate: ${validateOut}` : ''),
    summary: `создан новый файл ${newName}, validate пройден`,
  };
}

// ---------------------------------------------------------------------------
// finish (03 §7)
// ---------------------------------------------------------------------------

export async function finish(env: ActionEnv, args: Record<string, unknown>): Promise<ActionResult> {
  const rawCandidates = args.candidates;
  if (!Array.isArray(rawCandidates) || rawCandidates.length === 0) {
    return {
      ok: false,
      text: 'Ошибка: аргумент `candidates` — непустой массив {file, comment}. Исправь аргументы.',
      summary: 'ошибка: candidates пуст или не массив',
    };
  }
  const candidates: Array<{ file: string; comment: string }> = [];
  for (const [i, c] of (rawCandidates as unknown[]).entries()) {
    if (typeof c !== 'object' || c === null) {
      return { ok: false, text: `Ошибка: candidates[${i}] — объект {file, comment}. Исправь аргументы.`, summary: `ошибка: candidates[${i}] не объект` };
    }
    const rec = c as Record<string, unknown>;
    const name = checkResultFileName(rec.file);
    if (name === null) {
      return { ok: false, text: `Ошибка: candidates[${i}].file — имя должно быть basename существующего result-файла проекта.`, summary: `ошибка: candidates[${i}].file` };
    }
    if (!(await resultFileExists(env.projectDir, name))) {
      return { ok: false, text: `Ошибка: файл «${name}» не найден в проекте.`, summary: `ошибка: файл «${name}» отсутствует` };
    }
    if (typeof rec.comment !== 'string') {
      return { ok: false, text: `Ошибка: candidates[${i}].comment — строка. Исправь аргументы.`, summary: `ошибка: candidates[${i}].comment` };
    }
    candidates.push({ file: name, comment: rec.comment });
  }

  let recommended: string | undefined;
  if (args.recommended !== undefined) {
    if (typeof args.recommended !== 'string') {
      return { ok: false, text: 'Ошибка: `recommended` — имя файла одного из кандидатов. Исправь аргументы.', summary: 'ошибка: recommended не строка' };
    }
    if (!candidates.some((c) => c.file === args.recommended)) {
      return { ok: false, text: 'Ошибка: `recommended` должен быть файлом из списка candidates. Исправь аргументы.', summary: 'ошибка: recommended не в candidates' };
    }
    recommended = args.recommended;
  }

  return {
    ok: true,
    done: { candidates, ...(recommended !== undefined ? { recommended } : {}) },
    text: `Результат finish: сессия завершена. Кандидатов: ${candidates.length}.`,
    summary: `завершено; кандидатов: ${candidates.length}`,
  };
}

// ---------------------------------------------------------------------------
// Сборка окружения (чистая часть — для DI/тестов)
// ---------------------------------------------------------------------------

/** Разбор спеки и масок проекта для ActionEnv (ошибки → SessionFatalError). */
export async function buildActionEnv(
  projectDir: string,
  specText: string,
): Promise<Pick<ActionEnv, 'spec' | 'freeCells'>> {
  let spec: SpecInfo;
  try {
    spec = parseSpec(specText);
  } catch (err) {
    throw new SessionFatalError((err as Error).message);
  }
  const blockedPath = spec.blockedFile !== null ? path.resolve(projectDir, spec.blockedFile) : null;
  let grid: string[][];
  if (blockedPath !== null) {
    let text: string;
    try {
      text = await fsp.readFile(blockedPath, 'utf8');
    } catch {
      throw new SessionFatalError(`маска блокировок «${spec.blockedFile}» не читается`);
    }
    try {
      grid = maskToGrid(text, spec.width, spec.height);
    } catch (err) {
      throw new SessionFatalError((err as Error).message);
    }
  } else {
    grid = Array.from({ length: spec.height }, () => Array<string>(spec.width).fill('.'));
  }
  return { spec, freeCells: countFreeCells(grid) };
}
