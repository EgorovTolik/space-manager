// Журнал прогонов LLM: workspace/<slug>/llm-sessions/<YYYYMMDD-HHMMSS>.json
// (ТЗ docs-llm/05 §5). Чистые типы + атомарные fs-операции (tmp + rename).
import fsp from 'node:fs/promises';
import path from 'node:path';

import { timestampOf, type Clock } from '../workspace.js';
import type { LlmLimits } from './actions.js';

export type LlmSessionStatus = 'running' | 'done' | 'stopped' | 'error';

export interface LlmIterationLog {
  /** Номер шага (LLM-ответ → действие), с 1. */
  n: number;
  /** Имя действия; null — неверный ответ протокола (действие не распознано). */
  action: string | null;
  args: Record<string, unknown>;
  ok: boolean;
  /** Краткая строка на русском (thought LLM + результат действия/ошибка). */
  summary: string;
  /** Дословный ответ модели на этот шаг (включая шаги с ошибкой протокола),
   * усечённый до RAW_MAX_LEN (ST-1, отладка локальных моделей). Опционально:
   * старые журналы — без поля и остаются читаемыми. В llm-status НЕ попадает
   * (опрос остаётся лёгким) — только в полный журнал сессии и файл журнала. */
  raw?: string;
}

export interface LlmCandidate {
  file: string;
  comment: string;
}

/** Формат записи журнала (исчерпывающий, 05 §5). `error` — только при stopped/error. */
export interface LlmJournalRecord {
  prompt: string;
  modelId: string;
  limits: LlmLimits;
  iterations: LlmIterationLog[];
  candidates?: LlmCandidate[];
  recommended?: string;
  /** Пояснение авто-завершения по стагнации (05 §2.1); старые записи — без поля. */
  note?: string;
  status: LlmSessionStatus;
  startedAt: string;
  finishedAt: string | null;
  error?: string;
}

export const SESSIONS_DIR = 'llm-sessions';
/** id сессии = имя журнала без .json (несёт timestamp, локальные часы системы проекта). */
export const SESSION_ID_RE = /^\d{8}-\d{6}(-\d+)?$/;

/** Максимальная длина дословного ответа модели в журнале (ST-1). */
export const RAW_MAX_LEN = 8000;

/** Усечение raw: при превышении RAW_MAX_LEN — префикс + «…(N символов)» в конце. */
export function truncateRaw(text: string): string {
  return text.length > RAW_MAX_LEN ? `${text.slice(0, RAW_MAX_LEN)}…(${text.length} символов)` : text;
}

export function sessionsDirOf(projectDir: string): string {
  return path.join(projectDir, SESSIONS_DIR);
}

/** Новый id сессии (коллизию в ту же секунду снимаем суффиксами -1, -2…). */
export async function nextSessionId(projectDir: string, now: Clock): Promise<string> {
  const dir = sessionsDirOf(projectDir);
  const base = timestampOf(now());
  let candidate = base;
  let suffix = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await fsp.access(path.join(dir, `${candidate}.json`));
    } catch {
      return candidate; // нет файла — id свободен
    }
    candidate = `${base}-${suffix}`;
    suffix++;
  }
}

/** Атомарная запись журнала (tmp + rename). */
export async function writeJournalRecord(projectDir: string, sessionId: string, record: LlmJournalRecord): Promise<void> {
  if (!SESSION_ID_RE.test(sessionId)) throw new Error(`некорректный id сессии «${sessionId}»`);
  const dir = sessionsDirOf(projectDir);
  await fsp.mkdir(dir, { recursive: true });
  const finalPath = path.join(dir, `${sessionId}.json`);
  const tmpPath = path.join(dir, `${sessionId}.json.tmp`);
  await fsp.writeFile(tmpPath, JSON.stringify(record, null, 2) + '\n', 'utf8');
  await fsp.rename(tmpPath, finalPath);
}

/** Чтение журнала; null — файл отсутствует или не читается/не парсится. */
export async function readJournalRecord(projectDir: string, sessionId: string): Promise<LlmJournalRecord | null> {
  if (!SESSION_ID_RE.test(sessionId)) return null;
  try {
    const raw = await fsp.readFile(path.join(sessionsDirOf(projectDir), `${sessionId}.json`), 'utf8');
    const data = JSON.parse(raw) as Partial<LlmJournalRecord>;
    if (typeof data !== 'object' || data === null) return null;
    if (typeof data.prompt !== 'string' || typeof data.modelId !== 'string') return null;
    if (data.status !== 'running' && data.status !== 'done' && data.status !== 'stopped' && data.status !== 'error') {
      return null;
    }
    if (!Array.isArray(data.iterations)) return null;
    return data as LlmJournalRecord;
  } catch {
    return null;
  }
}

/** Список журналов newest-first (по имени файла — имя несёт timestamp). */
export async function listJournals(projectDir: string): Promise<Array<{ sessionId: string; record: LlmJournalRecord }>> {
  let names: string[] = [];
  try {
    const entries = await fsp.readdir(sessionsDirOf(projectDir), { withFileTypes: true });
    names = entries.filter((e) => e.isFile() && e.name.endsWith('.json')).map((e) => e.name.slice(0, -5));
  } catch {
    return []; // каталога llm-sessions ещё нет
  }
  names.sort((a, b) => b.localeCompare(a)); // desc: свежая первая
  const out: Array<{ sessionId: string; record: LlmJournalRecord }> = [];
  for (const id of names) {
    const record = await readJournalRecord(projectDir, id);
    if (record !== null) out.push({ sessionId: id, record });
  }
  return out;
}
