// Vitest-конфиг: unit (tests/unit) + интеграция (tests/integration).
// E2E-сценарии Playwright (tests/e2e/*.spec.ts) НЕ попадают в vitest — только в `playwright test`.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'tests/unit/**/*.test.{ts,tsx}',
      'tests/integration/**/*.test.{ts,tsx}',
    ],
    exclude: ['tests/e2e/**', 'node_modules/**'],
    testTimeout: 60_000,
  },
});
