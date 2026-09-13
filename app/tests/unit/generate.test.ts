// Unit-тесты генерации со stub-python (ТЗ 05 §3.3).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { api, startServer, type TestCtx } from './helpers.js';

let ctx: TestCtx;

beforeEach(async () => {
  // Короткий timeout для speed; отдельно — тест таймаута.
  ctx = await startServer({ timeoutMs: 60_000 });
  expect((await api(ctx, 'POST', '/api/projects', { name: 'gen' })).status).toBe(201);
});
afterEach(async () => {
  await ctx.stop();
});

const dir = (): string => path.join(ctx.ws, 'gen');

describe('Генерация (stub-python, ТЗ 05 §3.3)', () => {
  it('exit 0 → 200 {resultFile, exitCode:0, feasible:true, report}; файл на диске; latestResult; аргументы spawn', async () => {
    await ctx.setStub({ exit: 0 });
    const res = await api(ctx, 'POST', '/api/projects/gen/generate', {});
    expect(res.status).toBe(200);
    const body = res.json as {
      resultFile: string;
      exitCode: number;
      feasible: boolean;
      report: string;
    };
    expect(body.exitCode).toBe(0);
    expect(body.feasible).toBe(true);
    expect(body.resultFile).toMatch(/^result-\d{8}-\d{6}(-\d+)?\.txt$/);
    expect(body.report).toContain('== КАРТА ==');
    expect(body.report).toContain('== ТАБЛИЦА: запрошено / фактически / отклонение ==');

    // Файл создан в каталоге проекта; report в ответе = содержимому файла.
    const onDisk = await fsp.readFile(path.join(dir(), body.resultFile), 'utf8');
    expect(onDisk).toBe(body.report);

    // latestResult обновлён.
    const meta = JSON.parse(await fsp.readFile(path.join(dir(), 'project.json'), 'utf8')) as {
      latestResult: string;
    };
    expect(meta.latestResult).toBe(body.resultFile);

    // Аргументы spawn точно по ТЗ 02 §6.10.
    const args = ctx.readStubArgs();
    expect(args).toEqual([
      '-m',
      'space_manager',
      'place',
      path.join(dir(), 'spec.yaml'),
      '--out',
      path.join(dir(), body.resultFile),
    ]);
  });

  it('exit 1 (infeasible) → 200 feasible:false, report с «НЕ УДАЛОСЬ…»; latestResult обновлён', async () => {
    await ctx.setStub({ exit: 1 });
    const res = await api(ctx, 'POST', '/api/projects/gen/generate', {});
    expect(res.status).toBe(200);
    const body = res.json as { exitCode: number; feasible: boolean; report: string };
    expect(body.exitCode).toBe(1);
    expect(body.feasible).toBe(false);
    expect(body.report).toContain('НЕ УДАЛОСЬ РАЗМЕСТИТЬ ВСЕ КЛАСТЕРЫ.');

    const meta = JSON.parse(await fsp.readFile(path.join(dir(), 'project.json'), 'utf8')) as {
      latestResult: string | null;
    };
    expect(typeof meta.latestResult).toBe('string');
  });

  it('exit 2 → 422 SOLVER_INPUT, message = stderr; файла результата НЕТ; latestResult не изменился', async () => {
    await ctx.setStub({ exit: 2 });
    const res = await api(ctx, 'POST', '/api/projects/gen/generate', {});
    expect(res.status).toBe(422);
    expect((res.json as { error: string }).error).toBe('SOLVER_INPUT');
    expect((res.json as { message: string }).message).toContain(
      'ОШИБКА ВХОДНЫХ ДАННЫХ: тестовая ошибка входных данных',
    );

    const results = fs.readdirSync(dir()).filter((n) => n.startsWith('result-'));
    expect(results).toEqual([]);
    const meta = JSON.parse(await fsp.readFile(path.join(dir(), 'project.json'), 'utf8')) as {
      latestResult: string | null;
    };
    expect(meta.latestResult).toBeNull();
  });

  it('коллизия имён (два запуска «в ту же секунду» — фиксированный now): второй файл с суффиксом -1', async () => {
    const fixed = new Date(2026, 8, 13, 12, 0, 0);
    const slow = await startServer({ now: () => fixed });
    try {
      expect((await api(slow, 'POST', '/api/projects', { name: 'gen' })).status).toBe(201);
      await slow.setStub({ exit: 0 });
      const r1 = (await api(slow, 'POST', '/api/projects/gen/generate', {})).json as { resultFile: string };
      expect(r1.resultFile).toBe('result-20260913-120000.txt');

      const r2 = (await api(slow, 'POST', '/api/projects/gen/generate', {})).json as { resultFile: string };
      expect(r2.resultFile).toBe('result-20260913-120000-1.txt');

      const files = fs.readdirSync(path.join(slow.ws, 'gen'));
      expect(files).toContain('result-20260913-120000.txt');
      expect(files).toContain('result-20260913-120000-1.txt');
    } finally {
      await slow.stop();
    }
  });

  it('параллельные генерации одного проекта сериализуются (одна активная)', async () => {
    await ctx.setStub({ exit: 0, sleep: 0.3 });
    const [r1, r2] = await Promise.all([
      api(ctx, 'POST', '/api/projects/gen/generate', {}),
      api(ctx, 'POST', '/api/projects/gen/generate', {}),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const b1 = r1.json as { resultFile: string };
    const b2 = r2.json as { resultFile: string };
    // Два разных файла (запуск в разные секунды или коллизия -1) — очередь отработала.
    expect(b1.resultFile).not.toBe(b2.resultFile);
  });

  it('seed: не задан → флага --seed в argv НЕТ (поведение как до ST-3)', async () => {
    await ctx.setStub({ exit: 0 });
    // Пустое тело и явно seed: undefined — оба = флаг не передаётся.
    const r1 = await api(ctx, 'POST', '/api/projects/gen/generate', {});
    expect(r1.status).toBe(200);
    let args = ctx.readStubArgs();
    expect(args).toEqual([
      '-m',
      'space_manager',
      'place',
      path.join(dir(), 'spec.yaml'),
      '--out',
      path.join(dir(), (r1.json as { resultFile: string }).resultFile),
    ]);

    const r2 = await api(ctx, 'POST', '/api/projects/gen/generate', { seed: undefined });
    expect(r2.status).toBe(200);
    args = ctx.readStubArgs();
    expect(args).not.toContain('--seed');
  });

  it('seed=42 → `--seed 42` в argv солвера (строкой); seed=0 → `--seed 0`', async () => {
    await ctx.setStub({ exit: 0 });
    const r1 = await api(ctx, 'POST', '/api/projects/gen/generate', { seed: 42 });
    expect(r1.status).toBe(200);
    expect(ctx.readStubArgs()).toEqual([
      '-m',
      'space_manager',
      'place',
      path.join(dir(), 'spec.yaml'),
      '--out',
      path.join(dir(), (r1.json as { resultFile: string }).resultFile),
      '--seed',
      '42',
    ]);

    // 0 — корректное значение (явно задаётся, флаг передаётся).
    const r2 = await api(ctx, 'POST', '/api/projects/gen/generate', { seed: 0 });
    expect(r2.status).toBe(200);
    expect(ctx.readStubArgs()).toEqual(expect.arrayContaining(['--seed', '0']));
  });

  it('некорректный seed (отрицательное / дробное / не число) → 422 UNPROCESSABLE; солвер не запускается', async () => {
    for (const seed of [-1, 1.5, 'abc']) {
      await ctx.setStub({ exit: 0 });
      const res = await api(ctx, 'POST', '/api/projects/gen/generate', { seed });
      expect(res.status).toBe(422);
      expect((res.json as { error: string }).error).toBe('UNPROCESSABLE');
      expect((res.json as { message: string }).message).toContain('seed');
    }
    // Валидация до spawn: файл результата не создан, аргументы stub не менялись.
    const results = fs.readdirSync(dir()).filter((n) => n.startsWith('result-'));
    expect(results).toEqual([]);
  });

  it('нет python-бинаря → 500 SOLVER_FAILED', async () => {
    const noPy = await startServer({ pythonBin: '/nonexistent/python' });
    try {
      expect((await api(noPy, 'POST', '/api/projects', { name: 'g' })).status).toBe(201);
      const res = await api(noPy, 'POST', '/api/projects/g/generate', {});
      expect(res.status).toBe(500);
      expect((res.json as { error: string }).error).toBe('SOLVER_FAILED');
    } finally {
      await noPy.stop();
    }
  });
});

describe('Таймаут генерации (отдельный сервер с коротким лимитом)', () => {
  it('stub sleep > timeout → 504; частичный файл удалён; результат не создан', async () => {
    const fast = await startServer({ timeoutMs: 1200 });
    try {
      expect((await api(fast, 'POST', '/api/projects', { name: 'gen' })).status).toBe(201);
      await fast.setStub({ exit: 0, sleep: 3, writefirst: true });
      const t0 = Date.now();
      const res = await api(fast, 'POST', '/api/projects/gen/generate', {});
      const elapsedMs = Date.now() - t0;
      expect(res.status).toBe(504);
      expect((res.json as { error: string }).error).toBe('SOLVER_TIMEOUT');
      // Остановились около лимита, а не после полного сна.
      expect(elapsedMs).toBeLessThan(2500);

      const files = fs.readdirSync(path.join(fast.ws, 'gen'));
      expect(files.filter((n) => n.startsWith('result-'))).toEqual([]);

      const meta = JSON.parse(
        await fsp.readFile(path.join(fast.ws, 'gen', 'project.json'), 'utf8'),
      ) as { latestResult: string | null };
      expect(meta.latestResult).toBeNull();
    } finally {
      await fast.stop();
    }
  });
});
