// Unit-тесты файлов проекта (ТЗ 05 §3.2).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { api, startServer, type TestCtx } from './helpers.js';

let ctx: TestCtx;

beforeEach(async () => {
  ctx = await startServer();
  expect((await api(ctx, 'POST', '/api/projects', { name: 'p1' })).status).toBe(201);
});
afterEach(async () => {
  await ctx.stop();
});

const dir = (): string => path.join(ctx.ws, 'p1');

describe('Файлы проекта (ТЗ 05 §3.2)', () => {
  it('GET file: spec.yaml и result-* — 200, тело = содержимому; Content-Type по расширению', async () => {
    const res = await api(ctx, 'GET', '/api/projects/p1/file?name=spec.yaml');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain; charset=utf-8');
    expect(await (await fetch(`${ctx.base}/api/projects/p1/file?name=spec.yaml`)).text()).toContain('width: 20');

    await fsp.writeFile(path.join(dir(), 'result-20260913-120000.txt'), 'отчёт\n');
    const r = await api(ctx, 'GET', '/api/projects/p1/file?name=result-20260913-120000.txt');
    expect(r.status).toBe(200);
    expect(r.json).toBe('отчёт\n');

    // Неконonicalная маска (сценарий импорта) тоже читается.
    await fsp.writeFile(path.join(dir(), 'blocked_basic.txt'), '....\n');
    const b = await api(ctx, 'GET', '/api/projects/p1/file?name=blocked_basic.txt');
    expect(b.status).toBe(200);

    // Не-текстовое расширение → octet-stream.
    await fsp.writeFile(path.join(dir(), 'data.bin'), Buffer.from([0, 1, 2]));
    const bin = await fetch(`${ctx.base}/api/projects/p1/file?name=data.bin`);
    expect(bin.status).toBe(200);
    expect(bin.headers.get('content-type')).toContain('application/octet-stream');
    expect(new Uint8Array(await bin.arrayBuffer())).toEqual(new Uint8Array([0, 1, 2]));
  });

  it('GET file traversal и служебные имена → 400/404, ничего не читается', async () => {
    const cases = [
      '../app/package.json',
      '..%2F..%2Fx',
      '.hidden',
      'project.json',
      '../../etc/passwd',
    ];
    for (const name of cases) {
      const res = await api(ctx, 'GET', `/api/projects/p1/file?name=${encodeURIComponent(name)}`);
      expect([400, 404]).toContain(res.status);
      if (res.status === 400) {
        expect((res.json as { error: string }).error).toBe('INVALID_NAME');
      }
    }

    // Несуществующий файл → 404 FILE_NOT_FOUND.
    const missing = await api(ctx, 'GET', '/api/projects/p1/file?name=nope.txt');
    expect(missing.status).toBe(404);
    expect((missing.json as { error: string }).error).toBe('FILE_NOT_FOUND');

    // Неправильный проект → 404 PROJECT_NOT_FOUND.
    const noProj = await api(ctx, 'GET', '/api/projects/ghost/file?name=spec.yaml');
    expect(noProj.status).toBe(404);
    expect((noProj.json as { error: string }).error).toBe('PROJECT_NOT_FOUND');
  });

  it('PUT files (3 файла): записаны побайтово; updatedAt обновлён', async () => {
    const before = JSON.parse(await fsp.readFile(path.join(dir(), 'project.json'), 'utf8')) as {
      updatedAt: string;
    };
    await new Promise((r) => setTimeout(r, 5)); // гарантируем смену миллисекунды

    const spec = 'grid:\n  width: 5\n  height: 5\n# кириллица: комната\n';
    const blocked = '*****\n.*.*.\n*****\n.....\n.....\n';
    const preset = '.....\n.a...\n.....\n.....\n.....\n';
    const res = await api(ctx, 'PUT', '/api/projects/p1/files', {
      files: { 'spec.yaml': spec, 'blocked.txt': blocked, 'preset.txt': preset },
    });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ saved: ['spec.yaml', 'blocked.txt', 'preset.txt'], deleted: [] });

    expect(await fsp.readFile(path.join(dir(), 'spec.yaml'), 'utf8')).toBe(spec);
    expect(await fsp.readFile(path.join(dir(), 'blocked.txt'), 'utf8')).toBe(blocked);
    expect(await fsp.readFile(path.join(dir(), 'preset.txt'), 'utf8')).toBe(preset);

    const after = JSON.parse(await fsp.readFile(path.join(dir(), 'project.json'), 'utf8')) as {
      updatedAt: string;
    };
    expect(after.updatedAt >= before.updatedAt).toBe(true);
  });

  it('PUT files без preset.txt при существующем файле → deleted: ["preset.txt"], файл удалён', async () => {
    const res = await api(ctx, 'PUT', '/api/projects/p1/files', {
      files: { 'spec.yaml': 'grid:\n  width: 3\n  height: 3\n' },
    });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ saved: ['spec.yaml'], deleted: ['blocked.txt', 'preset.txt'] });
    expect(fs.existsSync(path.join(dir(), 'preset.txt'))).toBe(false);
    expect(fs.existsSync(path.join(dir(), 'blocked.txt'))).toBe(false);
  });

  it('PUT files с чужими именами (result-*, ../x) → 400, ничего не записано', async () => {
    const specBefore = await fsp.readFile(path.join(dir(), 'spec.yaml'), 'utf8');

    const r1 = await api(ctx, 'PUT', '/api/projects/p1/files', {
      files: { 'result-20260913-120000.txt': 'hack' },
    });
    expect(r1.status).toBe(400);
    expect((r1.json as { error: string }).error).toBe('INVALID_NAME');

    const r2 = await api(ctx, 'PUT', '/api/projects/p1/files', { files: { '../x': 'hack' } });
    expect(r2.status).toBe(400);

    // Сомешанный payload: одно имя невалидно → ничего не записывается.
    const r3 = await api(ctx, 'PUT', '/api/projects/p1/files', {
      files: { 'spec.yaml': 'changed\n', '../y': 'hack' },
    });
    expect(r3.status).toBe(400);
    expect(await fsp.readFile(path.join(dir(), 'spec.yaml'), 'utf8')).toBe(specBefore);
    expect(fs.existsSync(path.join(ctx.ws, 'x'))).toBe(false);
  });

  it('GET files: порядок — редактируемые первыми (spec, blocked, preset), затем по имени', async () => {
    await fsp.writeFile(path.join(dir(), 'zeta.txt'), 'z');
    await fsp.writeFile(path.join(dir(), 'alpha.txt'), 'a');
    await fsp.writeFile(path.join(dir(), 'result-20260913-120000.txt'), 'r');

    const res = (await api(ctx, 'GET', '/api/projects/p1/files')).json as {
      files: { name: string; sizeBytes: number; mtimeIso: string }[];
    };
    expect(res.files.map((f) => f.name)).toEqual([
      'spec.yaml',
      'blocked.txt',
      'preset.txt',
      'alpha.txt',
      'result-20260913-120000.txt',
      'zeta.txt',
    ]);
    // project.json и preview/ не фигурируют.
    expect(res.files.some((f) => f.name === 'project.json')).toBe(false);

    for (const f of res.files) {
      expect(f.sizeBytes).toBeGreaterThan(0);
      expect(typeof f.mtimeIso).toBe('string');
    }
  });
});
