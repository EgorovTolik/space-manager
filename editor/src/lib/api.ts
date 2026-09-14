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

/** Общий список типов (ST-2): глобальный каталог `GET /api/types-catalog`.
 * id → определение; сервер объединяет spec.yaml всех проектов + авто-регистрация
 * при каждом сохранении/импорте. Конфликты: живёт первое зарегистрированное определение. */
export interface TypesCatalog {
  types: Record<string, { symbol: string; name: string | null }>;
}

export async function fetchTypesCatalog(): Promise<TypesCatalog> {
  const res = await fetch('/api/types-catalog');
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as TypesCatalog;
}

/** Изменение типа каталога (ST-4): `PATCH /api/types-catalog/:id`, тело
 * `{symbol?, name?}`. Правится ТОЛЬКО глобальный каталог — спеки проектов не
 * меняются. Ошибки: 400 (битый symbol «.»/«*»/не один символ, name > 64,
 * пустое тело), 404 (нет id), 422 (symbol занят другим типом — id владельца в
 * сообщении). Ответ — обновлённый каталог целиком. */
export async function patchTypesCatalog(
  id: string,
  patch: { symbol?: string; name?: string | null },
): Promise<TypesCatalog> {
  const res = await fetch(`/api/types-catalog/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as TypesCatalog;
}

/** Удаление типа из каталога (ST-4): `DELETE /api/types-catalog/:id`.
 * Семантика та же — глобальный каталог, спеки проектов не меняются; 404 (нет id).
 * Ответ — обновлённый каталог целиком. */
export async function deleteTypesCatalog(id: string): Promise<TypesCatalog> {
  const res = await fetch(`/api/types-catalog/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as TypesCatalog;
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

// ── LLM-агентные прогоны (docs-llm/06 §1) ─────────────────────────────────────

/** Модель провайдера (`GET /api/llm/providers`, 06 §1.1); ключи в ответе не передаются. */
export interface LlmModelInfo {
  id: string;
  label: string | null;
}

export interface LlmProviderInfo {
  id: string;
  models: LlmModelInfo[];
}

/** Провайдеры + модели; без/с невалидным llm.config.json → `configured:false` (200). */
export interface LlmProvidersResponse {
  configured: boolean;
  reason?: string;
  defaultModel?: string;
  providers?: LlmProviderInfo[];
}

export async function getLlmProviders(): Promise<LlmProvidersResponse> {
  const res = await fetch('/api/llm/providers');
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as LlmProvidersResponse;
}

/** Лимиты прогона (05 §2); пустые поля UI → поле не передаётся (дефолт сервера).
 * `totalTimeoutSec` больше не поддерживается — сервер игнорирует поле (LST-8). */
export interface LlmLimits {
  maxIterations?: number;
  timeBudgetPerRun?: number;
}

/** Старт прогона: `POST …/llm-generate` → **202** `{sessionId}`.
 * Ошибки: 400 LLM_INVALID_BODY, 503 LLM_NOT_CONFIGURED, 422 LLM_UNKNOWN_MODEL,
 * 409 LLM_SESSION_ACTIVE (ApiError.code — код из JSON-ошибки). */
export async function startLlmGenerate(
  slug: string,
  body: { prompt: string; modelId: string; limits?: LlmLimits },
): Promise<{ sessionId: string }> {
  const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/llm-generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status !== 202) throw await toApiError(res);
  return (await res.json()) as { sessionId: string };
}

/** Шаг журнала в live-виде статуса (06 §1.3). */
export interface LlmLogEntry {
  n: number;
  action: string | null; // null — неверный ответ протокола
  ok: boolean;
  summary: string;
}

/** Состояние прогона (`GET …/llm-status?session=…`, 06 §1.3); опрос ~1.5 c, без SSE. */
export interface LlmStatusView {
  state: 'running' | 'done' | 'stopped' | 'error';
  log: LlmLogEntry[];
  candidates?: { file: string; comment: string }[];
  recommended?: string;
  error: string | null;
  /** Пояснение при авто-завершении по стагнации (LST-8). */
  note?: string;
  startedAt: string;
  finishedAt: string | null;
}

export async function getLlmStatus(slug: string, sessionId: string): Promise<LlmStatusView> {
  const res = await fetch(
    `/api/projects/${encodeURIComponent(slug)}/llm-status?session=${encodeURIComponent(sessionId)}`,
  );
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as LlmStatusView;
}

/** Остановка: `POST …/llm-stop` → `{state}` ('stopping' или текущее терминальное).
 * Неизвестная/нет сессии → 404 LLM_NO_SESSION. */
export async function stopLlm(slug: string): Promise<{ state: string }> {
  const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/llm-stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as { state: string };
}

/** Краткая запись списка сессий (`GET …/llm-sessions`, newest-first, 06 §1.5). */
export interface LlmSessionSummary {
  sessionId: string;
  status: 'running' | 'done' | 'stopped' | 'error';
  modelId: string;
  promptPreview: string;
  startedAt: string;
  finishedAt: string | null;
}

export async function listLlmSessions(slug: string): Promise<LlmSessionSummary[]> {
  const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/llm-sessions`);
  if (!res.ok) throw await toApiError(res);
  const body = (await res.json()) as { sessions: LlmSessionSummary[] };
  return body.sessions;
}

/** Шаг полного журнала сессии (05 §5): live-поля + аргументы действия и
 * опциональный `raw` — ДОСЛОВНЫЙ ответ модели на этот шаг (усечён до 8000 символов;
 * лёгкий опрос llm-status raw не содержит, старые журналы — тоже). */
export interface LlmJournalIteration extends LlmLogEntry {
  args: Record<string, unknown>;
  /** Дословный ответ модели на шаг (нет — в UI раскрывающийся блок не показывается). */
  raw?: string;
}

/** Полный журнал сессии (`GET …/llm-sessions/<id>`, формат 05 §5). */
export interface LlmJournalRecord {
  prompt: string;
  modelId: string;
  limits: LlmLimits;
  iterations: LlmJournalIteration[];
  candidates?: { file: string; comment: string }[];
  recommended?: string;
  status: 'running' | 'done' | 'stopped' | 'error';
  startedAt: string;
  finishedAt: string | null;
  error?: string;
  /** Пояснение при авто-завершении по стагнации (LST-8). */
  note?: string;
}

export async function loadLlmSession(slug: string, sessionId: string): Promise<LlmJournalRecord> {
  const res = await fetch(
    `/api/projects/${encodeURIComponent(slug)}/llm-sessions/${encodeURIComponent(sessionId)}`,
  );
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as LlmJournalRecord;
}
