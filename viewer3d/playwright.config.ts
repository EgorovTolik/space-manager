// Playwright-конфиг (ТЗ 05 §4): e2e-сценарии на Chromium против prod-сборки,
// раздаваемой Express-сервером (server/index.ts). Запуск: `npm run e2e`
// (= npm run build && playwright test). Тесты добавляются в подзадаче 6.
import { defineConfig } from '@playwright/test';

const PORT = 3210; // ТЗ 05 §4: e2e-порт, отличный от prod (3200) и editor/ (3210 у редактора)

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false, // один браузер-контекст на файл — стабильнее для WebGL-сценариев
  workers: 1,
  retries: 0,
  reporter: [['list']],
  // docs-unified/04 §2.6: viewer3d живёт под /viewer3d/ (vite base) — e2e идёт
  // против реального монтирования, а не корня.
  use: {
    baseURL: `http://localhost:${PORT}/viewer3d/`,
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
