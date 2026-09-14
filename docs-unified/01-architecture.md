# 01. Архитектура единого сервиса

> Сводный индекс: [../docs-unified/README.md](./README.md) · API и workspace:
> [02-workspace-api](./02-workspace-api.md) · Интеграции: [04-integrations](./04-integrations.md)

## 1. Общая схема

```
┌──────────────────────────── Браузер (десктоп, один пользователь) ────────────────────────────┐
│                                                                                                │
│  :4080/            → Менеджер проектов (React SPA, app/dist)                                   │
│  :4080/editor/*    → Редактор (editor/dist, base '/editor/')                                   │
│  :4080/viewer3d/*  → 3D-визуализатор (viewer3d/dist, base '/viewer3d/')                        │
│                                                                                                │
│  Все три UI обращаются к ОДНОМУ API: /api/projects… (см. 02-workspace-api)                     │
└───────────────────────────────────────────────┬────────────────────────────────────────────────┘
                                                │ HTTP (один origin, один порт)
┌───────────────────────────────────────────────▼────────────────────────────────────────────────┐
│  app/server/index.ts — Express (порт 4080, tsx):                                               │
│   • статика: / → app/dist, /editor/* → ../editor/dist, /viewer3d/* → ../viewer3d/dist          │
│   • API /api/*: проекты CRUD, файлы, генерация, архивы, preview                                │
│   • fs-операции в <root>/workspace/                                                             │
│   • child_process.spawn(.venv/bin/python -m space_manager place …)                              │
└───────────────────────────────────────────────┬────────────────────────────────────────────────┘
                                                │ spawn (синхронно для запроса, timeout 60 с)
                     <root>/.venv/bin/python -m space_manager place <проект>/spec.yaml --out …
```

Ключевые свойства:

- **Один origin, один порт** — все UI и API на :4080; межстраничные ссылки
  (`/editor?project=…`, `/viewer3d?project=…&result=…`) работают без CORS.
- **Единое рабочее пространство** `<root>/workspace/` — единственное место на диске,
  где сервис создаёт/меняет данные (см. [02](./02-workspace-api.md) §1).
- **Python-солвер не трогается**: вызывается как внешний процесс; контракт — CLI
  (`space_manager/cli.py`) и текст отчёта (`space_manager/report.py`).

## 2. Структура нового каталога `app/`

```
app/
├── package.json           # имя: space-unified-app; type: module
├── tsconfig.json          # strict — как в editor/ и viewer3d/
├── vite.config.ts         # dev-сервер 5175, proxy /api → http://localhost:4080 (см. §5)
├── index.html             # Vite-вход SPA менеджера
├── .gitignore             # node_modules/, dist/
├── server/
│   └── index.ts           # Express :4080 — статика + API (tsx)
├── src/                   # React SPA «Менеджер проектов»
│   ├── main.tsx
│   ├── App.tsx            # раскладка: шапка + панель действий + сетка карточек + модалка
│   ├── components/        # ProjectCard, CreateProjectForm, ImportDialog,
│   │                      # RenameDialog, ConfirmDelete, PreviewModal, EmptyState
│   ├── lib/api.ts         # весь HTTP-слой (fetch /api/*), типы ответов
│   └── i18n/ru.ts         # все строки UI (паттерн как в editor/src/i18n/ru.ts)
├── tests/
│   ├── unit/              # vitest: API-обработчики, workspace-хелперы (tmp-директории)
│   └── e2e/               # Playwright (см. 05-testing-acceptance §4)
└── dist/                  # сборка SPA (gitignored)
```

Зависимости `app/package.json` (минимальный набор):

| Пакет | Назначение |
|---|---|
| `express` ^4.21 | сервер (та же мажорная версия, что в editor/viewer3d) |
| `adm-zip` ^0.5 | ЧИТАНИЕ и ЗАПИСЬ zip — одна библиотека для импорта и архива. **Решение: adm-zip** (выбран вместо archiver: синхронный API проще для обоих сценариев и не требует потоков; лимиты размера делают потоковую сборку ненужной) |
| `react`, `react-dom` ^18.3 | UI менеджера (те же версии, что в editor/viewer3d) |
| devDeps: `vite` ^6, `@vitejs/plugin-react` ^4, `typescript` ^5.7 (strict), `tsx` ^4, `concurrently` ^9, `vitest` ^3, `@playwright/test`, `@types/*` | тот же набор и те же мажорные версии, что в editor/ и viewer3d/ — единый стиль сборки |

## 3. Раздача статики и base-пути (КРИТИЧНО для переиспользования сборок)

### 3.1 Проблема

Сборки `editor/dist` и `viewer3d/dist` по умолчанию используют Vite-base `/`:
`index.html` ссылается на `/assets/index-<hash>.js`. Чтобы отдать их под
префиксами `/editor/` и `/viewer3d/` без переписывания HTML, base задаётся в
vite-конфиге.

### 3.2 Изменения в vite.config.ts (по одной строке на проект)

| Файл | Добавление | Эффект |
|---|---|---|
| `editor/vite.config.ts` | `base: '/editor/'` | asset-пути сборки: `/editor/assets/…` |
| `viewer3d/vite.config.ts` | `base: '/viewer3d/'` | asset-пути сборки: `/viewer3d/assets/…` |
| `app/vite.config.ts` | base по умолчанию `/` | статика менеджера на корне |

### 3.3 Mount'ы в `app/server/index.ts`

```
GET /api/*                → API (см. 02-workspace-api) — ПЕРВЫМИ, до статики
/editor/assets/*          → ../editor/dist/assets   (Cache-Control: immutable, max-age 1 год)
/editor/<файл>            → ../editor/dist/<файл>   (no-cache)
/editor, /editor/*        → SPA-fallback: dist/index.html (GET без расширения или
                              несуществующий путь — как в editor/server/index.ts)
/viewer3d/assets/*, /viewer3d/*   → аналогично ../viewer3d/dist
/assets/*                 → app/dist/assets (immutable)
/<файл>, /*               → app/dist (no-cache) + SPA-fallback index.html
```

Порядок маршрутов: `/api` → `/editor` → `/viewer3d` → корень. Конфликта asset-путей
нет, т.к. base различны (`/editor/assets/…` ≠ `/viewer3d/assets/…`).

### 3.4 Совместимость со standalone-режимами editor/viewer3d

Свои Express-серверы (`editor/server/index.ts`, `viewer3d/server/index.ts`) сохраняются
для dev. Из- за base `/editor/` их статика монтируется **двойно** (по одной строке на
проект): `app.use('/editor', express.static(distDir))` + существующий
`app.use(express.static(distDir))` — тогда и `/`, и `/editor/*` работают в standalone.
Это фиксация минимального изменения; логика серверов не меняется.

## 4. Переменные окружения `app/server/index.ts`

| Env | Дефолт | Назначение |
|---|---|---|
| `PORT` | `4080` | порт HTTP-сервера |
| `SPACEMGR_WORKSPACE` | `<root>/workspace` (root = родитель `app/`) | корень рабочего пространства; **обязателен для тестов** — юнит/e2e указывают tmp-директорию. При старте сервер создаёт директорию, если её нет (`mkdir -p`). Если по пути лежит файл → отказ в старте с ошибкой |
| `SPACEMGR_PYTHON` | `<root>/.venv/bin/python` | интерпретатор для запуска солвера; нужен для тестов генерации со stub-«python» (см. 05 §3) |

Порядок инициализации: проверка/создание workspace → mount'ы статики (dist может
отсутствовать при dev — тогда соответствующий URL отдаёт заглушку «сначала соберите
`npm run build` в <dir>», HTTP 503, чтобы не маскировать ошибки) → API → listen.

## 5. Dev-режимы и порты

| Процесс | Команда | Порт | Прокси |
|---|---|---|---|
| API + менеджер (prod-сервер) | `cd app && npm start` | **4080** | — |
| Vite менеджера | `cd app && npm run dev` | 5175 | `/api → http://localhost:4080` |
| Vite редактора | `cd editor && npm run dev` | 5173 (без изменения) | `/api → http://localhost:4080` (**было** :3000 — правка vite.config.ts, см. [04](./04-integrations.md) §2.6) |
| Vite viewer3d | `cd viewer3d && npm run dev` | 5174 (без изменения) | `/api → http://localhost:4080` (**было** :3200 — правка vite.config.ts, см. [04](./04-integrations.md) §3.6) |

Скрипты `app/package.json`: `dev` (concurrently: vite + tsx server/index.ts),
`build` (`tsc --noEmit && vite build`), `start` (`tsx server/index.ts`),
`test` (`vitest run`), `e2e` (`npm run build && playwright test`) — паттерн 1:1 с
editor/viewer3d. Standalone-серверы editor(:3000)/viewer3d(:3200) в dev не нужны и не
запускаются; их `/api/health` остаётся для обратной совместимости, но UI к ним больше
не обращается (прокси указывают на :4080).

## 6. Поток данных (сценарий «проект → генерация → визуализация»)

```
Менеджер (/)                         Редактор (/editor?project=p1)        Viewer3d (/viewer3d?project=p1&result=f)
─────────────                        ────────────────────────────         ──────────────────────────────────────
POST /api/projects {name:p1}   →    GET  /api/projects                   GET  /api/projects
     (создание workspace/p1/       GET  …/p1/file?name=spec.yaml         GET  …/p1/results
      со скелетом — 02 §4)          GET  …/p1/file?name=blocked.txt            ↓ parseReport → REPORT_LOADED
                                     GET  …/p1/file?name=preset.txt       (смена ревизии: fetch другого файла)
                                     [правка canvas/панелей]
                                     PUT  …/p1/files {spec.yaml, blocked.txt, preset.txt}
                                     POST …/p1/generate ──→ сервер: .venv/bin/python -m space_manager
                                            ↓                        place p1/spec.yaml --out p1/result-<ts>.txt
                                     {resultFile, exitCode, report}    (по имени из ответа)
                                     [кнопка «Открыть в viewer3d»] ──────────→ GET …/p1/file?name=result-<ts>.txt
                                                                 [PNG-снапшот] → POST …/p1/preview (preview/<ts>.png)
Менеджер: галерея preview ←── GET …/p1/previews, …/p1/preview?file=…
Менеджер: архив ←───────────────  GET …/p1/archive (zip, без project.json и preview/)
```

## 7. Безопасность (локальный одноместный сервис, модель доверия)

- **Path traversal**: все имена проектов — slug `[a-z0-9_-]{1,40}` (отсекает `/`, `..`,
  абсолюты); все имена файлов из API — только `[A-Za-z0-9._-]+` БЕЗ подстрок `..` и
  ведущей точки; финальная защита — `path.resolve(dir, name)` обязан начинаться с
  `path.resolve(dir) + sep`, иначе 400. Имена записей zip при импорте проверяются
  так же (и отвергаются), см. [02](./02-workspace-api.md) §7.3.
- **Лимиты загрузки**: `express.raw({ limit: '10mb' })` на import/preview/file-save;
  превышение → 413 `PAYLOAD_TOO_LARGE`.
- **Запуск процесса**: аргументы `spawn` — массив (нет shell), пути только из
  workspace; stdout/stderr с `maxBuffer` 10 МБ.
- Аутентификация отсутствует осознанно (вводная №10); **решение (обновлено по
  требованию пользователя)**: слушать `0.0.0.0` — сервис доступен с внешних
  подключений машины; env `HOST` для переопределения (например, обратно на
  `127.0.0.1`, если доступ нужен только локальный). Внимание: аутентификации нет,
  поэтому не выставляйте порт в недоверенные сети.

## 8. Соответствие стилю существующих ТЗ

- Код: TypeScript strict, ES2020+, без `any`; сервер на Express 4 + tsx — тот же
  паттерн, что `editor/server/index.ts` и `viewer3d/server/index.ts`.
- UI: React 18, функциональные компоненты, i18n-объект `ru` в `src/i18n/ru.ts`,
  CSS-классы панелей `.panel` как в viewer3d (`styles.css`) — для единообразия
  общий набор классов выносится в `app/src/styles.css` и **подключается** из
  сборок editor/viewer3d без рефакторинга их кода (допустимые правки — см. [04](./04-integrations.md)).

## 9. Открытые решения

1. Корневой удобство-скрипт «построить всё и запустить» (root `package.json` c
   `npm run build:all && npm --prefix app start`) — не входит в v1; предлагаю добавить
   после приёмки.
2. Отображение размера сетки (W×H) на карточке проекта требует чтения YAML сервером
   (js-yaml в app/) — предлагается перенести в v2 (карточки уже показывают
   достаточные метрики).
