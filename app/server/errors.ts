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

  // Коды LLM-эндпоинтов (ТЗ docs-llm/01 §4, 06 §1.2).
  /** 503 — llm.config.json отсутствует/невалиден (docs-llm/02 §5). */
  static llmNotConfigured(): ApiError {
    return new ApiError(
      503,
      'LLM_NOT_CONFIGURED',
      'LLM не настроен: отсутствует или невалиден llm.config.json (создайте файл по шаблону llm.config.example.json)',
    );
  }
  /** 400 — пустой/некорректный prompt; нечисловые или ≤ 0 лимиты; maxIterations > 50. */
  static llmInvalidBody(message: string): ApiError {
    return new ApiError(400, 'LLM_INVALID_BODY', message);
  }
  /** 422 — provider из modelId не в конфиге. */
  static llmUnknownModel(provider: string): ApiError {
    return new ApiError(422, 'LLM_UNKNOWN_MODEL', `Провайдер «${provider}» не найден в конфигурации LLM`);
  }
  /** 409 — у проекта уже есть сессия running (одна активная LLM-сессия на проект). */
  static llmSessionActive(): ApiError {
    return new ApiError(409, 'LLM_SESSION_ACTIVE', 'Уже идёт LLM-прогон по этому проекту');
  }
  /** 404 — неизвестный id сессии. */
  static llmNoSession(id: string): ApiError {
    return new ApiError(404, 'LLM_NO_SESSION', `Сессия LLM «${id}» не найдена`);
  }
}
