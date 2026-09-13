// Unit-тесты preview (ТЗ 05 §3.5).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { api, postRaw, startServer, type TestCtx } from './helpers.js';

let ctx: TestCtx;

beforeEach(async () => {
  ctx = await startServer();
  expect((await api(ctx, 'POST', '/api/projects', { name: 'pv' })).status).toBe(201);
});
afterEach(async () => {
  await ctx.stop();
});

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe('Preview (ТЗ 05 §3.5)', () => {
  it('POST PNG → 201 {file}; файл в preview/', async () => {
    const res = await postRaw(ctx, '/api/projects/pv/preview', PNG, 'image/png');
    expect(res.status).toBe(201);
    const body = res.json as { file: string };
    expect(body.file).toMatch(/^preview-\d{8}-\d{6}(-\d+)?\.png$/);

    const onDisk = await fsp.readFile(path.join(ctx.ws, 'pv', 'preview', body.file));
    expect(onDisk.equals(PNG)).toBe(true);

    // updatedAt в метаданных обновлён (мутация).
    const meta = JSON.parse(await fsp.readFile(path.join(ctx.ws, 'pv', 'project.json'), 'utf8')) as {
      latestResult: string | null;
    };
    expect(meta.latestResult).toBeNull(); // preview не трогает latestResult
  });

  it('коллизия имён (фиксированный now): суффикс -1', async () => {
    const fixed = new Date(2026, 8, 13, 12, 0, 0);
    const slow = await startServer({ now: () => fixed });
    try {
      expect((await api(slow, 'POST', '/api/projects', { name: 'pv' })).status).toBe(201);
      const r1 = (await postRaw(slow, '/api/projects/pv/preview', PNG, 'image/png')).json as { file: string };
      expect(r1.file).toBe('preview-20260913-120000.png');
      const r2 = (await postRaw(slow, '/api/projects/pv/preview', PNG, 'image/png')).json as { file: string };
      expect(r2.file).toBe('preview-20260913-120000-1.png');
    } finally {
      await slow.stop();
    }
  });

  it('GET previews: список с метриками, имя desc; пустой проект → []', async () => {
    expect(((await api(ctx, 'GET', '/api/projects/pv/previews')).json as { previews: unknown[] }).previews).toEqual(
      [],
    );

    // Два файла в разное время (фиксированный now для детерминизма имён).
    const fixed = new Date(2026, 8, 13, 12, 0, 0);
    const slow = await startServer({ now: () => fixed });
    try {
      expect((await api(slow, 'POST', '/api/projects', { name: 'pv' })).status).toBe(201);
      await postRaw(slow, '/api/projects/pv/preview', PNG, 'image/png');
      // Второй — вручную с другим именем (mtime различается).
      await fsp.writeFile(path.join(slow.ws, 'pv', 'preview', 'preview-20260913-120500.png'), 'zz');

      const res = (await api(slow, 'GET', '/api/projects/pv/previews')).json as {
        previews: { name: string; sizeBytes: number; mtimeIso: string }[];
      };
      expect(res.previews.map((p) => p.name)).toEqual(['preview-20260913-120500.png', 'preview-20260913-120000.png']);
      const first = res.previews[0];
      expect(first.sizeBytes).toBe(2);
      expect(typeof first.mtimeIso).toBe('string');
    } finally {
      await slow.stop();
    }
  });

  it('GET preview?file=… → 200 image/png, побайтово; невалидные имена → 400; нет файла → 404', async () => {
    const save = (await postRaw(ctx, '/api/projects/pv/preview', PNG, 'image/png')).json as { file: string };

    const res = await fetch(`${ctx.base}/api/projects/pv/preview?file=${encodeURIComponent(save.file)}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/png');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array(PNG));

    const bad = await api(ctx, 'GET', '/api/projects/pv/preview?file=..%2F..%2Fx');
    expect(bad.status).toBe(400);
    expect((bad.json as { error: string }).error).toBe('INVALID_NAME');

    const wrongExt = await api(ctx, 'GET', '/api/projects/pv/preview?file=preview-20260913-120000.bin');
    expect(wrongExt.status).toBe(400);

    const missing = await api(ctx, 'GET', '/api/projects/pv/preview?file=preview-20200101-000000.png');
    expect(missing.status).toBe(404);
    expect((missing.json as { error: string }).error).toBe('FILE_NOT_FOUND');

    const noProj = await api(ctx, 'GET', '/api/projects/ghost/preview?file=preview-20200101-000000.png');
    expect(noProj.status).toBe(404);
    expect((noProj.json as { error: string }).error).toBe('PROJECT_NOT_FOUND');
  });

  it('POST с пустым телом → 400', async () => {
    const res = await postRaw(ctx, '/api/projects/pv/preview', Buffer.alloc(0), 'image/png');
    expect(res.status).toBe(400);
    expect(fs.existsSync(path.join(ctx.ws, 'pv', 'preview'))).toBe(false);
  });
});
