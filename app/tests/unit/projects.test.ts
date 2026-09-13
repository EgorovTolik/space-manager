// Unit-тесты CRUD проектов (ТЗ 05 §3.1) + метрики списка + corrupted-проект.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { api, EXPECTED_MASK, EXPECTED_SPEC, startServer, type TestCtx } from './helpers.js';
import {
  generateProjectSlug,
  slugFromName,
  SPEC_TEMPLATE,
  MASK_TEMPLATE,
} from '../../server/workspace.js';

let ctx: TestCtx;

beforeEach(async () => {
  ctx = await startServer();
});
afterEach(async () => {
  await ctx.stop();
});

describe('CRUD проектов (ТЗ 05 §3.1)', () => {
  it('create → структура на диске: 4 файла, шаблон побайтово по ТЗ 02 §4', async () => {
    const res = await api(ctx, 'POST', '/api/projects', { name: 'demo' });
    expect(res.status).toBe(201);
    const project = (res.json as {
      project: { id: string; name: string; slug: string; createdAt: string; updatedAt: string; latestResult: null };
    }).project;
    expect(project.name).toBe('demo'); // display-name
    expect(project.slug).toBe('demo'); // slug из имени (латиница)
    expect(project.latestResult).toBeNull();
    expect(project.id.length).toBe(36); // UUID v4
    expect(typeof project.createdAt).toBe('string');
    expect(project.createdAt).toBe(project.updatedAt);

    const dir = path.join(ctx.ws, 'demo'); // каталог = slug
    // spec.yaml побайтово = эталон ТЗ 02 §4.1 (hardcoded — не константа модуля)
    expect(await fsp.readFile(path.join(dir, 'spec.yaml'), 'utf8')).toBe(EXPECTED_SPEC);
    // маски — 20×20 точек с завершающим \n (ТЗ 02 §4.2)
    expect(await fsp.readFile(path.join(dir, 'blocked.txt'), 'utf8')).toBe(EXPECTED_MASK);
    expect(await fsp.readFile(path.join(dir, 'preset.txt'), 'utf8')).toBe(EXPECTED_MASK);
    // эталоны модуля совпадают с зафиксированными в ТЗ (защита от дрейфа)
    expect(SPEC_TEMPLATE).toBe(EXPECTED_SPEC);
    expect(MASK_TEMPLATE).toBe(EXPECTED_MASK);

    // project.json валиден, latestResult: null
    const meta = JSON.parse(await fsp.readFile(path.join(dir, 'project.json'), 'utf8')) as Record<string, unknown>;
    expect(meta.name).toBe('demo');
    expect(meta.latestResult).toBeNull();
    expect(meta.id).toBe(project.id);
  });

  it('create с нарушенным регламентом имени → 400 INVALID_NAME, каталог не создан', async () => {
    // Замечание 2: кириллица/пробелы/регистр — валидные display-name; красные — только
    // пустое, >64, «/», \0 и non-string.
    for (const bad of ['', 'x'.repeat(65), 'a/b', '/x', 'a\u0000b']) {
      const res = await api(ctx, 'POST', '/api/projects', { name: bad });
      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toBe('INVALID_NAME');
    }
    // тело без поля name / non-string
    for (const body of [{}, { name: 42 }, { name: null }]) {
      const res = await api(ctx, 'POST', '/api/projects', body);
      expect(res.status).toBe(400);
    }
    expect(fs.readdirSync(ctx.ws)).toEqual([]);
  });

  it('list: порядок updatedAt desc (при равенстве — name asc), метрики верны', async () => {
    for (const n of ['aaa', 'bbb', 'ccc']) {
      expect((await api(ctx, 'POST', '/api/projects', { name: n })).status).toBe(201);
    }
    // Детерминированные времена: aaa — самое свежее.
    const setMeta = async (name: string, updatedAt: string) => {
      const p = path.join(ctx.ws, name, 'project.json');
      const meta = JSON.parse(await fsp.readFile(p, 'utf8')) as Record<string, unknown>;
      meta.updatedAt = updatedAt;
      await fsp.writeFile(p, JSON.stringify(meta));
    };
    await setMeta('aaa', '2026-09-13T12:00:03.000Z');
    await setMeta('bbb', '2026-09-13T12:00:02.000Z');
    await setMeta('ccc', '2026-09-13T12:00:01.000Z');

    const res = await api(ctx, 'GET', '/api/projects');
    expect(res.status).toBe(200);
    const projects = (res.json as { projects: Record<string, unknown>[] }).projects;
    expect(projects.map((p) => p.name)).toEqual(['aaa', 'bbb', 'ccc']);

    // Метрики свежего проекта: 3 файла + project.json в sizeBytes.
    const aaa = projects[0];
    const specSize = fs.statSync(path.join(ctx.ws, 'aaa', 'spec.yaml')).size;
    const maskSize = fs.statSync(path.join(ctx.ws, 'aaa', 'blocked.txt')).size;
    const metaSize = fs.statSync(path.join(ctx.ws, 'aaa', 'project.json')).size;
    expect(aaa.filesCount).toBe(3);
    expect(aaa.resultsCount).toBe(0);
    expect(aaa.previewsCount).toBe(0);
    expect(aaa.sizeBytes).toBe(specSize + 2 * maskSize + metaSize);

    // Ревизии и превью учитываются.
    await fsp.writeFile(path.join(ctx.ws, 'aaa', 'result-20260913-120000.txt'), 'report');
    await fsp.mkdir(path.join(ctx.ws, 'aaa', 'preview'));
    await fsp.writeFile(path.join(ctx.ws, 'aaa', 'preview', 'preview-20260913-120001.png'), 'png-bytes');
    const res2 = (await api(ctx, 'GET', '/api/projects')).json as { projects: Record<string, unknown>[] };
    const aaa2 = res2.projects.find((p) => p.name === 'aaa') as Record<string, unknown>;
    expect(aaa2.resultsCount).toBe(1);
    expect(aaa2.previewsCount).toBe(1);
    expect(aaa2.sizeBytes).toBe(specSize + 2 * maskSize + metaSize + 'report'.length + 'png-bytes'.length);
  });

  it('list пустого workspace → {"projects": []}', async () => {
    const res = await api(ctx, 'GET', '/api/projects');
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ projects: [] });
  });

  it('rename (замечание 2): меняется ТОЛЬКО display-name; каталог и slug не изменяются', async () => {
    expect((await api(ctx, 'POST', '/api/projects', { name: 'old' })).status).toBe(201);
    const before = JSON.parse(await fsp.readFile(path.join(ctx.ws, 'old', 'project.json'), 'utf8')) as {
      id: string;
    };

    const res = await api(ctx, 'PATCH', '/api/projects/old/rename', { name: 'Новое Имя' });
    expect(res.status).toBe(200);
    const project = (res.json as { project: { name: string; slug: string; id: string } }).project;
    expect(project.name).toBe('Новое Имя');
    expect(project.slug).toBe('old'); // slug стабилен — ссылки сохраняются
    expect(project.id).toBe(before.id);

    // Каталог НЕ переименован; project.json: новое имя, старый slug.
    expect(fs.existsSync(path.join(ctx.ws, 'old'))).toBe(true);
    const statNew = await fsp.stat(path.join(ctx.ws, 'Новое Имя')).catch(() => null);
    expect(statNew).toBeNull();
    const after = JSON.parse(await fsp.readFile(path.join(ctx.ws, 'old', 'project.json'), 'utf8')) as {
      name: string;
      slug: string;
      id: string;
      updatedAt: string;
    };
    expect(after.name).toBe('Новое Имя');
    expect(after.slug).toBe('old');
    expect(after.id).toBe(before.id);
    expect(typeof after.updatedAt).toBe('string');
  });

  it('rename до дублирующегося display-name → разрешено (уникален slug, а не имя)', async () => {
    await api(ctx, 'POST', '/api/projects', { name: 'Демо' }); // demo
    await api(ctx, 'POST', '/api/projects', { name: 'Demo' }); // demo-2
    const res = await api(ctx, 'PATCH', '/api/projects/demo-2/rename', { name: 'Демо' });
    expect(res.status).toBe(200);
    expect((res.json as { project: { name: string } }).project.name).toBe('Демо');
  });

  it('rename с нарушенным регламентом имени → 422 UNPROCESSABLE (замечание 2)', async () => {
    await api(ctx, 'POST', '/api/projects', { name: 'a' });
    for (const bad of ['a/b', '/x', '', 'x'.repeat(65), 'a\u0000b']) {
      const res = await api(ctx, 'PATCH', '/api/projects/a/rename', { name: bad });
      expect(res.status).toBe(422);
      expect((res.json as { error: string }).error).toBe('UNPROCESSABLE');
    }
  });

  it('delete: каталог удалён полностью (включая preview/); повторный delete → 404', async () => {
    expect((await api(ctx, 'POST', '/api/projects', { name: 'gone' })).status).toBe(201);
    await fsp.mkdir(path.join(ctx.ws, 'gone', 'preview'));
    await fsp.writeFile(path.join(ctx.ws, 'gone', 'preview', 'preview-20260913-120000.png'), 'x');

    const res = await api(ctx, 'DELETE', '/api/projects/gone');
    expect(res.status).toBe(204);
    expect(fs.existsSync(path.join(ctx.ws, 'gone'))).toBe(false);

    const again = await api(ctx, 'DELETE', '/api/projects/gone');
    expect(again.status).toBe(404);
    expect((again.json as { error: string }).error).toBe('PROJECT_NOT_FOUND');
  });

  it('corrupted project.json: флаг в списке; мутации → 500 PROJECT_CORRUPTED; DELETE доступен', async () => {
    expect((await api(ctx, 'POST', '/api/projects', { name: 'broken' })).status).toBe(201);
    await fsp.writeFile(path.join(ctx.ws, 'broken', 'project.json'), 'это не JSON');

    const list = (await api(ctx, 'GET', '/api/projects')).json as {
      projects: Record<string, unknown>[];
    };
    const entry = list.projects.find((p) => p.name === 'broken');
    expect(entry).toBeDefined();
    expect(entry?.corrupted).toBe(true);

    const rename = await api(ctx, 'PATCH', '/api/projects/broken/rename', { name: 'x' });
    expect(rename.status).toBe(500);
    expect((rename.json as { error: string }).error).toBe('PROJECT_CORRUPTED');

    const gen = await api(ctx, 'POST', '/api/projects/broken/generate', {});
    expect(gen.status).toBe(500);
    expect((gen.json as { error: string }).error).toBe('PROJECT_CORRUPTED');

    // Чтение файлов при этом доступно.
    const files = await api(ctx, 'GET', '/api/projects/broken/files');
    expect(files.status).toBe(200);

    const del = await api(ctx, 'DELETE', '/api/projects/broken');
    expect(del.status).toBe(204);
  });

  it('NFR (ТЗ 05 §7): list < 50 мс при ≤100 проектах и ≤200 ревизиях', async () => {
    // 30 проектов через API + 200 ревизий в одном из них.
    for (let i = 0; i < 30; i += 1) {
      await api(ctx, 'POST', '/api/projects', { name: `perf-${String(i).padStart(2, '0')}` });
    }
    const revDir = path.join(ctx.ws, 'perf-00');
    for (let i = 0; i < 200; i += 1) {
      const ts = `202609${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String(120000 + i).slice(-6)}`;
      await fsp.writeFile(path.join(revDir, `result-${ts}.txt`), 'r');
    }

    // Прогрев, затем замер.
    await api(ctx, 'GET', '/api/projects');
    const t0 = performance.now();
    const res = await api(ctx, 'GET', '/api/projects');
    const elapsed = performance.now() - t0;
    expect(res.status).toBe(200);
    const projects = (res.json as { projects: unknown[] }).projects;
    expect(projects.length).toBe(30);
    expect(elapsed).toBeLessThan(50);
  });
});

// Замечание 2: генерация slug из display-name (транслитерация + уникализация).
describe('slug из имени проекта (замечание 2)', () => {
  it('slugFromName: транслит кириллицы, регистр, санитизация', () => {
    expect(slugFromName('Офис Б-2')).toBe('ofis-b-2');
    expect(slugFromName('Demo')).toBe('demo');
    expect(slugFromName('a b  c')).toBe('a-b-c');
    expect(slugFromName('Щука и Юля')).toBe('schuka-i-yulya');
    expect(slugFromName('проект №1 (основной)')).toBe('proekt-1-osnovnoy');
  });

  it('slugFromName: пусто после санитизации → null; обрезка до 40', () => {
    expect(slugFromName('…')).toBeNull();
    expect(slugFromName('a'.repeat(50))).toBe('a'.repeat(40));
  });

  it('generateProjectSlug: свободный slug без суффикса; коллизии → -2, -3', async () => {
    await fsp.mkdir(path.join(ctx.ws, 'demo'), { recursive: true });
    await fsp.mkdir(path.join(ctx.ws, 'demo-2'), { recursive: true });

    expect(await generateProjectSlug(ctx.ws, 'Демо')).toEqual({ slug: 'demo-3', suffix: 3 });
    expect(await generateProjectSlug(ctx.ws, 'Свободный')).toEqual({ slug: 'svobodnyy', suffix: 1 });
    // имя без латиницы → project-<uuid8>
    const fallback = await generateProjectSlug(ctx.ws, '…');
    expect(fallback.slug).toMatch(/^project-[0-9a-f]{8}$/);
    expect(fallback.suffix).toBe(1);
  });

  it('legacy project.json без поля slug: slug берётся из имени каталога', async () => {
    await api(ctx, 'POST', '/api/projects', { name: 'legacy' });
    const metaPath = path.join(ctx.ws, 'legacy', 'project.json');
    const meta = JSON.parse(await fsp.readFile(metaPath, 'utf8')) as Record<string, unknown>;
    delete meta.slug; // имитация старого формата
    await fsp.writeFile(metaPath, JSON.stringify(meta));

    const res = await api(ctx, 'GET', '/api/projects');
    const entry = (res.json as { projects: { name: string; slug: string }[] }).projects.find(
      (p) => p.slug === 'legacy',
    );
    expect(entry).toBeDefined();
    expect(entry?.slug).toBe('legacy'); // из каталога, а не из повреждённого/пустого поля
  });
});
