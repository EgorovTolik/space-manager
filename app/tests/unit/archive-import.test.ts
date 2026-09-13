// Unit-тесты архива и импорта (ТЗ 05 §3.4).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  api,
  EXPECTED_MASK,
  makeRawZip,
  makeZip,
  postRaw,
  startServer,
  type TestCtx,
} from './helpers.js';

let ctx: TestCtx;

beforeEach(async () => {
  ctx = await startServer();
});
afterEach(async () => {
  await ctx.stop();
});

async function createProject(name = 'demo'): Promise<void> {
  const res = await api(ctx, 'POST', '/api/projects', { name });
  expect(res.status).toBe(201);
}

describe('Архив проекта (GET /archive)', () => {
  it('свежий проект: ровно spec.yaml + blocked.txt + preset.txt; без project.json/preview/', async () => {
    await createProject();
    const res = await fetch(`${ctx.base}/api/projects/demo/archive`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/zip');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="demo-\d{8}-\d{6}\.zip"$/);

    const zip = new AdmZip(Buffer.from(await res.arrayBuffer()));
    const names = zip.getEntries().filter((e) => !e.isDirectory).map((e) => e.entryName).sort();
    expect(names).toEqual(['blocked.txt', 'preset.txt', 'spec.yaml']);
  });

  it('проект с ревизиями/превью: result-* включены, preview/ и *.zip исключены', async () => {
    await createProject();
    const dir = path.join(ctx.ws, 'demo');
    await fsp.writeFile(path.join(dir, 'result-20260913-120000.txt'), 'r1');
    await fsp.writeFile(path.join(dir, 'result-20260913-120001.txt'), 'r2');
    await fsp.mkdir(path.join(dir, 'preview'));
    await fsp.writeFile(path.join(dir, 'preview', 'preview-20260913-120002.png'), 'png');
    await fsp.writeFile(path.join(dir, 'draft.zip'), 'zip-bytes');

    const res = await fetch(`${ctx.base}/api/projects/demo/archive`);
    const zip = new AdmZip(Buffer.from(await res.arrayBuffer()));
    const names = zip.getEntries().filter((e) => !e.isDirectory).map((e) => e.entryName).sort();
    expect(names).toEqual([
      'blocked.txt',
      'preset.txt',
      'result-20260913-120000.txt',
      'result-20260913-120001.txt',
      'spec.yaml',
    ]);
  });

  it('несуществующий проект → 404 PROJECT_NOT_FOUND', async () => {
    const res = await api(ctx, 'GET', '/api/projects/ghost/archive');
    expect(res.status).toBe(404);
    expect((res.json as { error: string }).error).toBe('PROJECT_NOT_FOUND');
  });

  it('имя файла детерминировано при фиксированном now', async () => {
    const fixed = new Date(2026, 8, 13, 12, 0, 0);
    const slow = await startServer({ now: () => fixed });
    try {
      expect((await api(slow, 'POST', '/api/projects', { name: 'demo' })).status).toBe(201);
      const res = await fetch(`${slow.base}/api/projects/demo/archive`);
      expect(res.headers.get('content-disposition')).toBe(
        'attachment; filename="demo-20260913-120000.zip"',
      );
    } finally {
      await slow.stop();
    }
  });
});

describe('Импорт из zip (POST /import)', () => {
  it('плоский архив без ?name → имя «imported» (или imported-2 при коллизии)', async () => {
    const zip = makeZip({ 'spec.yaml': 'grid:\n  width: 4\n  height: 4\n', 'blocked.txt': '....\n' });

    const r1 = await postRaw(ctx, '/api/projects/import', zip, 'application/zip');
    expect(r1.status).toBe(201);
    const body1 = r1.json as { project: { name: string }; imported: string[]; skipped: unknown[] };
    expect(body1.project.name).toBe('imported');
    expect([...body1.imported].sort()).toEqual(['blocked.txt', 'spec.yaml']);
    expect(body1.skipped).toEqual([]);

    // Содержимое записано побайтово.
    const dir = path.join(ctx.ws, 'imported');
    expect(await fsp.readFile(path.join(dir, 'spec.yaml'), 'utf8')).toBe('grid:\n  width: 4\n  height: 4\n');
    // preset.txt досоздан из шаблона (его не было в архиве).
    expect(fs.existsSync(path.join(dir, 'preset.txt'))).toBe(true);

    const r2 = await postRaw(ctx, '/api/projects/import', zip, 'application/zip');
    expect(r2.status).toBe(201);
    expect((r2.json as { project: { name: string } }).project.name).toBe('imported-2');
  });

  it('импорт только spec.yaml → blocked/preset достроены из шаблона (ТЗ 05 §3.4)', async () => {
    const zip = makeZip({ 'spec.yaml': 'grid:\n  width: 2\n  height: 2\n' });
    const res = await postRaw(ctx, '/api/projects/import?name=solo', zip, 'application/zip');
    expect(res.status).toBe(201);
    const body = res.json as { imported: string[] };
    expect(body.imported).toEqual(['spec.yaml']); // только то, что было в архиве

    const dir = path.join(ctx.ws, 'solo');
    expect(await fsp.readFile(path.join(dir, 'spec.yaml'), 'utf8')).toBe('grid:\n  width: 2\n  height: 2\n');
    expect(await fsp.readFile(path.join(dir, 'blocked.txt'), 'utf8')).toBe(EXPECTED_MASK);
    expect(await fsp.readFile(path.join(dir, 'preset.txt'), 'utf8')).toBe(EXPECTED_MASK);
  });

  it('корневая папка снимается: «demo/spec.yaml» → проект demo; коллизия → demo-2', async () => {
    const zip = makeZip({ 'demo/spec.yaml': 's', 'demo/blocked.txt': 'b' });
    const r1 = await postRaw(ctx, '/api/projects/import', zip, 'application/zip');
    expect(r1.status).toBe(201);
    const b1 = r1.json as { project: { name: string }; imported: string[] };
    expect(b1.project.name).toBe('demo');
    expect(b1.imported).toEqual(['blocked.txt', 'spec.yaml']);

    const r2 = await postRaw(ctx, '/api/projects/import', zip, 'application/zip');
    expect(r2.status).toBe(201);
    expect((r2.json as { project: { name: string } }).project.name).toBe('demo-2');
  });

  it('явный ?name=foo → foo; коллизия по явному имени → 409 PROJECT_EXISTS', async () => {
    const zip = makeZip({ 'spec.yaml': 's' });
    const r1 = await postRaw(ctx, '/api/projects/import?name=foo', zip, 'application/zip');
    expect(r1.status).toBe(201);
    expect((r1.json as { project: { name: string } }).project.name).toBe('foo');

    const r2 = await postRaw(ctx, '/api/projects/import?name=foo', zip, 'application/zip');
    expect(r2.status).toBe(409);
    expect((r2.json as { error: string }).error).toBe('PROJECT_EXISTS');
  });

  it('нет spec.yaml → 400 BAD_ZIP; пустое тело и мусор → 400', async () => {
    const noSpec = makeZip({ 'blocked.txt': 'b' });
    const r1 = await postRaw(ctx, '/api/projects/import', noSpec, 'application/zip');
    expect(r1.status).toBe(400);
    expect((r1.json as { error: string }).error).toBe('BAD_ZIP');

    const empty = await postRaw(ctx, '/api/projects/import', Buffer.alloc(0), 'application/zip');
    expect(empty.status).toBe(400);

    const junk = await postRaw(ctx, '/api/projects/import', Buffer.from('это не zip'), 'application/octet-stream');
    expect(junk.status).toBe(400);
    expect((junk.json as { error: string }).error).toBe('BAD_ZIP');

    // Ничего не создано.
    expect(fs.readdirSync(ctx.ws)).toEqual([]);
  });

  it('вредоносная запись ../../evil.txt → 400 BAD_ZIP, на диске ничего вне workspace', async () => {
    const evil = makeRawZip([
      { name: 'spec.yaml', data: 's' },
      { name: '../../evil.txt', data: 'pwned' },
    ]);
    const res = await postRaw(ctx, '/api/projects/import', evil, 'application/zip');
    expect(res.status).toBe(400);
    expect((res.json as { error: string }).error).toBe('BAD_ZIP');
    expect(fs.existsSync(path.join(ctx.tmp, 'evil.txt'))).toBe(false);
    expect(fs.readdirSync(ctx.ws)).toEqual([]);

    // Даже одиночная вредоносная запись (без spec.yaml) — тоже 400.
    const evilOnly = makeRawZip([{ name: '../../evil.txt', data: 'pwned' }]);
    const res2 = await postRaw(ctx, '/api/projects/import', evilOnly, 'application/zip');
    expect(res2.status).toBe(400);
  });

  it('project.json / preview/* / *.zip из архива не импортируются (skipped с причинами)', async () => {
    const zip = makeZip({
      'spec.yaml': 's',
      'blocked.txt': 'b',
      'project.json': '{"name":"hacked"}',
      'preview/old.png': Buffer.from([0x89, 0x50]),
      'nested.zip': Buffer.from('zip'),
    });
    const res = await postRaw(ctx, '/api/projects/import?name=clean', zip, 'application/zip');
    expect(res.status).toBe(201);
    const body = res.json as {
      project: { name: string };
      imported: string[];
      skipped: { name: string; reason: string }[];
    };
    expect(body.project.name).toBe('clean');
    expect([...body.imported].sort()).toEqual(['blocked.txt', 'spec.yaml']);
    expect(body.skipped.length).toBe(3);
    const byName = Object.fromEntries(body.skipped.map((s) => [s.name, s.reason]));
    expect(byName['project.json']).toBe('служебные метаданные не импортируются');
    expect(byName['preview/old.png']).toBe('превью не импортируется');
    expect(byName['nested.zip']).toBe('архивы не импортируются');

    // project.json — наш шаблонный, preview/ не создан.
    const dir = path.join(ctx.ws, 'clean');
    const meta = JSON.parse(await fsp.readFile(path.join(dir, 'project.json'), 'utf8')) as { name: string };
    expect(meta.name).toBe('clean');
    expect(fs.existsSync(path.join(dir, 'preview'))).toBe(false);
  });

  it('latestResult при импорте = максимальное имя result-*', async () => {
    const zip = makeZip({
      'spec.yaml': 's',
      'result-20260913-120000.txt': 'old',
      'result-20260913-120500.txt': 'new',
    });
    const res = await postRaw(ctx, '/api/projects/import?name=hist', zip, 'application/zip');
    expect(res.status).toBe(201);
    const meta = JSON.parse(
      await fsp.readFile(path.join(ctx.ws, 'hist', 'project.json'), 'utf8'),
    ) as { latestResult: string };
    expect(meta.latestResult).toBe('result-20260913-120500.txt');
  });

  it('плохое ?name → 400 INVALID_NAME (замечание 2: «Bad Name» теперь валиден)', async () => {
    const zip = makeZip({ 'spec.yaml': 's' });
    const res = await postRaw(ctx, '/api/projects/import?name=a/b', zip, 'application/zip');
    expect(res.status).toBe(400);
    expect((res.json as { error: string }).error).toBe('INVALID_NAME');

    // Имя с пробелом — валидное display-name; slug транслитерируется без пробелов.
    const ok = await postRaw(ctx, '/api/projects/import?name=Bad Name', zip, 'application/zip');
    expect(ok.status).toBe(201);
    const project = (ok.json as { project: { name: string; slug: string } }).project;
    expect(project.name).toBe('Bad Name');
    expect(project.slug).toBe('bad-name');
  });
});
