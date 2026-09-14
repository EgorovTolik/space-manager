// Единый сервис space-manager (ТЗ docs-unified/01, 02): Express :4080.
//   • статика: / → app/dist, /editor/* → ../editor/dist, /viewer3d/* → ../viewer3d/dist
//   • API /api/*: проекты CRUD, файлы, генерация, архивы, preview
//   • fs-операции в <root>/workspace/; spawn .venv/bin/python -m space_manager place …
// createApp() — чистая функция без listen (юнит-тесты, ТЗ 05 §1).
import express from 'express';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ApiError } from './errors.js';
import { createProjectQueue, runSolver } from './generate.js';
import { loadLlmConfig } from './llm/config.js';
import { fetchAllProviderModels } from './llm/models.js';
import {
  createLlmSessionController,
  runLlmSession,
  statusViewFromRecord,
} from './llm/agent.js';
import {
  DEFAULT_LLM_LIMITS,
  type LlmLimits,
} from './llm/actions.js';
import { ensureTypesCatalog, registerSpecIntoCatalog } from './typesCatalog.js';
import {
  listJournals,
  nextSessionId,
  readJournalRecord,
  SESSION_ID_RE,
  writeJournalRecord,
  type LlmJournalRecord,
} from './llm/journal.js';
import {
  archiveFileName,
  buildProjectArchive,
  createProject,
  deleteProject,
  importProjectFromZip,
  isValidProjectName,
  listProjectFiles,
  listProjects,
  nextPreviewName,
  nextResultName,
  PREVIEW_NAME_RE,
  readMeta,
  readProjectFile,
  renameProject,
  requireProjectDir,
  RESULT_NAME_RE,
  saveProjectFiles,
  systemClock,
  writeMeta,
  type Clock,
} from './workspace.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(here, '..');
const projectRoot = path.join(appDir, '..');

export interface AppOptions {
  /** Корень workspace; дефолт env SPACEMGR_WORKSPACE → <root>/workspace. */
  workspaceDir?: string;
  /** Интерпретатор Python; дефолт env SPACEMGR_PYTHON → <root>/.venv/bin/python. */
  pythonBin?: string;
  /** Hard timeout генерации, мс; дефолт 60 000 (ТЗ 02 §6.10). */
  timeoutMs?: number;
  /** Инъекция «текущего времени» для детерминированных имён файлов (ТЗ 05 §1). */
  now?: Clock;
}

export const DEFAULT_GENERATE_TIMEOUT_MS = 60_000;

interface ResolvedConfig {
  workspaceDir: string;
  pythonBin: string;
  timeoutMs: number;
  now: Clock;
}

function resolveConfig(opts: AppOptions): ResolvedConfig {
  return {
    workspaceDir: opts.workspaceDir ?? process.env.SPACEMGR_WORKSPACE ?? path.join(projectRoot, 'workspace'),
    pythonBin: opts.pythonBin ?? process.env.SPACEMGR_PYTHON ?? path.join(projectRoot, '.venv', 'bin', 'python'),
    timeoutMs: opts.timeoutMs ?? DEFAULT_GENERATE_TIMEOUT_MS,
    now: opts.now ?? systemClock,
  };
}

async function ensureWorkspace(dir: string): Promise<void> {
  try {
    const st = await fsp.lstat(dir);
    if (st.isFile()) {
      throw ApiError.workspaceUnavailable(`По пути workspace лежит файл, а не каталог: ${dir}`);
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
    // ENOENT — создадим ниже
  }
  try {
    await fsp.mkdir(dir, { recursive: true });
  } catch (err) {
    throw ApiError.workspaceUnavailable(`Не удалось создать workspace ${dir}: ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Обёртка async-обработчиков и типизированный доступ к телу/запросам
// ---------------------------------------------------------------------------

type AsyncHandler = (req: express.Request, res: express.Response) => Promise<unknown>;

const asyncH =
  (fn: AsyncHandler): express.RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

function isTooLargeError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { type?: unknown }).type === 'entity.too.large'
  );
}

function isParseFailedError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { type?: unknown }).type === 'entity.parse.failed'
  );
}

// ---------------------------------------------------------------------------
// Статика с SPA-fallback (ТЗ 01 §3.3). Порядок: /api → /editor → /viewer3d → корень.
// ---------------------------------------------------------------------------

function mountSpa(
  app: express.Express,
  prefix: string | null,
  distDir: string,
  buildHint: string,
): void {
  const routes: (string | RegExp)[] = prefix ? [`/${prefix}`, `/${prefix}/*`] : ['*'];

  if (!fs.existsSync(distDir)) {
    // ТЗ 01 §4: dist отсутствует при dev → 503 с подсказкой, чтобы не маскировать ошибки.
    app.get(routes, (_req, res) => {
      res.status(503).json({ error: 'NOT_BUILT', message: buildHint });
    });
    return;
  }

  const assetsDir = path.join(distDir, 'assets');
  if (fs.existsSync(assetsDir)) {
    app.use(
      prefix ? `/${prefix}/assets` : '/assets',
      express.static(assetsDir, { maxAge: '365d', immutable: true }),
    );
  }
  app.use(
    prefix ? `/${prefix}` : '/',
    express.static(distDir, {
      setHeaders(res) {
        res.setHeader('Cache-Control', 'no-cache');
      },
    }),
  );

  // SPA-fallback: GET без расширения → index.html; с расширением и не найден → 404 JSON.
  app.get(routes, (req, res) => {
    if (path.extname(req.path)) {
      res.status(404).json({ error: 'NOT_FOUND', message: `Не найдено: ${req.originalUrl}` });
      return;
    }
    const indexPath = path.join(distDir, 'index.html');
    if (!fs.existsSync(indexPath)) {
      res.status(503).json({ error: 'NOT_BUILT', message: buildHint });
      return;
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexPath);
  });
}

// ---------------------------------------------------------------------------
// createApp — сборка приложения (без listen)
// ---------------------------------------------------------------------------

export interface ActiveLlmSession {
  /** id сессии (пусто до записи стартового журнала — резервация против гонок). */
  id: string;
  record: LlmJournalRecord | null;
  controller: ReturnType<typeof createLlmSessionController>;
}

export async function createApp(opts: AppOptions = {}): Promise<express.Express> {
  const cfg = resolveConfig(opts);
  await ensureWorkspace(cfg.workspaceDir);
  const queue = createProjectQueue();
  // Одна активная LLM-сессия на проект (05 §6); запись в карту — синхронно
  // сразу после проверки, без await между проверкой и установкой (нет гонки).
  const llmActive = new Map<string, ActiveLlmSession>();
  const pkg = JSON.parse(
    fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'),
  ) as { version: string };

  const app = express();
  app.disable('x-powered-by');

  // --- API (ПЕРВЫМИ, до статики; ТЗ 01 §3.3) --------------------------------
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', version: pkg.version });
  });

  const json = express.json({ limit: '10mb' });
  const raw = express.raw({ limit: '10mb', type: '*/*' });

  // Ленивое восстановление workspace: каталог мог быть удалён извне после createApp
  // (например, e2e-очистка между стартом сервера и первыми запросами) — без этого все
  // проектные эндпоинты падали бы ENOENT до рестарта. lstat раз на запрос — дёшево.
  app.use('/api', async (_req, res, next) => {
    try {
      await ensureWorkspace(cfg.workspaceDir);
      next();
    } catch (err) {
      next(err);
    }
  });

  // ST-1: общий (глобальный) каталог типов <workspace>/types-catalog.json.
  // Файла нет → seed по всем проектам workspace (spec.yaml, lenient), файл пишется;
  // есть → читаем его (проекты не перечитываем).
  app.get(
    '/api/types-catalog',
    asyncH(async (_req, res) => {
      const catalog = await ensureTypesCatalog(cfg.workspaceDir, cfg.now);
      res.json({ types: catalog.types });
    }),
  );

  // 6.2 список проектов (+ filesCount — решение ТЗ 05 §8)
  app.get(
    '/api/projects',
    asyncH(async (_req, res) => {
      const entries = await listProjects(cfg.workspaceDir);
      res.json({
        projects: entries.map((e) =>
          e.meta
            ? {
                ...e.meta, // id, name (display), slug, createdAt, updatedAt, latestResult
                sizeBytes: e.sizeBytes,
                resultsCount: e.resultsCount,
                previewsCount: e.previewsCount,
                filesCount: e.filesCount,
              }
            : {
                id: null,
                name: e.slug, // display-name неизвестен — показываем имя каталога
                slug: e.slug,
                createdAt: null,
                updatedAt: null,
                latestResult: null,
                corrupted: true,
                sizeBytes: e.sizeBytes,
                resultsCount: e.resultsCount,
                previewsCount: e.previewsCount,
                filesCount: e.filesCount,
              },
        ),
      });
    }),
  );

  // 6.3 создание проекта (замечание 2): тело { name } — человекочитаемое имя;
  // slug генерируется сервером транслитерацией и возвращается в ответе.
  app.post(
    '/api/projects',
    json,
    asyncH(async (req, res) => {
      const rawName: unknown = (req.body as { name?: unknown } | undefined)?.name;
      if (!isValidProjectName(rawName)) {
        throw ApiError.invalidName(
          `Имя «${String(rawName)}» не проходит регламент имён проекта (1–64 символа, без «/» и \\0)`,
        );
      }
      const meta = await createProject(cfg.workspaceDir, rawName as string, cfg.now);
      res.status(201).json({ project: meta });
    }),
  );

  // 6.4 переименование (замечание 2): меняет только display-name в project.json;
  // каталог/slug не изменяются. Нарушение регламента имени → 422 UNPROCESSABLE.
  app.patch(
    '/api/projects/:p/rename',
    json,
    asyncH(async (req, res) => {
      const rawName: unknown = (req.body as { name?: unknown } | undefined)?.name;
      if (!isValidProjectName(rawName)) {
        throw ApiError.unprocessable(
          `Имя «${String(rawName)}» не проходит регламент имён проекта (1–64 символа, без «/» и \\0)`,
        );
      }
      const meta = await renameProject(cfg.workspaceDir, req.params.p, rawName as string, cfg.now);
      res.json({ project: meta });
    }),
  );

  // 6.5 удаление (единственное доступное действие для corrupted-проектов)
  app.delete(
    '/api/projects/:p',
    asyncH(async (req, res) => {
      await deleteProject(cfg.workspaceDir, req.params.p);
      res.status(204).end();
    }),
  );

  // 6.6 импорт из zip
  app.post(
    '/api/projects/import',
    raw,
    asyncH(async (req, res) => {
      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        throw ApiError.badZip('Пустое тело запроса: ожидается zip-архив');
      }
      const qName = req.query.name;
      const requestedName = typeof qName === 'string' && qName.length > 0 ? qName : undefined;
      const outcome = await importProjectFromZip(cfg.workspaceDir, body, requestedName, cfg.now);

      // ST-1: авто-регистрация типов импортированного spec.yaml в глобальном
      // каталоге. Best-effort: сбой каталога НЕ ломает импорт — ответ как раньше.
      try {
        const specText = await fsp.readFile(path.join(cfg.workspaceDir, outcome.meta.slug, 'spec.yaml'), 'utf8');
        await registerSpecIntoCatalog(cfg.workspaceDir, specText, cfg.now);
      } catch (err) {
        console.error('[space-unified] сбой авто-регистрации типов импорта в каталог:', err);
      }

      res.status(201).json({
        project: outcome.meta,
        imported: outcome.imported,
        skipped: outcome.skipped,
      });
    }),
  );

  // 6.7 список файлов проекта
  app.get(
    '/api/projects/:p/files',
    asyncH(async (req, res) => {
      const dir = await requireProjectDir(cfg.workspaceDir, req.params.p);
      res.json({ files: await listProjectFiles(dir) });
    }),
  );

  // 6.8 чтение файла
  app.get(
    '/api/projects/:p/file',
    asyncH(async (req, res) => {
      const dir = await requireProjectDir(cfg.workspaceDir, req.params.p);
      const qName = req.query.name;
      if (typeof qName !== 'string' || qName.length === 0) {
        throw ApiError.invalidName('Не указан параметр name');
      }
      const content = await readProjectFile(dir, qName);
      const isText = qName.endsWith('.txt') || qName.endsWith('.yaml');
      res.setHeader('Content-Type', isText ? 'text/plain; charset=utf-8' : 'application/octet-stream');
      res.send(content);
    }),
  );

  // 6.9 сохранение файлов редактором (полное состояние канонической тройки)
  app.put(
    '/api/projects/:p/files',
    json,
    asyncH(async (req, res) => {
      const dir = await requireProjectDir(cfg.workspaceDir, req.params.p);
      const body = req.body as { files?: unknown } | undefined;
      if (
        typeof body !== 'object' ||
        body === null ||
        typeof body.files !== 'object' ||
        body.files === null ||
        Array.isArray(body.files)
      ) {
        throw ApiError.invalidName('Тело запроса должно быть объектом { "files": { имя: текст } }');
      }
      const files = body.files as Record<string, unknown>;
      const outcome = await saveProjectFiles(
        dir,
        Object.fromEntries(Object.entries(files).map(([k, v]) => [k, String(v)])),
      );
      const meta = await readMeta(dir); // corrupted → PROJECT_CORRUPTED (мутация)
      await writeMeta(dir, { ...meta, updatedAt: cfg.now().toISOString() });

      // ST-1: авто-регистрация типов нового spec.yaml в глобальном каталоге.
      // Best-effort: сбой каталога НЕ ломает сохранение — ответ как раньше.
      const specText = typeof files['spec.yaml'] === 'string' ? (files['spec.yaml'] as string) : null;
      if (specText !== null) {
        try {
          await registerSpecIntoCatalog(cfg.workspaceDir, specText, cfg.now);
        } catch (err) {
          console.error('[space-unified] сбой авто-регистрации типов в каталог:', err);
        }
      }

      res.json({ saved: outcome.saved, deleted: outcome.deleted });
    }),
  );

  // 6.10 генерация размещения (синхронная; infeasible — результат, а не ошибка)
  app.post(
    '/api/projects/:p/generate',
    json,
    asyncH(async (req, res) => {
      const slug = req.params.p;
      const dir = await requireProjectDir(cfg.workspaceDir, slug);

      // Опциональный seed (integer ≥ 0): не задан → флаг не передаётся (детерминированный
      // DEFAULT_SEED солвера); некорректное значение — 422 UNPROCESSABLE (паттерн PATCH rename).
      const body = req.body as { seed?: unknown } | undefined;
      let seedArgs: string[] = [];
      if (body !== null && typeof body === 'object' && !Array.isArray(body)) {
        const { seed } = body;
        if (seed !== undefined) {
          if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0) {
            throw ApiError.unprocessable('Параметр seed должен быть целым числом ≥ 0');
          }
          seedArgs = ['--seed', String(seed)];
        }
      }

      // readMeta до очереди: corrupted-проект нельзя генерировать (мутация latestResult).
      await readMeta(dir);

      const out = await queue.enqueue(slug, async () => {
        const specPath = path.join(dir, 'spec.yaml');
        const resultName = await nextResultName(dir, cfg.now());
        const outPath = path.join(dir, resultName);
        const run = await runSolver(
          cfg.pythonBin,
          ['-m', 'space_manager', 'place', specPath, '--out', outPath, ...seedArgs],
          { cwd: dir, timeoutMs: cfg.timeoutMs },
        );

        if (run.timedOut) {
          await fsp.rm(outPath, { force: true }).catch(() => undefined);
          throw ApiError.solverTimeout();
        }
        if (run.spawnError !== null) {
          throw new ApiError(500, 'SOLVER_FAILED', `Не удалось запустить солвер: ${run.spawnError}`);
        }
        const code = run.exitCode ?? 1;
        if (code === 2) {
          // Ошибка входных данных (docs/06 §7): файл не создаётся, latestResult не меняется.
          await fsp.rm(outPath, { force: true }).catch(() => undefined);
          const message = run.stderr.trim() || 'ОШИБКА ВХОДНЫХ ДАННЫХ: неизвестная ошибка';
          throw ApiError.solverInput(message);
        }
        // exit 0 (успех) или 1 (infeasible): отчёт читается из СОЗДАННОГО ФАЙЛА.
        let report: string;
        try {
          report = await fsp.readFile(outPath, 'utf8');
        } catch {
          throw new ApiError(500, 'SOLVER_FAILED', 'Солвер завершился, но файл отчёта не найден');
        }
        const meta = await readMeta(dir);
        await writeMeta(dir, { ...meta, latestResult: resultName, updatedAt: cfg.now().toISOString() });
        return {
          resultFile: resultName,
          exitCode: code,
          feasible: code === 0,
          report,
        };
      });

      res.json(out);
    }),
  );

  // 6.11 список ревизий (данные селектора viewer3d)
  app.get(
    '/api/projects/:p/results',
    asyncH(async (req, res) => {
      const dir = await requireProjectDir(cfg.workspaceDir, req.params.p);
      const files = (await listProjectFiles(dir)).filter((f) => RESULT_NAME_RE.test(f.name));
      files.sort((a, b) => b.name.localeCompare(a.name)); // имя desc ⇒ свежая первая
      res.json({ results: files });
    }),
  );

  // 6.12 архив проекта (zip на лету; без project.json, preview/, *.zip)
  app.get(
    '/api/projects/:p/archive',
    asyncH(async (req, res) => {
      const slug = req.params.p;
      const dir = await requireProjectDir(cfg.workspaceDir, slug);
      const now = cfg.now();
      const buffer = buildProjectArchive(dir, now);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${archiveFileName(slug, now)}"`);
      res.send(buffer);
    }),
  );

  // 6.13 preview: сохранение PNG из viewer3d
  app.post(
    '/api/projects/:p/preview',
    raw,
    asyncH(async (req, res) => {
      const dir = await requireProjectDir(cfg.workspaceDir, req.params.p);
      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        throw ApiError.invalidName('Пустое тело запроса: ожидается PNG');
      }
      const previewDir = path.join(dir, 'preview');
      await fsp.mkdir(previewDir, { recursive: true });
      const fileName = await nextPreviewName(previewDir, cfg.now());
      await fsp.writeFile(path.join(previewDir, fileName), body);
      const meta = await readMeta(dir); // corrupted → PROJECT_CORRUPTED (мутация)
      await writeMeta(dir, { ...meta, updatedAt: cfg.now().toISOString() });
      res.status(201).json({ file: fileName });
    }),
  );

  // 6.13 preview: список
  app.get(
    '/api/projects/:p/previews',
    asyncH(async (req, res) => {
      const dir = await requireProjectDir(cfg.workspaceDir, req.params.p);
      const previewDir = path.join(dir, 'preview');
      let entries: fs.Dirent[] = [];
      try {
        entries = await fsp.readdir(previewDir, { withFileTypes: true });
      } catch {
        // нет preview/ — пустой список допустим
      }
      const previews: { name: string; sizeBytes: number; mtimeIso: string }[] = [];
      for (const e of entries) {
        if (!e.isFile() || !PREVIEW_NAME_RE.test(e.name)) continue;
        const st = await fsp.stat(path.join(previewDir, e.name));
        previews.push({ name: e.name, sizeBytes: st.size, mtimeIso: st.mtime.toISOString() });
      }
      previews.sort((a, b) => b.name.localeCompare(a.name));
      res.json({ previews });
    }),
  );

  // 6.13 preview: отдача картинки
  app.get(
    '/api/projects/:p/preview',
    asyncH(async (req, res) => {
      const dir = await requireProjectDir(cfg.workspaceDir, req.params.p);
      const qFile = req.query.file;
      if (typeof qFile !== 'string' || !PREVIEW_NAME_RE.test(qFile)) {
        throw ApiError.invalidName(`Имя «${String(qFile)}» не проходит регламент предпросмотра`);
      }
      let content: Buffer;
      try {
        content = await fsp.readFile(path.join(dir, 'preview', qFile));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw ApiError.fileNotFound(qFile);
        throw err;
      }
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'no-cache'); // файл может пересоздаваться
      res.send(content);
    }),
  );

  // LLM: провайдеры + модели (ТЗ docs-llm/06 §1.1). Ключи в ответе не передаются;
  // без/с невалидным llm.config.json → { configured:false, reason } с кодом 200 (02 §5).
  app.get(
    '/api/llm/providers',
    asyncH(async (_req, res) => {
      const loaded = await loadLlmConfig();
      if (!loaded.ok) {
        res.json({ configured: false, reason: loaded.reason });
        return;
      }
      const { config } = loaded;
      // Конфиг перечитан; модели — авто-опрос {url}/v1/models с кэшем TTL (02 §4).
      const discovered = await fetchAllProviderModels(config.providers);
      res.json({
        configured: true,
        defaultModel: config.defaultModel,
        providers: Object.entries(config.providers).map(([id, p]) => ({
          id,
          models: (discovered[id]?.models ?? []).map((modelId) => ({
            id: modelId,
            label: config.labels[`${id}/${modelId}`] ?? null,
          })),
        })),
      });
    }),
  );

  // --- LLM-агентные прогоны (ТЗ docs-llm/06 §1.2–§1.5) -------------------------

  // Валидация тела llm-generate: {prompt, modelId, limits?} → дефолтные лимиты.
  function validateLlmGenerateBody(
    body: unknown,
  ): { prompt: string; modelId: string; providerId: string; limits: LlmLimits } {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw ApiError.llmInvalidBody('Тело запроса должно быть объектом { prompt, modelId, limits? }');
    }
    const obj = body as Record<string, unknown>;
    if (typeof obj.prompt !== 'string' || obj.prompt.trim().length < 1 || obj.prompt.length > 4000) {
      throw ApiError.llmInvalidBody('Поле prompt — непустая строка (1..4000 символов)');
    }
    if (typeof obj.modelId !== 'string' || !obj.modelId.includes('/')) {
      throw ApiError.llmInvalidBody('Поле modelId — строка вида "<provider>/<modelId>"');
    }
    const providerId = obj.modelId.slice(0, obj.modelId.indexOf('/'));

    let limits: LlmLimits = { ...DEFAULT_LLM_LIMITS };
    if (obj.limits !== undefined) {
      if (typeof obj.limits !== 'object' || obj.limits === null || Array.isArray(obj.limits)) {
        throw ApiError.llmInvalidBody('Поле limits — объект { maxIterations?, timeBudgetPerRun? }');
      }
      const raw = obj.limits as Record<string, unknown>;
      for (const key of Object.keys(raw)) {
        // totalTimeoutSec — legacy-поле старого UI: молча игнорируем (LST-7),
        // жёсткого временного лимита сессии больше нет.
        if (key === 'totalTimeoutSec') continue;
        if (!Object.prototype.hasOwnProperty.call(DEFAULT_LLM_LIMITS, key)) {
          throw ApiError.llmInvalidBody(`Неизвестный лимит «${key}»`);
        }
      }
      if (raw.maxIterations !== undefined) {
        if (typeof raw.maxIterations !== 'number' || !Number.isInteger(raw.maxIterations) || raw.maxIterations < 1 || raw.maxIterations > 50) {
          throw ApiError.llmInvalidBody('Лимит maxIterations — целое число от 1 до 50');
        }
        limits.maxIterations = raw.maxIterations;
      }
      if (raw.timeBudgetPerRun !== undefined) {
        if (typeof raw.timeBudgetPerRun !== 'number' || !Number.isFinite(raw.timeBudgetPerRun) || raw.timeBudgetPerRun <= 0) {
          throw ApiError.llmInvalidBody('Лимит timeBudgetPerRun — число > 0 (секунды)');
        }
        limits.timeBudgetPerRun = raw.timeBudgetPerRun;
      }
    }
    return { prompt: obj.prompt.trim(), modelId: obj.modelId, providerId, limits };
  }

  // 1.2 старт прогона: 202 {sessionId}; сессия выполняется асинхронно в очереди проекта.
  app.post(
    '/api/projects/:p/llm-generate',
    json,
    asyncH(async (req, res) => {
      const slug = req.params.p;
      const { prompt, modelId, providerId, limits } = validateLlmGenerateBody(req.body);
      const dir = await requireProjectDir(cfg.workspaceDir, slug);

      const loaded = await loadLlmConfig();
      if (!loaded.ok) throw ApiError.llmNotConfigured();
      const provider = loaded.config.providers[providerId];
      if (provider === undefined) throw ApiError.llmUnknownModel(providerId);

      // readMeta до старта: corrupted-проект нельзя использовать (мутация latestResult).
      await readMeta(dir);

      if (llmActive.has(slug)) throw ApiError.llmSessionActive();
      const controller = createLlmSessionController();
      const entry: ActiveLlmSession = { id: '', record: null, controller };
      llmActive.set(slug, entry); // резервация СИНХРОННО — вторая попытка получит 409

      const sessionId = await nextSessionId(dir, cfg.now);
      const initialRecord: LlmJournalRecord = {
        prompt,
        modelId,
        limits,
        iterations: [],
        status: 'running',
        startedAt: cfg.now().toISOString(),
        finishedAt: null,
      };
      await writeJournalRecord(dir, sessionId, initialRecord);
      entry.record = initialRecord;
      entry.id = sessionId;

      res.status(202).json({ sessionId });

      // Сессия — в очереди проекта (06 §1); ответ уже отправлен.
      void queue.enqueue(slug, async () => {
        try {
          await runLlmSession({
            projectDir: dir,
            sessionId,
            initialRecord,
            prompt,
            modelId,
            provider,
            limits,
            pythonBin: cfg.pythonBin,
            now: cfg.now,
            validateTimeoutMs: cfg.timeoutMs,
            controller,
          });
        } catch {
          // runLlmSession сам фиксирует сбой в журнале; страховка от unhandled rejection.
        } finally {
          const cur = llmActive.get(slug);
          if (cur !== undefined && cur.id === sessionId) llmActive.delete(slug);
        }
      });
    }),
  );

  // 1.3 статус прогона: живое состояние сессии или файл журнала (опрос ~1.5 c).
  app.get(
    '/api/projects/:p/llm-status',
    asyncH(async (req, res) => {
      const dir = await requireProjectDir(cfg.workspaceDir, req.params.p);
      const qSession = req.query.session;
      if (typeof qSession !== 'string' || qSession.length === 0) {
        throw ApiError.llmInvalidBody('Не указан параметр session');
      }
      const live = llmActive.get(req.params.p);
      let record = live !== undefined && live.id === qSession ? live.record : null;
      if (record === null) record = await readJournalRecord(dir, qSession);
      if (record === null) throw ApiError.llmNoSession(qSession);
      res.json(statusViewFromRecord(record));
    }),
  );

  // 1.4 остановка: флаг + SIGKILL child-процесса текущего запуска (05 §4).
  app.post(
    '/api/projects/:p/llm-stop',
    asyncH(async (req, res) => {
      const dir = await requireProjectDir(cfg.workspaceDir, req.params.p);
      const live = llmActive.get(req.params.p);
      if (live !== undefined && live.id !== '' && live.record !== null) {
        // Терминальная запись ещё не убрана из реестра (окно после финализации).
        if (live.record.status !== 'running') {
          res.json({ state: live.record.status });
          return;
        }
        live.controller.stop();
        res.json({ state: 'stopping' });
        return;
      }
      // Активной сессии нет: терминальная последняя → её состояние, иначе 404.
      const sessions = await listJournals(dir);
      const last = sessions[0];
      if (last !== undefined && last.record.status !== 'running') {
        res.json({ state: last.record.status });
        return;
      }
      throw ApiError.llmNoSession('активная сессия отсутствует');
    }),
  );

  // 1.5 список журналов прогонов (newest-first).
  app.get(
    '/api/projects/:p/llm-sessions',
    asyncH(async (req, res) => {
      const dir = await requireProjectDir(cfg.workspaceDir, req.params.p);
      const sessions = await listJournals(dir);
      res.json({
        sessions: sessions.map(({ sessionId, record }) => ({
          sessionId,
          status: record.status,
          modelId: record.modelId,
          promptPreview: record.prompt.slice(0, 120),
          startedAt: record.startedAt,
          finishedAt: record.finishedAt,
        })),
      });
    }),
  );

  // 1.5 полный журнал сессии.
  app.get(
    '/api/projects/:p/llm-sessions/:id',
    asyncH(async (req, res) => {
      const dir = await requireProjectDir(cfg.workspaceDir, req.params.p);
      if (!SESSION_ID_RE.test(req.params.id)) throw ApiError.llmNoSession(req.params.id);
      const record = await readJournalRecord(dir, req.params.id);
      if (record === null) throw ApiError.llmNoSession(req.params.id);
      res.json(record);
    }),
  );

  // Прочие пути /api/* → 404 JSON (паттерн editor/viewer3d).
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'NOT_FOUND', message: `Не найдено: API-эндпоинт отсутствует` });
  });

  // --- Статика (ТЗ 01 §3.3): /editor → editor/dist, /viewer3d → viewer3d/dist, корень → app/dist
  mountSpa(
    app,
    'editor',
    path.join(projectRoot, 'editor', 'dist'),
    'Сборка редактора не найдена: сначала выполните `npm run build` в editor/',
  );
  mountSpa(
    app,
    'viewer3d',
    path.join(projectRoot, 'viewer3d', 'dist'),
    'Сборка 3D-визуализатора не найдена: сначала выполните `npm run build` в viewer3d/',
  );
  mountSpa(
    app,
    null,
    path.join(appDir, 'dist'),
    'Сборка менеджера проектов не найдена: сначала выполните `npm run build` в app/',
  );

  // --- Обёртка ошибок (ТЗ 02 §5): всегда { error: CODE, message: RU }
  app.use(
    (err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (res.headersSent) {
        next(err);
        return;
      }
      if (err instanceof ApiError) {
        res.status(err.status).json({ error: err.code, message: err.message });
        return;
      }
      if (isTooLargeError(err)) {
        const e = ApiError.payloadTooLarge();
        res.status(e.status).json({ error: e.code, message: e.message });
        return;
      }
      if (isParseFailedError(err)) {
        res
          .status(400)
          .json({ error: 'INVALID_NAME', message: 'Тело запроса не является корректным JSON' });
        return;
      }
      console.error('[space-unified] непредвиденная ошибка:', err);
      res.status(500).json({ error: 'INTERNAL', message: 'Внутренняя ошибка сервера' });
    },
  );

  return app;
}

// ---------------------------------------------------------------------------
// Точка входа (npm start)
// ---------------------------------------------------------------------------

const isDirectRun = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const port = Number(process.env.PORT ?? 4080);
  // ТЗ 01 §7: локальный одноместный сервис — слушаем 127.0.0.1 явно (env HOST).
  const host = process.env.HOST ?? '127.0.0.1';
  createApp()
    .then((app) => {
      app.listen(port, host, () => {
        console.log(`[space-unified] Express: http://${host}:${port} (workspace: ${resolveConfig({}).workspaceDir})`);
      });
    })
    .catch((err: Error) => {
      console.error('[space-unified] отказ в старте:', err.message);
      process.exit(1);
    });
}
