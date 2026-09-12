// Playwright-конфиг (ТЗ 06 §3): e2e-сценарии на Chromium против prod-сборки,
// раздаваемой Express-сервером (server/index.ts) — как в реальной работе редактора.
// Запуск: `npm run e2e` (= npm run build && playwright test).
import { defineConfig } from '@playwright/test';

const PORT = 3210;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false, // один браузер-контекст на файл — стабильнее для canvas-сценариев
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx tsx server/index.ts',
    env: { PORT: String(PORT) },
    url: `http://localhost:${PORT}/api/health`,
    timeout: 60_000,
    reuseExistingServer: !process.env.CI,
  },
});
