# 01. Архитектура редактора

> Сводный индекс: [../docs-editor/README.md](./README.md) · Модель данных:
> [02-data-model-formats](./02-data-model-formats.md) · API: [03-api-express](./03-api-express.md)

## 1. Общая схема

```
┌──────────────────────────── Браузер (десктоп, один пользователь) ───────────────────────────┐
│                                                                                              │
│  React SPA (Vite + TypeScript)                                                               │
│  ┌─────────────────────────────┬────────────────────────────────────────────────────┐        │
│  │ Слой состояния редактора    │  UI-компоненты                                     │        │
│  │  • EditorState (spec,       │  • FilesPanel          (загрузка/скачивание)       │        │
│  │    blockedMask, presetMask) │  • GridCanvas          (canvas, режимы, инструменты)│       │
│  │  • UI-state (режим,         │  • ClustersPanel / TypesPanel / RulesPanel         │        │
│  │    инструмент, палитра,     │  • ValidationBanner + ошибки на сетке              │        │
│  │    viewport)                └───────────────┬────────────────────────────────────┘        │
│  │                                             │                                             │
│  │ Слой логики (чистые TS-модули, без React):   │                                             │
│  │  • specYaml.ts   — parse/dump YAML (js-yaml) │                                             │
│  │  • maskText.ts   — parse/dump текстовых масок│                                             │
│  │  • validation.ts — валидация (docs/03 §5)    │                                             │
│  └───────────────┬─────────────────────────────┘                                             │
│                  │ fetch('/api/health') — единственный вызов API                             │
└──────────────────┼───────────────────────────────────────────────────────────────────────────┘
                   ▼
        Node.js + Express: статика (dist/) + GET /api/health. Файлы на сервер НЕ загружаются.
```

## 2. Ключевые решения

### 2.1 Где живут парсинг и валидация

**Варианты:** А) вся логика на клиенте (js-yaml в браузере, Express — только статика);
Б) серверный API парсит/валидирует, вызывая Python `spaec_manager` как subprocess.

**Решение: А.** Причины:

- сценарий «загрузил → отредактировал → скачал» полностью самодостаточен в браузере —
  файлы читаются через `<input type=file>` / `FileReader`, скачиваются через Blob +
  `<a download>`; сервер для этого не нужен (вводные №2, №3);
- вариант Б тянет Python-зависимость и IPC на Node-сервер без прироста функциональности
  в v1: редактор генерацию не запускает;
- клиентская логика — это чистые TS-модули, которые unit-тестятся независимо от React
  (см. [06-testing-acceptance](./06-testing-acceptance.md) §2);
- серверное хранение между сессиями исключено вводной №3 — парсить на сервере было бы
  бессмысленно, т.к. результат всё равно уезжает в браузер.

Последствие: **API Express минимален** (см. [03-api-express](./03-api-express.md)).
Слой `fetch` вынесен в отдельный модуль `api.ts`, поэтому будущее добавление серверных
эндпоинтов (auth, проверка через Python) не потребует переделки UI.

### 2.2 Рендер сетки: canvas или DOM

**Варианты:** А) чистый HTML5 `<canvas>`; Б) DOM-таблица/CSS-grid из div'ов; В)
библиотека (Konva, fabric).

**Решение: А — чистый canvas.** Причины:

- сетка произвольного размера (вводная №5), целевой масштаб до 200×200 = 40 000 клеток;
  DOM-вариант Б создаёт десятки тысяч узлов и деградирует при панировании;
- canvas даёт полный контроль над viewport (смещение, зум) одним перерисовываемым слоем —
  ~40k `fillRect` за кадр укладывается в бюджет кадра на десктопных GPU/CPU современных ПК;
- библиотеки (В) добавляют объём зависимостей без нужды: рисуются только прямоугольники,
  текст (символы) и линии сетки — это примитивы canvas API;
- интерактив (клики/драг) реализован мышью по координатам с учётом offset/scale —
  стандартная техника, без сторонних зависимостей.

### 2.3 Состояние редактора

**Решение:** единый `EditorState` на клиенте, управляется через React-хук
(`useReducer`) + контекст. Серверного состояния нет (вводная №3).

```ts
interface EditorState {
  spec: SpecDoc | null;          // распарсенная YAML-спекация (модель — см. 02 §1)
  blockedMask: MaskGrid | null;  // маска блокировок, W×H из spec.grid
  presetMask: MaskGrid | null;   // карта preset-кластеров, W×H из spec.grid

  // UI-состояние (не сериализуется):
  ui: {
    maskMode: 'blocked' | 'preset';  // активный режим canvas (04-ui-ux §3)
    tool: 'brush' | 'rect' | 'eraser';
    paletteSymbol: string | null;    // выбранный символ типа в preset-режиме
    pan: { x: number; y: number };   // смещение viewport в пикселях canvas
    zoom: number;                    // масштаб, 1 = автоподгонка сетки под область
    errors: ValidationError[];       // результат последней валидации (05)
  }
}
```

Правила изменения `spec.grid.width/height` — в [04-ui-ux](./04-ui-ux.md) §1
(поля W×H в FilesPanel; маски пересоздаются, сохраняя пересечение).
Action `GRID_RESIZE` и эффекты — в §2.7 настоящего документа.

Refresh страницы = потеря несохранённого — пользователь предупреждается (beforeunload),
см. [07-nfr-limits](./07-nfr-limits.md) §2.

### 2.4 Структура папок проекта редактора

**Варианты:** А) отдельный корень `editor/` в репозитории spaec-manager; Б) всё в
подпапке основного пакета Python — смешивание экосистем.

**Решение: А.** React/Node-проект не должен жить внутри Python-пакета (разные toolchain'ы,
`node_modules`, сборка). Структура:

```
space-manager/                     # корень репозитория (без изменений)
├── README.md, docs/, spaec_manager/, examples/, tests/ ...
├── docs-editor/                   # это ТЗ
└── editor/                        # НОВЫЙ: проект веб-редактора (самостоятельный npm-проект)
    ├── package.json               # deps: react, react-dom, express, js-yaml;
    │                              # devDeps: vite, @vitejs/plugin-react, typescript,
    │                              # vitest, @playwright/test, @types/react, @types/node,
    │                              # @types/js-yaml
    ├── tsconfig.json
    ├── vite.config.ts             # dev-сервер 5173, proxy /api → localhost:3000 (см. 03 §3)
    ├── server/
    │   └── index.ts               # Express: статика dist/ + /api/health
    ├── src/
    │   ├── main.tsx               # точка входа SPA
    │   ├── App.tsx                # layout: FilesPanel | GridCanvas | правые панели (04 §2)
    │   ├── state/editorStore.ts   # useReducer + контекст, EditorState (см. §2.3)
    │   ├── lib/                   # ЧИСТЫЕ модули без React — ядро unit-тестов:
    │   │   ├── specYaml.ts        # parseSpec/dumpSpec (02 §4)
    │   │   ├── maskText.ts        # parseBlockedMask/parsePresetMask/dumpMask (02 §5)
    │   │   ├── validation.ts      # validateAll → ValidationError[] (05)
    │   │   └── api.ts             # fetch /api/health (единственный HTTP-слой)
    │   ├── components/
    │   │   ├── FilesPanel.tsx
    │   │   ├── GridCanvas.tsx     # canvas, pointer events, viewport (04 §3)
    │   │   ├── ClustersPanel.tsx
    │   │   ├── TypesPanel.tsx
    │   │   ├── RulesPanel.tsx
    │   │   └── ValidationBanner.tsx
    │   └── i18n/ru.ts             # все строки UI (RU — единственный язык)
    └── tests/
        ├── unit/                  # vitest: specYaml, maskText, validation (06 §2)
        └── e2e/                   # playwright: сквозные сценарии (06 §3)
```

### 2.5 Зависимости и их обоснование

| Зависимость | Зачем | Примечание |
|---|---|---|
| `react`, `react-dom` | UI | — |
| `vite` + `@vitejs/plugin-react` | dev-сервер + сборка | вводная №1 |
| `typescript` | строгая типизация модели (02) | `strict: true` |
| `express` | статика + `/api/health` | вводная №1; версия 4.x |
| `js-yaml` | parse/dump YAML на клиенте | единственный YAML-модуль; парсинг спеки — js-yaml, сериализация — собственный dump (02 §4) поверх порядка ключей docs/03 |
| `vitest` | unit-тесты чистых модулей | 06 §2 |
| `@playwright/test` | e2e-сценарии браузера | 06 §3 |

**Решение:** других runtime-зависимостей не вводится (нет canvas-библиотек — см. §2.2,
нет state-либа — useReducer достаточно; нет UI-фреймворка компонентов — вёрстка на CSS,
стиль: плотный десктопный интерфейс с панелями).

### 2.6 Запуск

**Dev:**

```bash
cd editor
npm install
npm run dev        # параллельно: vite (5173, HMR) + express (3000);
                   # vite proxy переводит /api → localhost:3000
# браузер: http://localhost:5173
```

**Prod:**

```bash
npm run build      # vite build → editor/dist/
npm start          # express раздаёт dist/ со статикой + SPA-fallback, порт 3000
# браузер: http://localhost:3000
```

SPA-fallback: любой GET-путь, кроме `/api/*` и существующих статики-файлов, отдаёт
`dist/index.html`. Детали — [03-api-express](./03-api-express.md) §2.

### 2.6 Последовательность базового сценария «загрузил → отредактировал → скачал»

```
Пользователь        Browser (React SPA)                Express            Файловая система
    │                      │                                │                     │
    │ 1. выбрать spec.yaml ├──────── File Input ────────────┤                     │
    │◄─────────────────────┤ FileReader.readAsText          │                     │
    │                      │ parseSpec → EditorState.spec   │                     │
    │                      │ validateAll (debounce 300 мс)  │                     │
    │ 2. выбрать маску     ├──────── File Input ────────────┤                     │
    │◄─────────────────────┤ parseBlockedMask (w,h из spec) │                     │
    │                      │ validateAll → статусы/ошибки   │                     │
    │ 3. рисует на canvas  │                                │                     │
    │   (кисть/rect/ластик)│ EditorState: dispatch(ACTION)  │                     │
    │                      │ перерисовка rAF + validateAll  │                     │
    │ 4. «Скачать»         │ dumpMask/dumpSpec → string     │                     │
    │◄────── Blob + <a download> (браузер сохраняет файл) ─────────────────────────┤
    │                      │                                │                     │
    │ (отдельно, вручную)  python -m spaec_manager place spec.yaml → проверка формата
```

Express в сценарии не участвует, кроме стартового `GET /api/health`.

### 2.7 Действия состояния редактора (actions редьюсера)

Полный список мутаций `EditorState` (исчерпывающий — разработка реализует ровно эти):

| Action | Источник | Эффект |
|---|---|---|
| `SPEC_LOADED { doc }` | FilesPanel: загрузка/создание спеки | замена `spec`; маски перепроверяются по новому grid/types (сохраняются) |
| `MASK_LOADED { kind, mask, fileName }` | FilesPanel: загрузка маски | установка `blockedMask`/`presetMask`; basename → поле `blockedFile`/`presetFile` (§6 02); при конфликте размера — флаг ошибки V-MASK-DIM |
| `MASK_ADDED { kind }` | FilesPanel: «＋ Добавить» | пустая маска size=grid, все клетки free; basename-правило как выше |
| `MASK_CLEARED { kind }` | FilesPanel: удаление маски | маска → null; соответствующее поле спеки → null |
| `CELL_SET { kind, x, y, value }` | GridCanvas: кисть/ластик (одна клетка) | запись клетки; toggle-логика кисти — в диспатче (§3.2 04) |
| `STROKE_APPLY { kind, cells[], value }` | GridCanvas: batch drag-рисования (за кадр) | массовая запись клеток |
| `RECT_FILL { kind, x1, y1, x2, y2, value }` | GridCanvas: прямоугольник | заливка области |
| `MASK_CLEAR_ALL { kind }` | GridCanvas: «Очистить всё» (после подтверждения) | все клетки free |
| `GRID_RESIZE { w, h }` | FilesPanel (поля W×H) / диалог создания спеки | пересоздание масок (§1 04): сохраняются пересечения, хвосты отбрасываются |
| `TYPE_ADD / TYPE_UPDATE / TYPE_REMOVE { id, … }` | TypesPanel | мутация реестра; REMOVE — с каскадом (кластеры, пары adjacency, preset-клетки помечаются ошибкой) по §5 04 |
| `CLUSTER_ADD / CLUSTER_UPDATE / CLUSTER_REMOVE / CLUSTER_MOVE { … }` | ClustersPanel | мутация списка clusters (MOVE — в v1 не реализован) |
| `RULES_UPDATE { patch }` | RulesPanel | точечное изменение полей rules (forbidden/allow-пары, size, fillAll, touchAll) |
| `UI_* { … }` | GridCanvas/табы | режим маски, инструмент, палитра, pan/zoom — не сериализуются |

Каждое действие, кроме `UI_*`, помечает состояние dirty (§8 04) и запускает пересчёт
валидации (debounce 300 мс, §7 04).

### 2.8 Граница совместимости с spaec-manager

Единственная формальная граница между редактором и основной системой — **форматы файлов**
(docs/03): YAML-спекация, маска блокировок, preset-карта. Редактор не импортирует Python-код
и не зависит от него в runtime; совместимость гарантируется:

1. спецификацией форматов в [02-data-model-formats](./02-data-model-formats.md) (этот документ —
   контракт);
2. сквозным тестом «скачанный файл принимается `python -m spaec_manager place`»
   ([06-testing-acceptance](./06-testing-acceptance.md) §3.3).
