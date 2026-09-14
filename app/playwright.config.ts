// Playwright e2e единого сервиса: smoke менеджера + сквозной сценарий ТЗ 05 §4.
// webServer = реальный сервер на :3212 с tmp-workspace и НАСТОЯЩИМ Python-солвером
// (SPACEMGR_PYTHON по дефолту createApp = <root>/.venv/bin/python).
import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { e2eLlmConfigPath, e2eWorkspace } from './tests/e2e/workspace';

const here = path.dirname(fileURLToPath(import.meta.url));

// Очистка tmp-workspace — в globalSetup (один раз, до webServer): конфиг импортируется
// также каждым worker'ом, и rmSync при его импорте стирал workspace после старта сервера.
export default defineConfig({
  testDir: path.join(here, 'tests', 'e2e'),
  globalSetup: path.join(here, 'tests', 'e2e', 'global-setup.ts'),
  timeout: 30_000,
  fullyParallel: false,
  workers: 1, // сквозной сценарий — последовательный и мутирует общий workspace
  use: {
    baseURL: 'http://127.0.0.1:3212',
  },
  webServer: {
    command: 'npx tsx server/index.ts',
    cwd: here,
    env: {
      ...process.env,
      PORT: '3212',
      HOST: '127.0.0.1',
      SPACEMGR_WORKSPACE: e2eWorkspace,
      // LLM-конфиг для 11-llm.spec.ts: файл пишется в beforeAll (hot-reload сервером);
      // до этого LLM-эндпоинты отвечают configured:false — на остальные спеки не влияет.
      LLM_CONFIG_PATH: e2eLlmConfigPath,
    },
    url: 'http://127.0.0.1:3212/api/health',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
