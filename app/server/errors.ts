// Единый тип ошибок API (ТЗ 02 §5): { error: CODE, message: RU }.
// Все коды — из таблицы docs-unified/02-workspace-api.md §5.

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }

  static invalidName(message: string): ApiError {
    return new ApiError(400, 'INVALID_NAME', message);
  }
  static badZip(message: string): ApiError {
    return new ApiError(400, 'BAD_ZIP', message);
  }
  static projectNotFound(name: string): ApiError {
    return new ApiError(404, 'PROJECT_NOT_FOUND', `Проект «${name}» не найден в рабочем пространстве`);
  }
  static fileNotFound(name: string): ApiError {
    return new ApiError(404, 'FILE_NOT_FOUND', `Файл «${name}» не найден в проекте`);
  }
  static projectExists(name: string): ApiError {
    return new ApiError(409, 'PROJECT_EXISTS', `Проект с именем «${name}» уже существует`);
  }
  static payloadTooLarge(): ApiError {
    return new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Размер загрузки превышает лимит 10 МБ');
  }
  static solverInput(message: string): ApiError {
    return new ApiError(422, 'SOLVER_INPUT', message);
  }
  /** 422 — имя не проходит регламент display-name (замечание 2: PATCH rename). */
  static unprocessable(message: string): ApiError {
    return new ApiError(422, 'UNPROCESSABLE', message);
  }
  static workspaceUnavailable(message: string): ApiError {
    return new ApiError(500, 'WORKSPACE_UNAVAILABLE', message);
  }
  static projectCorrupted(name: string): ApiError {
    return new ApiError(500, 'PROJECT_CORRUPTED', `Метаданные проекта «${name}» повреждены (project.json не читается)`);
  }
  static solverTimeout(): ApiError {
    return new ApiError(504, 'SOLVER_TIMEOUT', 'Генерация превысила лимит времени (60 с) и была остановлена');
  }
}
