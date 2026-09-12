// Общие помощники для e2e-сценариев (ТЗ 06 §3).
import { expect, type Page } from '@playwright/test';

export const APP_TITLE = 'Редактор конфигураций spaec-manager';

/** Скрытые file-input'ы FilesPanel: spec (.yaml); blocked/preset — оба .txt, порядок DOM: blocked, preset. */
export function specFileInput(page: Page) {
  return page.locator('input[type=file][accept*=".yaml"]');
}
export function blockedFileInput(page: Page) {
  return page.locator('input[type=file][accept*=".txt"]').nth(0);
}
export function presetFileInput(page: Page) {
  return page.locator('input[type=file][accept*=".txt"]').nth(1);
}

/** Кнопки «⬇ Скачать» FilesPanel в DOM-порядке: [0] спека, [1] маска блокировок, [2] preset. */
export function downloadButtons(page: Page) {
  return page.getByRole('button', { name: /Скачать/ });
}

/** Главный canvas сетки (первый canvas в центральной колонке; второй — миникарта). */
export function mainCanvas(page: Page) {
  return page.locator('main canvas').first();
}

/** Центр клетки (x, y) в координатах canvas при pan=0, zoom=1 (fit): cell = min(w/W, h/H). */
export async function cellCenter(page: Page, x: number, y: number, gridW: number, gridH: number) {
  const box = await mainCanvas(page).boundingBox();
  if (!box) throw new Error('canvas не найден');
  const cell = Math.min(box.width / gridW, box.height / gridH);
  return { x: (x + 0.5) * cell, y: (y + 0.5) * cell };
}

/** Клик по клетке (кисть/ластик — pointerdown, stroke flush через rAF). */
export async function clickCell(page: Page, x: number, y: number, gridW: number, gridH: number) {
  const pos = await cellCenter(page, x, y, gridW, gridH);
  await mainCanvas(page).click({ position: pos });
}

/** Дождаться сброса stroke'а в rAF и перерисовки. */
export function afterDraw(page: Page) {
  return page.waitForTimeout(250);
}

// ── Диалоги (confirm/alert) ───────────────────────────────────────────────────

interface DialogPlan {
  /** 'accept' | 'dismiss' | null = не ожидается; при ожидании — проверка текста. */
  action: 'accept' | 'dismiss' | null;
  textContains?: string;
}

/**
 * Управляет диалогами страницы. plan.textContains — последовательно ожидаемые фрагменты
 * (shift из очереди); остальные confirm'ы обрабатываются по plan.action (по умолчанию accept).
 */
export function manageDialogs(page: Page, plan: DialogPlan = { action: 'accept' }) {
  const queue: string[] = plan.textContains ? [plan.textContains] : [];
  let seen: string[] = [];
  page.on('dialog', (d) => {
    seen.push(d.message());
    if (queue.length > 0) {
      const expected = queue.shift()!;
      expect(d.message()).toContain(expected);
      void d.accept();
      return;
    }
    if (plan.action === 'accept') void d.accept();
    else if (plan.action === 'dismiss') void d.dismiss();
  });
  return () => seen;
}

/** Строка статуса GridCanvas («x=… y=… · zoom …× · клеток всего W×H»). */
export function statusLine(page: Page) {
  return page.locator('main .panel > div:last-child span').first();
}
