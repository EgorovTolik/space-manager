// HTTP-слой редактора (единый сервис, docs-unified/02-workspace-api.md; проектный
// режим — docs-unified/04-integrations.md §1.4). Standalone-режим «загрузил → скачал»
// удалён: все операции идут через /api единого сервиса (:4080, в dev — vite-proxy).

export interface HealthResponse {
  status: string;
  version: string;
}

/** Ошибка API: русский текст из JSON-ошибки `{error, message}` + статус/код для UI. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  let message = `HTTP ${res.status}`;
  let code = 'ERROR';
  try {
    const body = (await res.json()) as { error?: unknown; message?: unknown };
    if (typeof body.message === 'string' && body.message.length > 0) message = body.message;
    if (typeof body.error === 'string' && body.error.length > 0) code = body.error;
  } catch {
    // Не-JSON тело ошибки — оставляем «HTTP <status>».
  }
  return new ApiError(message, res.status, code);
}

export async function getHealth(): Promise<HealthResponse> {
  const res = await fetch('/api/health');
  if (!res.ok) {
    throw await toApiError(res);
  }
  return (await res.json()) as HealthResponse;
}

// ── Проектный API (docs-unified/04 §1.4) ─────────────────────────────────────

/** Запись списка проектов (`GET /api/projects`, docs-unified/02 §6.2).
 * `name` — человекочитаемое имя (любые символы), `slug` — машинный идентификатор
 * в URL и API-запросах (замечание 2 единого сервиса). */
export interface ProjectInfo {
  id: string | null; // null — для corrupted-проектов
  name: string;
  slug: string;
  createdAt: string | null;
  updatedAt: string | null;
  latestResult: string | null;
  corrupted?: boolean;
  sizeBytes: number;
  resultsCount: number;
  previewsCount: number;
  filesCount: number;
}

export async function listProjects(): Promise<ProjectInfo[]> {
  const res = await fetch('/api/projects');
  if (!res.ok) throw await toApiError(res);
  const body = (await res.json()) as { projects: ProjectInfo[] };
  return body.projects;
}

/** Чтение файла проекта (`GET …/<p>/file?name=…`, docs-unified/02 §6.8). */
export async function loadProjectFile(name: string, file: string): Promise<string> {
  const res = await fetch(
    `/api/projects/${encodeURIComponent(name)}/file?name=${encodeURIComponent(file)}`,
  );
  if (!res.ok) throw await toApiError(res);
  return res.text();
}

export interface SaveFilesResponse {
  saved: string[];
  deleted: string[];
}

/** Сохранение полного состояния редактируемых файлов (`PUT …/<p>/files`, 02 §6.9). */
export async function saveProjectFiles(
  name: string,
  files: Record<string, string>,
): Promise<SaveFilesResponse> {
  const res = await fetch(`/api/projects/${encodeURIComponent(name)}/files`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files }),
  });
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as SaveFilesResponse;
}

/** Запись списка ревизий генерации (`GET …/<p>/results`, docs-unified/02 §6.11). */
export interface ResultInfo {
  name: string; // имя файла result-<ts>.txt
  sizeBytes: number;
  mtimeIso: string;
}

/** Ревизии генерации проекта (свежая первая — сервер сортирует по имени desc). */
export async function listResults(slug: string): Promise<ResultInfo[]> {
  const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/results`);
  if (!res.ok) throw await toApiError(res);
  const body = (await res.json()) as { results: ResultInfo[] };
  return body.results;
}

/** Результат генерации (`POST …/<p>/generate`, 02 §6.10): exit 0 и 1 — HTTP 200.
 * `opts.seed` — опциональный integer ≥ 0 (параметр запуска солвера `--seed`; не
 * сохраняется в спеку). Не задан → тело `{}` (детерминированный DEFAULT_SEED). */
export interface GenerateResult {
  resultFile: string;
  exitCode: number;
  feasible: boolean;
  report: string;
}

export async function generatePlacement(
  name: string,
  opts?: { seed?: number },
): Promise<GenerateResult> {
  const body = opts?.seed === undefined ? {} : { seed: opts.seed };
  const res = await fetch(`/api/projects/${encodeURIComponent(name)}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as GenerateResult;
}
