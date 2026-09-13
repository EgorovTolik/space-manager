// HTTP-слой менеджера проектов: весь fetch к единому API (ТЗ 02 §6).
// Типы ответов — побайтово по docs-unified/02-workspace-api.md.

export interface ProjectMeta {
  id: string | null;
  /** Человекочитаемое имя проекта (показывается в UI). */
  name: string;
  /** Стабильный slug = ключ всех API-маршрутов и URL-ссылок. */
  slug: string;
  createdAt: string | null;
  updatedAt: string | null;
  latestResult: string | null;
  /** ТЗ 02 §2: project.json не читается как JSON. */
  corrupted?: boolean;
  sizeBytes: number;
  resultsCount: number;
  previewsCount: number;
  filesCount: number;
}

export interface PreviewEntry {
  name: string;
  sizeBytes: number;
  mtimeIso: string;
}

export interface ImportOutcome {
  project: ProjectMeta;
  imported: string[];
  skipped: { name: string; reason: string }[];
}

/** Ошибка API с кодом и статусом (формат ошибок — ТЗ 02 §5). */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
  }
}

async function toApiError(res: Response): Promise<ApiRequestError> {
  let code = 'UNKNOWN';
  let message = `HTTP ${res.status}`;
  try {
    const body = (await res.json()) as { error?: string; message?: string };
    if (typeof body.error === 'string' && body.error) code = body.error;
    if (typeof body.message === 'string' && body.message) message = body.message;
  } catch {
    // не-JSON тело — оставляем дефолтное сообщение
  }
  return new ApiRequestError(res.status, code, message);
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// ТЗ 02 §6.2–§6.6 — проекты
// ---------------------------------------------------------------------------

export async function listProjects(): Promise<ProjectMeta[]> {
  const res = await fetch('/api/projects');
  const body = await json<{ projects: ProjectMeta[] }>(res);
  return body.projects;
}

export async function createProject(name: string): Promise<ProjectMeta> {
  const res = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const body = await json<{ project: ProjectMeta }>(res);
  return body.project;
}

/** Замечание 2: меняет только человекочитаемое имя; slug (и каталог) не меняется. */
export async function renameProject(slug: string, newName: string): Promise<ProjectMeta> {
  const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/rename`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: newName }),
  });
  const body = await json<{ project: ProjectMeta }>(res);
  return body.project;
}

export async function deleteProject(slug: string): Promise<void> {
  const res = await fetch(`/api/projects/${encodeURIComponent(slug)}`, { method: 'DELETE' });
  if (res.status === 204) return;
  throw await toApiError(res);
}

/** Импорт проекта из zip (ТЗ 02 §6.6). Имя выводится сервером — ?name= не передаём. */
export async function importZip(file: File): Promise<ImportOutcome> {
  const res = await fetch('/api/projects/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/zip' },
    body: await file.arrayBuffer(),
  });
  return json<ImportOutcome>(res);
}

// ---------------------------------------------------------------------------
// ТЗ 02 §6.13 — preview (список; отдача картинки — через URL)
// ---------------------------------------------------------------------------

export async function getPreviews(slug: string): Promise<PreviewEntry[]> {
  const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/previews`);
  const body = await json<{ previews: PreviewEntry[] }>(res);
  return body.previews;
}
