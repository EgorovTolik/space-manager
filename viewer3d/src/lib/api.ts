// HTTP-слой viewer3d (единый сервис, docs-unified/02-workspace-api.md; проектный
// режим — docs-unified/04-integrations.md §2.2). Standalone-режим «загрузил файл с
// диска» удалён: все операции идут через /api единого сервиса (:4080, в dev —
// vite-proxy). Паттерн ошибок — editor/src/lib/api.ts (ApiError из JSON {error,message}).

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

// ── Проектный API (docs-unified/04 §2.2, форма — как у редактора §1.4) ───────────

/** Запись списка проектов (`GET /api/projects`, docs-unified/02 §6.2). */
export interface ProjectInfo {
  id: string | null; // null — для corrupted-проектов
  name: string;
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

/** Запись списка ревизий (`GET …/<p>/results`, docs-unified/02 §6.11): имя desc — свежая первая. */
export interface ResultFile {
  name: string;
  sizeBytes: number;
  mtimeIso: string;
}

export async function listResults(project: string): Promise<ResultFile[]> {
  const res = await fetch(`/api/projects/${encodeURIComponent(project)}/results`);
  if (!res.ok) throw await toApiError(res);
  const body = (await res.json()) as { results: ResultFile[] };
  return body.results;
}

/** Чтение файла результата (`GET …/<p>/file?name=result-*.txt`, docs-unified/02 §6.8). */
export async function loadResultFile(project: string, file: string): Promise<string> {
  const res = await fetch(
    `/api/projects/${encodeURIComponent(project)}/file?name=${encodeURIComponent(file)}`,
  );
  if (!res.ok) throw await toApiError(res);
  return res.text();
}

/** Результат сохранения предпросмотра (`POST …/<p>/preview`, docs-unified/02 §6.13). */
export interface SavePreviewResponse {
  file: string; // имя, назначенное сервером: preview-<ts>.png
}

/**
 * Сохранение PNG-предпросмотра в проект (docs-unified/04 §2.4): тело — сырой PNG,
 * имя файла задаёт сервер. Бросает ApiError при HTTP-ошибке.
 */
export async function savePreview(project: string, blob: Blob): Promise<SavePreviewResponse> {
  const res = await fetch(`/api/projects/${encodeURIComponent(project)}/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/png' },
    body: blob,
  });
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as SavePreviewResponse;
}
