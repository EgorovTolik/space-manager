// Общий путь tmp-workspace для e2e единого сервиса (ТЗ docs-unified/05 §4).
// ВАЖНО: путь должен быть ОДНИМ и тем же в процессе-загрузчике конфига (webServer)
// и в процессах test-workers — поэтому имя фиксированное, БЕЗ process.pid.
import os from 'node:os';
import path from 'node:path';

export const e2eWorkspace = path.join(os.tmpdir(), 'spaec-app-e2e-workspace');
