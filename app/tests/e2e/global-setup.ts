// Global setup e2e (выполняется ОДИН раз в процессе CLI — до webServer и воркеров).
// ВАЖНО: очистка tmp-workspace здесь, а НЕ в playwright.config.ts — конфиг
// импортируется также каждым test-worker'ом, и side-effect при импорте стирал бы
// workspace уже после старта сервера (ENOENT на mkdir проекта).
import fs from 'node:fs';

import { e2eWorkspace } from './workspace';

export default async function globalSetup(): Promise<void> {
  fs.rmSync(e2eWorkspace, { recursive: true, force: true });
}
