// Базовые проверки API-обвязки: health, 404 для неизвестных /api/*, форма ошибок.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { api, startServer, type TestCtx } from './helpers.js';

let ctx: TestCtx;

beforeEach(async () => {
  ctx = await startServer();
});
afterEach(async () => {
  await ctx.stop();
});

describe('Обвязка API', () => {
  it('GET /api/health → 200 {status:"ok"}', async () => {
    const res = await api(ctx, 'GET', '/api/health');
    expect(res.status).toBe(200);
    const body = res.json as { status: string; version?: string };
    expect(body.status).toBe('ok');
  });

  it('неизвестный /api/* → 404 JSON {error, message}', async () => {
    const res = await api(ctx, 'GET', '/api/nope');
    expect(res.status).toBe(404);
    expect(typeof (res.json as { error: string }).error).toBe('string');
    expect(typeof (res.json as { message: string }).message).toBe('string');
  });

  it('сломанный JSON-тело → 400 INVALID_NAME', async () => {
    const res = await fetch(`${ctx.base}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{slomannyy json',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('INVALID_NAME');
  });

  it('oversized JSON-тело (>10мб) → 413 PAYLOAD_TOO_LARGE', async () => {
    const big = `{"files": {"spec.yaml": "${'x'.repeat(11 * 1024 * 1024)}"}}`;
    const res = await fetch(`${ctx.base}/api/projects/p1/files`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: big,
    });
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('PAYLOAD_TOO_LARGE');
  });
});
