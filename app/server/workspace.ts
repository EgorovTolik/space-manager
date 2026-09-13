// Модуль workspace (ТЗ 02 §1–§4, §6): fs-операции над <root>/workspace/,
// шаблон нового проекта, регламенты имён, метаданные project.json.
// Все функции — чистые относительно переданного workspaceDir (юнит-тесты с tmp).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';

import { ApiError } from './errors.js';

// ---------------------------------------------------------------------------
// Регламенты имён (ТЗ 02 §3)
// ---------------------------------------------------------------------------

export const SLUG_RE = /^[a-z0-9_-]{1,40}$/;
export const RESULT_NAME_RE = /^result-\d{8}-\d{6}(-\d+)?\.txt$/;
export const PREVIEW_NAME_RE = /^preview-\d{8}-\d{6}(-\d+)?\.png$/;
// «Произвольный файл проекта» (чтение/запись из API).
const ARBITRARY_FILE_RE = /^[A-Za-z0-9._-]+$/;

export const CANONICAL_FILES = ['spec.yaml', 'blocked.txt', 'preset.txt'] as const;
export type CanonicalFile = (typeof CANONICAL_FILES)[number];

export function isValidSlug(name: string): boolean {
  return SLUG_RE.test(name);
}

// ---------------------------------------------------------------------------
// Двухуровневое имя проекта (замечание 2):
//   name — человекочитаемое (любые символы кроме «/» и \0, длина 1..64);
//   slug — стабильный машинный идентификатор каталога (регламент SLUG_RE).
// ---------------------------------------------------------------------------

export const DISPLAY_NAME_MAX = 64;

/** true, если имя проходит регламент display-name проекта (non-string → false). */
export function isValidProjectName(name: unknown): boolean {
  if (typeof name !== 'string') return false;
  if (name.length < 1 || name.length > DISPLAY_NAME_MAX) return false;
  if (name.includes('/') || name.includes('\0')) return false;
  return true;
}

/** Кириллица → латиница (остальные символы транслируются как есть). */
const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y',
  ь: '', э: 'e', ю: 'yu', я: 'ya',
};

/**
 * Чистая генерация slug из display-name: транслитерация, нижний регистр,
 * всё не-[a-z0-9_-] → «-», обрезка до 40. null — если после санитизации пусто.
 */
export function slugFromName(name: string): string | null {
  let out = name.toLowerCase();
  out = [...out].map((ch) => TRANSLIT[ch] ?? ch).join('');
  out = out.replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  if (out.length > 40) out = out.slice(0, 40).replace(/-+$/g, '');
  return isValidSlug(out) ? out : null;
}

/**
 * Уникальный slug в workspace: base из имени; при коллизии — суффиксы -2, -3…
 * (base укорачивается до 37, чтобы итог не превышал 40). Если санитизация пуста —
 * `project-<uuid8>`. Возвращает [slug, appliedSuffix] (suffix=1 → без суффикса).
 */
export async function generateProjectSlug(
  workspace: string,
  name: string,
): Promise<{ slug: string; suffix: number }> {
  let base = slugFromName(name);
  if (base === null) base = `project-${crypto.randomUUID().slice(0, 8)}`;
  if (base.length > 37) base = base.slice(0, 37).replace(/-+$/g, '');
  let candidate = base;
  let suffix = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (!(await projectExists(workspace, candidate))) return { slug: candidate, suffix };
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
}

/** Имя файла для API-чтения/записи (ТЗ 02 §3.2 «произвольный файл»). */
export function isValidFileName(name: string): boolean {
  if (!ARBITRARY_FILE_RE.test(name)) return false;
  if (name.includes('..')) return false;
  if (name.startsWith('.')) return false;
  return true;
}

/**
 * Финальная защита от path traversal (ТЗ 01 §7): resolved путь обязан
 * находиться внутри baseDir. Возвращает безопасный абсолютный путь.
 */
export function resolveSafe(baseDir: string, name: string): string {
  const root = path.resolve(baseDir);
  const full = path.resolve(root, name);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw ApiError.invalidName(`Имя «${name}» не проходит регламент имён`);
  }
  return full;
}

// ---------------------------------------------------------------------------
// Времена и имена файлов (инъекция now — паттерн cli.py::default_result_name)
// ---------------------------------------------------------------------------

export type Clock = () => Date;
export const systemClock: Clock = () => new Date();

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Локальное время, формат YYYYmmdd-HHMMSS — тот же, что у CLI и viewer3d. */
export function timestampOf(now: Date): string {
  return (
    `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}` +
    `-${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`
  );
}

/** result-<ts>.txt; при коллизии в ту же секунду — суффиксы -1, -2, … */
export async function nextResultName(dir: string, now: Date): Promise<string> {
  const base = `result-${timestampOf(now)}`;
  let candidate = `${base}.txt`;
  let suffix = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await fsp.access(path.join(dir, candidate));
    } catch {
      return candidate; // не существует — свободно
    }
    candidate = `${base}-${suffix}.txt`;
    suffix += 1;
  }
}

/** preview-<ts>.png; при коллизии — суффиксы. */
export async function nextPreviewName(dir: string, now: Date): Promise<string> {
  const base = `preview-${timestampOf(now)}`;
  let candidate = `${base}.png`;
  let suffix = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await fsp.access(path.join(dir, candidate));
    } catch {
      return candidate;
    }
    candidate = `${base}-${suffix}.png`;
    suffix += 1;
  }
}

// ---------------------------------------------------------------------------
// Шаблон нового проекта (ТЗ 02 §4) — побайтовые эталоны
// ---------------------------------------------------------------------------

export const SPEC_TEMPLATE = [
  'grid:',
  '  width: 20',
  '  height: 20',
  'blockedFile: blocked.txt',
  'presetFile: preset.txt',
  'types:',
  '  ROOM: { symbol: "R", name: Комната }',
  'rules:',
  '  connectivity: 8',
  '  adjacency:',
  '    forbidden: []',
  '    allow: null',
  '  size:',
  '    min: null',
  '    max: null',
  '  convexity:',
  '    weight: soft',
  '  fillAll: false',
  '  touchAll: false',
  'clusters:',
  '  - id: room1',
  '    type: ROOM',
  '    areaPercent: 100',
  '    shape: free',
  '',
].join('\n');

/** Маска 20×20 из точек, завершающий \n (ТЗ 02 §4.2). */
export const MASK_TEMPLATE: string = ('.'.repeat(20) + '\n').repeat(20);

// ---------------------------------------------------------------------------
// Метаданные проекта (ТЗ 02 §2)
// ---------------------------------------------------------------------------

export interface ProjectMeta {
  id: string;
  /** Человекочитаемое имя (любые символы кроме «/» и \0, 1..64). */
  name: string;
  /** Стабильный slug = имя каталога в workspace; ключ всех API-маршрутов. */
  slug: string;
  createdAt: string;
  updatedAt: string;
  latestResult: string | null;
}

export interface ProjectInfo extends ProjectMeta {
  sizeBytes: number;
  resultsCount: number;
  previewsCount: number;
  filesCount: number;
  corrupted?: boolean;
}

export async function readMeta(projectDir: string): Promise<ProjectMeta> {
  let raw: string;
  try {
    raw = await fsp.readFile(path.join(projectDir, 'project.json'), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw ApiError.projectCorrupted(path.basename(projectDir));
    }
    throw err;
  }
  try {
    const data = JSON.parse(raw) as Partial<ProjectMeta>;
    if (typeof data.id !== 'string' || typeof data.name !== 'string') {
      throw new Error('bad shape');
    }
    // slug всегда авторитетен из имени каталога (legacy project.json без поля
    // slug — имя каталога и было именем проекта).
    return {
      id: data.id,
      name: data.name,
      slug: path.basename(projectDir),
      createdAt: String(data.createdAt ?? ''),
      updatedAt: String(data.updatedAt ?? ''),
      latestResult: typeof data.latestResult === 'string' ? data.latestResult : null,
    };
  } catch {
    throw ApiError.projectCorrupted(path.basename(projectDir));
  }
}

/** Атомарная запись project.json: <name>.tmp + fs.rename (ТЗ 02 §2). */
export async function writeMeta(projectDir: string, meta: ProjectMeta): Promise<void> {
  const finalPath = path.join(projectDir, 'project.json');
  const tmpPath = path.join(projectDir, 'project.json.tmp');
  await fsp.writeFile(tmpPath, JSON.stringify(meta, null, 2) + '\n', 'utf8');
  await fsp.rename(tmpPath, finalPath);
}

// ---------------------------------------------------------------------------
// Размещение проекта в workspace
// ---------------------------------------------------------------------------

export function projectDirOf(workspace: string, slug: string): string {
  if (!isValidSlug(slug)) throw ApiError.invalidName(`Имя «${slug}» не проходит регламент slug`);
  return path.join(workspace, slug);
}

export async function projectExists(workspace: string, slug: string): Promise<boolean> {
  try {
    const st = await fsp.lstat(path.join(workspace, slug));
    return st.isDirectory();
  } catch {
    return false;
  }
}

/** Каталог проекта + проверка существования (404 PROJECT_NOT_FOUND). */
export async function requireProjectDir(workspace: string, slug: string): Promise<string> {
  const dir = projectDirOf(workspace, slug);
  try {
    const st = await fsp.lstat(dir);
    if (!st.isDirectory()) throw new Error('not a directory');
  } catch {
    throw ApiError.projectNotFound(slug);
  }
  return dir;
}

// ---------------------------------------------------------------------------
// CRUD проектов (ТЗ 02 §6.3–§6.5)
// ---------------------------------------------------------------------------

/**
 * Создание проекта по человекочитаемому имени (замечание 2): slug генерируется
 * из имени транслитерацией с уникализацией; каталог = <workspace>/<slug>/.
 */
export async function createProject(
  workspace: string,
  displayName: string,
  now: Clock,
): Promise<ProjectMeta> {
  if (!isValidProjectName(displayName)) {
    throw ApiError.invalidName(
      `Имя «${displayName}» не проходит регламент имён проекта (1–64 символа, без «/» и \\0)`,
    );
  }
  const { slug } = await generateProjectSlug(workspace, displayName);
  const dir = path.join(workspace, slug);
  if (await projectExists(workspace, slug)) {
    throw ApiError.projectExists(slug); // теоретически недостижимо — гонка
  }
  await fsp.mkdir(dir, { recursive: false });
  const iso = now().toISOString();
  const meta: ProjectMeta = {
    id: crypto.randomUUID(),
    name: displayName,
    slug,
    createdAt: iso,
    updatedAt: iso,
    latestResult: null,
  };
  await fsp.writeFile(path.join(dir, 'spec.yaml'), SPEC_TEMPLATE, 'utf8');
  await fsp.writeFile(path.join(dir, 'blocked.txt'), MASK_TEMPLATE, 'utf8');
  await fsp.writeFile(path.join(dir, 'preset.txt'), MASK_TEMPLATE, 'utf8');
  await writeMeta(dir, meta);
  return meta;
}

/**
 * Переименование (замечание 2): меняет ТОЛЬКО человекочитаемое имя в
 * project.json. Каталог и slug НЕ изменяются — все API-ссылки сохраняются.
 */
export async function renameProject(
  workspace: string,
  slug: string,
  newName: string,
  now: Clock,
): Promise<ProjectMeta> {
  if (!isValidProjectName(newName)) {
    throw ApiError.unprocessable(
      `Имя «${newName}» не проходит регламент имён проекта (1–64 символа, без «/» и \\0)`,
    );
  }
  const dir = await requireProjectDir(workspace, slug);
  const meta = await readMeta(dir); // corrupted → PROJECT_CORRUPTED
  const updated: ProjectMeta = { ...meta, name: newName, updatedAt: now().toISOString() };
  await writeMeta(dir, updated);
  return updated;
}

export async function deleteProject(workspace: string, slug: string): Promise<void> {
  if (!isValidSlug(slug)) throw ApiError.invalidName(`Имя «${slug}» не проходит регламент slug`);
  const dir = path.join(workspace, slug);
  let exists = true;
  try {
    await fsp.lstat(dir);
  } catch {
    exists = false;
  }
  if (!exists) throw ApiError.projectNotFound(slug);
  await fsp.rm(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Метрики и список проектов (ТЗ 02 §6.2 + filesCount по 05 §8)
// ---------------------------------------------------------------------------

async function dirSizeBytes(dir: string): Promise<number> {
  let total = 0;
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      total += await dirSizeBytes(p);
    } else if (e.isFile()) {
      const st = await fsp.stat(p);
      total += st.size;
    }
  }
  return total;
}

/** Список файлов проекта по ТЗ 02 §6.7 (кроме project.json и preview/). */
export async function listProjectFiles(
  dir: string,
): Promise<{ name: string; sizeBytes: number; mtimeIso: string }[]> {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const files: { name: string; sizeBytes: number; mtimeIso: string }[] = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (e.name === 'project.json') continue;
    const st = await fsp.stat(path.join(dir, e.name));
    files.push({ name: e.name, sizeBytes: st.size, mtimeIso: st.mtime.toISOString() });
  }
  const canonicalOrder = new Map<string, number>(CANONICAL_FILES.map((n, i) => [n, i]));
  files.sort((a, b) => {
    const ca = canonicalOrder.has(a.name) ? (canonicalOrder.get(a.name) as number) : Number.MAX_SAFE_INTEGER;
    const cb = canonicalOrder.has(b.name) ? (canonicalOrder.get(b.name) as number) : Number.MAX_SAFE_INTEGER;
    if (ca !== cb) return ca - cb;
    return a.name.localeCompare(b.name);
  });
  return files;
}

export interface ProjectListEntry {
  /** Имя каталога (= slug проекта). */
  slug: string;
  meta: ProjectMeta | null;
  corrupted: boolean;
  sizeBytes: number;
  resultsCount: number;
  previewsCount: number;
  filesCount: number;
}

export async function listProjects(workspace: string): Promise<ProjectListEntry[]> {
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(workspace, { withFileTypes: true });
  } catch {
    return [];
  }
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  const out: ProjectListEntry[] = [];
  for (const slug of dirs) {
    const dir = path.join(workspace, slug);
    let meta: ProjectMeta | null = null;
    let corrupted = false;
    try {
      meta = await readMeta(dir);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'PROJECT_CORRUPTED') corrupted = true;
      else throw err;
    }
    const files = await listProjectFiles(dir);
    let previewsCount = 0;
    const previewDir = path.join(dir, 'preview');
    try {
      const pEntries = await fsp.readdir(previewDir, { withFileTypes: true });
      previewsCount = pEntries.filter((e) => e.isFile() && PREVIEW_NAME_RE.test(e.name)).length;
    } catch {
      // preview/ может не существовать — 0
    }
    out.push({
      slug,
      meta,
      corrupted,
      sizeBytes: await dirSizeBytes(dir),
      resultsCount: files.filter((f) => RESULT_NAME_RE.test(f.name)).length,
      previewsCount,
      filesCount: files.length,
    });
  }
  // updatedAt desc; повреждённые (без meta) — в конец; при равенстве — slug asc.
  out.sort((a, b) => {
    if (!!a.meta !== !!b.meta) return a.meta ? -1 : 1;
    const au = a.meta?.updatedAt ?? '';
    const bu = b.meta?.updatedAt ?? '';
    if (au !== bu) return au < bu ? 1 : -1;
    return a.slug.localeCompare(b.slug);
  });
  return out;
}

// ---------------------------------------------------------------------------
// Файлы проекта (ТЗ 02 §6.8–§6.9)
// ---------------------------------------------------------------------------

export async function readProjectFile(dir: string, fileName: string): Promise<Buffer> {
  if (!isValidFileName(fileName)) {
    throw ApiError.invalidName(`Имя «${fileName}» не проходит регламент`);
  }
  if (fileName === 'project.json') {
    throw ApiError.invalidName('Файл project.json — служебный и не отдаётся');
  }
  const full = resolveSafe(dir, fileName);
  try {
    const st = await fsp.stat(full);
    if (!st.isFile()) throw new Error('not a file');
    return await fsp.readFile(full);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw ApiError.fileNotFound(fileName);
    throw err;
  }
}

export async function saveProjectFiles(
  dir: string,
  files: Record<string, string>,
): Promise<{ saved: string[]; deleted: string[] }> {
  for (const name of Object.keys(files)) {
    if (!isValidFileName(name)) {
      throw ApiError.invalidName(`Имя «${name}» не проходит регламент`);
    }
    // result-* — выход солвера: не редактируются из редактора (ТЗ 05 §3.2).
    if (RESULT_NAME_RE.test(name)) {
      throw ApiError.invalidName(`Файл «${name}» — результат генерации и не редактируется`);
    }
    if (typeof files[name] !== 'string') {
      throw ApiError.invalidName(`Значение файла «${name}» должно быть текстом`);
    }
  }
  const saved: string[] = [];
  for (const [name, content] of Object.entries(files)) {
    await fsp.writeFile(resolveSafe(dir, name), content, 'utf8');
    saved.push(name);
  }
  // Каноническая тройка: отсутствующие в payload удаляются (ТЗ 02 §6.9).
  const deleted: string[] = [];
  for (const canonical of CANONICAL_FILES) {
    if (Object.prototype.hasOwnProperty.call(files, canonical)) continue;
    const p = path.join(dir, canonical);
    try {
      await fsp.unlink(p);
      deleted.push(canonical);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
  return { saved, deleted };
}

// ---------------------------------------------------------------------------
// Импорт из zip (ТЗ 02 §6.6) — adm-zip
// ---------------------------------------------------------------------------

export interface ImportSkipped {
  name: string;
  reason: string;
}

export interface ImportOutcome {
  meta: ProjectMeta;
  imported: string[];
  skipped: ImportSkipped[];
}

/** Проверка имени записи zip на traversal (ТЗ 02 §6.6 п.5). */
function assertZipEntrySafe(entryName: string): string {
  if (entryName.startsWith('/') || entryName.includes('\\')) {
    throw ApiError.badZip(`Вредоносное имя записи в архиве: «${entryName}»`);
  }
  const segments = entryName.split('/');
  for (const seg of segments) {
    if (seg === '..' || seg === '.' || seg === '') {
      throw ApiError.badZip(`Вредоносное имя записи в архиве: «${entryName}»`);
    }
  }
  return entryName;
}

function isImportableFile(relName: string): boolean {
  const base = relName.split('/').pop() as string;
  if (base === 'project.json') return false;
  if (relName.startsWith('preview/') || base.startsWith('preview/')) return false;
  if (base.endsWith('.zip')) return false;
  return isValidFileName(base);
}

export async function importProjectFromZip(
  workspace: string,
  zipBuffer: Buffer,
  requestedName: string | undefined,
  now: Clock,
): Promise<ImportOutcome> {
  let zip: AdmZip;
  try {
    zip = new AdmZip(zipBuffer);
  } catch {
    throw ApiError.badZip('Файл не распаковывается как zip-архив');
  }

  // 1) Все записи проверяются на traversal — архив отвергается целиком.
  const rawEntries = zip
    .getEntries()
    .filter((e) => !e.isDirectory)
    .map((e) => assertZipEntrySafe(e.entryName));

  if (rawEntries.length === 0) {
    throw ApiError.badZip('Архив не содержит файлов');
  }

  // 2) Одна верхняя папка — общий префикс снимается.
  const tops = new Set(rawEntries.map((n) => n.split('/')[0]));
  let prefix = '';
  if (tops.size === 1) {
    const top = [...tops][0];
    if (rawEntries.every((n) => n.startsWith(top + '/'))) prefix = top + '/';
  }
  const relNames = rawEntries.map((n) => (prefix ? n.slice(prefix.length) : n));

  // 3) Имя проекта (замечание 2): display-name из ?name= / верхней папки / 'imported';
  // slug генерируется транслитерацией. Без явного имени коллизии slug снимаются
  // суффиксами -2, -3… (они же отражаются в display-name — имя остаётся уникальным
  // визуально). Явное ?name= без суффиксов: коллизия → PROJECT_EXISTS.
  const baseDisplay =
    requestedName !== undefined
      ? requestedName
      : prefix
        ? prefix.slice(0, -1)
        : 'imported';
  let finalSlug: string;
  let finalDisplay: string;
  if (requestedName !== undefined) {
    if (!isValidProjectName(requestedName)) {
      throw ApiError.invalidName(
        `Имя «${requestedName}» не проходит регламент имён проекта (1–64 символа, без «/» и \\0)`,
      );
    }
    const base = slugFromName(requestedName) ?? `project-${crypto.randomUUID().slice(0, 8)}`;
    finalSlug = base.length > 37 ? base.slice(0, 37).replace(/-+$/g, '') : base;
    if (await projectExists(workspace, finalSlug)) {
      throw ApiError.projectExists(`Проект «${requestedName}» уже существует`);
    }
    finalDisplay = requestedName;
  } else {
    const { slug, suffix } = await generateProjectSlug(workspace, baseDisplay);
    finalSlug = slug;
    // Суффикс уникализации отражаем и в имени: «imported-2», не два «imported».
    finalDisplay = suffix > 1 ? `${baseDisplay}-${suffix}` : baseDisplay;
  }

  // 4) Приём файлов: basename по §3.2, без project.json / preview/ / *.zip.
  const imported: string[] = [];
  const skipped: ImportSkipped[] = [];
  for (const rel of relNames) {
    if (isImportableFile(rel)) {
      imported.push(rel);
    } else {
      const base = rel.split('/').pop() as string;
      let reason = 'имя не проходит регламент файлов проекта';
      if (base === 'project.json') reason = 'служебные метаданные не импортируются';
      else if (rel.startsWith('preview/')) reason = 'превью не импортируется';
      else if (base.endsWith('.zip')) reason = 'архивы не импортируются';
      skipped.push({ name: rel, reason });
    }
  }

  // 5) Обязателен spec.yaml (после снятия префикса).
  if (!imported.includes('spec.yaml')) {
    throw ApiError.badZip('В архиве не найден файл spec.yaml');
  }

  imported.sort();

  const dir = path.join(workspace, finalSlug);
  await fsp.mkdir(dir, { recursive: false });
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const safeName = assertZipEntrySafe(entry.entryName);
    const rel = prefix ? safeName.slice(prefix.length) : safeName;
    if (!imported.includes(rel)) continue;
    const target = resolveSafe(dir, rel);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, entry.getData());
  }

  // Каноническая тройка достраивается из шаблонов (ТЗ 05 §3.4).
  for (const canonical of CANONICAL_FILES) {
    const p = path.join(dir, canonical);
    try {
      await fsp.access(p);
    } catch {
      const template = canonical === 'spec.yaml' ? SPEC_TEMPLATE : MASK_TEMPLATE;
      await fsp.writeFile(p, template, 'utf8');
    }
  }

  // latestResult — последний по имени result-* (если есть).
  const results = imported.filter((n) => RESULT_NAME_RE.test(n.split('/').pop() as string));
  const latestResult = results.length > 0 ? results.sort()[results.length - 1] : null;

  const iso = now().toISOString();
  const meta: ProjectMeta = {
    id: crypto.randomUUID(),
    name: finalDisplay,
    slug: finalSlug,
    createdAt: iso,
    updatedAt: iso,
    latestResult,
  };
  await writeMeta(dir, meta);
  return { meta, imported, skipped };
}

// ---------------------------------------------------------------------------
// Архив проекта (ТЗ 02 §6.12) — adm-zip, на лету, без записи на диск
// ---------------------------------------------------------------------------

export function buildProjectArchive(projectDir: string, now: Date): Buffer {
  const zip = new AdmZip();
  const base = path.resolve(projectDir);

  const walk = (dir: string, relPrefix: string): void => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(dir, e.name);
      const rel = relPrefix ? `${relPrefix}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (e.name === 'preview') continue; // preview/ исключается целиком
        walk(abs, rel);
      } else if (e.isFile()) {
        if (rel === 'project.json') continue;
        if (e.name.endsWith('.zip')) continue;
        zip.addFile(rel, fs.readFileSync(abs));
      }
    }
  };
  walk(base, '');
  return zip.toBuffer();
}

export function archiveFileName(projectName: string, now: Date): string {
  return `${projectName}-${timestampOf(now)}.zip`;
}
