// Integration ST-1: общий (глобальный) каталог типов — seed/GET/авто-регистрация.
// Temp-workspace с фейковыми проектами (НЕ реальные проекты workspace):
// p1 — тип A, p2 — A+B → seed даёт {A,B}; повторный GET — без перечитывания файлов;
// PUT files с новым типом C → C в каталоге; конфликт symbol у A — без перезаписи;
// import zip с типом E → E в каталоге. Файл-каталог не ломает listProjects.
import fsp from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { api, makeZip, postRaw, startServer, type TestCtx } from '../unit/helpers.js';

let ctx: TestCtx;

beforeEach(async () => {
  ctx = await startServer();
});
afterEach(async () => {
  await ctx.stop();
});

/** Фейковый проект НАПРЯМУЮ на диске (без API, чтобы seed сработал «чисто»). */
async function fakeProject(slug: string, specText?: string): Promise<void> {
  const dir = path.join(ctx.ws, slug);
  await fsp.mkdir(dir, { recursive: true });
  if (specText !== undefined) await fsp.writeFile(path.join(dir, 'spec.yaml'), specText, 'utf8');
  await fsp.writeFile(
    path.join(dir, 'project.json'),
    JSON.stringify({ id: `id-${slug}`, name: slug, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', latestResult: null }),
    'utf8',
  );
}

const SPEC_A = 'types:\n  A: { symbol: "A", name: Тип А }\n';
const SPEC_AB = 'types:\n  A: { symbol: "A", name: Тип А }\n  B: { symbol: "B", name: Тип Б }\n';

describe('Общий каталог типов (ST-1)', () => {
  it('GET /api/types-catalog: seed по проектам {A,B}; повторный GET — без перечитывания файлов; listProjects не ломается', async () => {
    await fakeProject('p1', SPEC_A);
    await fakeProject('p2', SPEC_AB);

    // Первый запрос — файла нет → seed по всем проектам workspace.
    const r1 = await api(ctx, 'GET', '/api/types-catalog');
    expect(r1.status).toBe(200);
    expect(r1.json).toEqual({
      types: { A: { symbol: 'A', name: 'Тип А' }, B: { symbol: 'B', name: 'Тип Б' } },
    });
    const catalogFile = path.join(ctx.ws, 'types-catalog.json');
    await expect(fsp.access(catalogFile)).resolves.toBeUndefined();

    // Теперь меняем spec.yaml проектов (новый тип Z в p2, битый YAML в p1):
    // повторный GET читает ТОЛЬКО файл каталога — перечитывания не происходит.
    await fsp.writeFile(path.join(ctx.ws, 'p2/spec.yaml'), SPEC_AB + '  Z: { symbol: "Z", name: Новый }\n', 'utf8');
    await fsp.writeFile(path.join(ctx.ws, 'p1/spec.yaml'), '{{битый yaml\n', 'utf8');

    const r2 = await api(ctx, 'GET', '/api/types-catalog');
    expect(r2.status).toBe(200);
    expect(r2.json).toEqual({
      types: { A: { symbol: 'A', name: 'Тип А' }, B: { symbol: 'B', name: 'Тип Б' } },
    });

    // Файл-каталог в корне workspace — НЕ проект для listProjects.
    const list = await api(ctx, 'GET', '/api/projects');
    expect(list.status).toBe(200);
    const slugs = (list.json as { projects: Array<{ slug: string }> }).projects.map((p) => p.slug).sort();
    expect(slugs).toEqual(['p1', 'p2']);
  });

  it('PUT files с новым типом C → C в каталоге; конфликт symbol у A — первое определение без перезаписи', async () => {
    await fakeProject('p1', SPEC_A);
    await fakeProject('p2', SPEC_AB);
    const r0 = await api(ctx, 'GET', '/api/types-catalog'); // seed {A,B}
    expect(r0.status).toBe(200);

    // Сохранение спеки с НОВЫМ типом C (A идентичен) → C регистрируется.
    const specC = SPEC_A + '  C: { symbol: "C", name: Тип С }\n';
    const put1 = await api(ctx, 'PUT', '/api/projects/p1/files', { files: { 'spec.yaml': specC } });
    expect(put1.status).toBe(200);
    let catalog = (await api(ctx, 'GET', '/api/types-catalog')).json as { types: Record<string, { symbol: string; name: string | null }> };
    expect(catalog.types.C).toEqual({ symbol: 'C', name: 'Тип С' });
    expect(Object.keys(catalog.types).sort()).toEqual(['A', 'B', 'C']);

    // Конфликт: A с ДРУГИМ symbol → ПЕРВОЕ зарегистрированное определение сохраняется.
    const catalogFile = path.join(ctx.ws, 'types-catalog.json');
    const before = await fsp.readFile(catalogFile, 'utf8');
    const specConflict = SPEC_A.replace('symbol: "A"', 'symbol: "Q"').replace('Тип А', 'Вредитель');
    const put2 = await api(ctx, 'PUT', '/api/projects/p1/files', { files: { 'spec.yaml': specConflict } });
    expect(put2.status).toBe(200); // сохранение прошло (best-effort)
    const after = await fsp.readFile(catalogFile, 'utf8');
    expect(after).toBe(before); // запись не изменилась — updatedAt тоже нет
    const r3 = await api(ctx, 'GET', '/api/types-catalog');
    catalog = r3.json as { types: Record<string, { symbol: string; name: string | null }> };
    expect(catalog.types.A).toEqual({ symbol: 'A', name: 'Тип А' });
  });

  it('PATCH /api/types-catalog/:id — успешный PATCH меняет файл и GET; занятое symbol → 422 с владельцем', async () => {
    await fakeProject('p1', SPEC_A);
    await fakeProject('p2', SPEC_AB);
    const r0 = await api(ctx, 'GET', '/api/types-catalog'); // seed {A,B}
    expect(r0.status).toBe(200);

    // Несуществующий id → 404.
    const miss = await api(ctx, 'PATCH', '/api/types-catalog/NOPE', { symbol: 'K' });
    expect(miss.status).toBe(404);
    expect((miss.json as { error: string }).error).toBe('TYPE_NOT_FOUND');

    // Пустое тело → 400.
    const empty = await api(ctx, 'PATCH', '/api/types-catalog/A', {});
    expect(empty.status).toBe(400);

    // Занятое symbol: B берёт символ «A» (занят id A) → 422 с id владельца в сообщении.
    const dup = await api(ctx, 'PATCH', '/api/types-catalog/B', { symbol: 'A' });
    expect(dup.status).toBe(422);
    const dupMsg = (dup.json as { message: string }).message;
    expect(dupMsg).toContain('Символ «A»');
    expect(dupMsg).toContain('типом «A»'); // владелец — id A

    // Успешный PATCH: меняем symbol и имя у B; файл каталога обновлён, GET — новое значение.
    const catalogFile = path.join(ctx.ws, 'types-catalog.json');
    const before = await fsp.readFile(catalogFile, 'utf8');
    const ok = await api(ctx, 'PATCH', '/api/types-catalog/B', { symbol: '9', name: null });
    expect(ok.status).toBe(200);
    expect(ok.json).toEqual({
      types: {
        A: { symbol: 'A', name: 'Тип А' },
        B: { symbol: '9', name: null },
      },
    });
    const after = await fsp.readFile(catalogFile, 'utf8');
    expect(after).not.toBe(before); // файл на диске изменён
    const onDisk = JSON.parse(after) as { types: Record<string, { symbol: string; name: string | null }>; updatedAt: string };
    expect(onDisk.types.B).toEqual({ symbol: '9', name: null });
    expect(onDisk.updatedAt).not.toBe((JSON.parse(before) as { updatedAt: string }).updatedAt);

    const get = await api(ctx, 'GET', '/api/types-catalog');
    expect((get.json as { types: Record<string, unknown> }).types.B).toEqual({ symbol: '9', name: null });
  });

  it('DELETE /api/types-catalog/:id → исчез из каталога (200 с полным каталогом); повторно → 404; spec.yaml проектов НЕ изменился', async () => {
    await fakeProject('p1', SPEC_A);
    const r0 = await api(ctx, 'GET', '/api/types-catalog'); // seed {A}
    expect(r0.status).toBe(200);
    const specBefore = await fsp.readFile(path.join(ctx.ws, 'p1/spec.yaml'), 'utf8');

    // DELETE: 200 с полным каталогом (формат как у GET), A исчез.
    const del = await api(ctx, 'DELETE', '/api/types-catalog/A');
    expect(del.status).toBe(200);
    expect(del.json).toEqual({ types: {} });
    const get1 = await api(ctx, 'GET', '/api/types-catalog');
    expect(get1.json).toEqual({ types: {} });

    // Повторный DELETE → 404.
    const del2 = await api(ctx, 'DELETE', '/api/types-catalog/A');
    expect(del2.status).toBe(404);
    expect((del2.json as { error: string }).error).toBe('TYPE_NOT_FOUND');

    // Проект с типом A при этом НЕ изменился: spec.yaml побайтово тот же.
    const specAfter = await fsp.readFile(path.join(ctx.ws, 'p1/spec.yaml'), 'utf8');
    expect(specAfter).toBe(specBefore);
  });

  it('импорт zip со spec.yaml → типы импорта регистрируются в каталоге (best-effort)', async () => {
    await fakeProject('p1', SPEC_A);
    const r0 = await api(ctx, 'GET', '/api/types-catalog'); // seed {A}
    expect(r0.status).toBe(200);

    const zip = makeZip({
      'imported/spec.yaml': 'types:\n  E: { symbol: "E", name: Тип Е }\n',
      'imported/blocked.txt': '....\n',
      'imported/preset.txt': '....\n',
    });
    const res = await postRaw(ctx, '/api/projects/import?name=im', zip, 'application/zip');
    expect(res.status).toBe(201);

    const r1 = await api(ctx, 'GET', '/api/types-catalog');
    const types = (r1.json as { types: Record<string, unknown> }).types;
    expect(types.E).toEqual({ symbol: 'E', name: 'Тип Е' });
    expect(types.A).toEqual({ symbol: 'A', name: 'Тип А' });

    // Импорт — нормальный ответ (файлы импортированы), каталог не мешает.
    expect((res.json as { imported: string[] }).imported).toContain('spec.yaml');
  });
});
