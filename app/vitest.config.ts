// Vitest: только unit + integration; e2e-спеки Playwright (tests/e2e) исключены,
// чтобы `npm test` не подхватывал *.spec.ts (паттерн editor/vite — ТЗ 05 §1).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.{ts,tsx}', 'tests/integration/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
