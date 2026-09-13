// Express-сервер редактора (ТЗ 03): статика dist/ + GET /api/health.
// Файлы на сервере НЕ хранятся (вводная №3): ни body-parser, ни POST/PUT в v1.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(here, '..');
const distDir = path.join(rootDir, 'dist');
const pkg = JSON.parse(
  fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'),
) as { version: string };

const app = express();
app.disable('x-powered-by');

// Единственный эндпоинт API (03 §2): health с версией из package.json.
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', version: pkg.version });
});

// Все прочие пути /api/* → 404 JSON (03 §2).
app.use('/api', (req, res) => {
  res.status(404).json({ error: `${req.originalUrl} not found` });
});

// Демо-удобство (не часть API v1): при EXAMPLES=1 отдаём ../examples,
// чтобы браузер мог загрузить демонстрационные файлы через fetch.
if (process.env.EXAMPLES === '1') {
  app.use('/examples', express.static(path.join(rootDir, '..', 'examples')));
}

// Статика из dist/ с кэшированием по ТЗ 03 §2:
// assets с хэшем — immutable год; index.html и прочее — no-cache.
if (fs.existsSync(distDir)) {
  const assetsDir = path.join(distDir, 'assets');
  if (fs.existsSync(assetsDir)) {
    app.use('/assets', express.static(assetsDir, { maxAge: '365d', immutable: true }));
  }
  app.use(
    express.static(distDir, {
      setHeaders(res) {
        res.setHeader('Cache-Control', 'no-cache');
      },
    }),
  );
  // Двойной mount (docs-unified/01 §3.4): base '/editor/' — работает и '/', и '/editor/*'.
  app.use('/editor', express.static(distDir));
}

// SPA-fallback (03 §2): GET-путь без расширения, не /api/* и не существующая
// статика → dist/index.html. Пути с расширением, которых нет в статике → 404 JSON.
app.get('*', (req, res) => {
  const indexPath = path.join(distDir, 'index.html');
  if (!path.extname(req.path) && fs.existsSync(indexPath)) {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexPath);
    return;
  }
  res.status(404).json({ error: `${req.originalUrl} not found` });
});

// Обёртка ошибок: JSON без stack trace (03 §2).
app.use(
  (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (res.headersSent) return;
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  },
);

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`[editor] Express: http://localhost:${port} (static: ${distDir})`);
});
