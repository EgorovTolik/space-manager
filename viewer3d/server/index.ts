// Express-сервер 3D-визуализатора (ТЗ 01 §2.6): статика dist/ + GET /api/health.
// Файл отчёта на сервер НЕ загружается (вводная №4): весь ввод — через браузер.
// Паттерн — editor/server/index.ts, но prod-порт по умолчанию 3200 (не 3000 у editor/).
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

// Единственный эндпоинт API (ТЗ 01 §2.1): health с версией из package.json.
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', version: pkg.version });
});

// Все прочие пути /api/* → 404 JSON.
app.use('/api', (req, res) => {
  res.status(404).json({ error: `${req.originalUrl} not found` });
});

// Статика из dist/ с кэшированием (паттерн editor/):
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
}

// SPA-fallback (ТЗ 01 §2.6): GET-путь без расширения, не /api/* и не существующая
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

// Обёртка ошибок: JSON без stack trace.
app.use(
  (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (res.headersSent) return;
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  },
);

// ТЗ 01 §2.6: prod-порт viewer3d = 3200 (env PORT переопределяет; e2e использует 3210).
const port = Number(process.env.PORT ?? 3200);
app.listen(port, () => {
  console.log(`[viewer3d] Express: http://localhost:${port} (static: ${distDir})`);
});
