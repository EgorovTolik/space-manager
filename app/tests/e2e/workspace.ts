// Общий путь tmp-workspace для e2e единого сервиса (ТЗ docs-unified/05 §4).
// ВАЖНО: путь должен быть ОДНИМ и тем же в процессе-загрузчике конфига (webServer)
// и в процессах test-workers — поэтому имя фиксированное, БЕЗ process.pid.
import os from 'node:os';
import path from 'node:path';

export const e2eWorkspace = path.join(os.tmpdir(), 'space-app-e2e-workspace');

/**
 * Фиксированный путь конфига LLM для e2e (docs-llm 07 §4.3): webServer получает его
 * через env LLM_CONFIG_PATH, а спека 11-llm пишет туда конфиг на фейковый провайдер
 * (эфемерный порт) в beforeAll — hot-reload конфига сервером позволяет не перезапускать.
 */
export const e2eLlmConfigPath = path.join(os.tmpdir(), 'space-app-e2e-llm-config.json');
