// Playwright для smoke-e2e менеджера проектов. Полный набор e2e-сценариев —
// подзадача 6 (ТЗ 05 §4): этот конфиг и tmp-workspace переиспользуются.
import { defineConfig } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Отдельный workspace на время e2e (не трогает реальный <root>/workspace).
const ws = path.join(os.tmpdir(), `spaec-app-e2e-${process.pid}`);
fs.rmSync(ws, { recursive: true, force: true });

export default defineConfig({
  testDir: path.join(here, 'tests', 'e2e'),
  timeout: 30_000,
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:3212',
  },
  webServer: {
    command: 'npx tsx server/index.ts',
    cwd: here,
    env: { ...process.env, PORT: '3212', HOST: '127.0.0.1', SPACEMGR_WORKSPACE: ws },
    url: 'http://127.0.0.1:3212/api/health',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
