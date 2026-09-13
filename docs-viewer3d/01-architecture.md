# 01. Архитектура viewer3d

> Сводный индекс: [README.md](./README.md) · Парсер: [02-input-parser](./02-input-parser.md) ·
> Геометрия стен: [03-wall-geometry](./03-wall-geometry.md) · UI: [04-ui-interaction](./04-ui-interaction.md)

## 1. Общая схема

```
┌──────────────────────────── Браузер (десктоп, один пользователь) ────────────────────────────┐
│                                                                                               │
│  React SPA (Vite + TypeScript)                                                                │
│  ┌───────────────────────────────┬─────────────────────────────────────────────────────┐      │
│  │ Слой состояния                │  UI-компоненты                                       │      │
│  │  • ViewerState (report,       │  • FilePanel        (загрузка отчёта, статус)        │      │
│  │    params, selection,         │  • ParamsPanel      (S, Hw, T, unit, тумблеры)       │      │
│  │    cameraPreset)              │  • RoomsPanel       (список комнат, выбор/фокус)     │      │
│  │                               │  • InfoPanel        (карточка выбранной комнаты)     │      │
│  │ Слой логики (чистые TS):      │  • Legend / WarningsBanner / Toolbar (пресеты, PNG)  │      │
│  │  • reportParser.ts — отчёт    │                                                       │      │
│  │    → ParsedReport (02)        │  3D-сцена (@react-three/fiber):                       │      │
│  │  • walls.ts     — рёбра→боксы │   Scene: BasePlate, RoomFloor[] (по комнате),         │      │
│  │    (03)                  →    │   Walls (InstancedMesh), BlockedBoxes (InstancedMesh),│     │
│  │  • palette.ts   — цвета       │   Labels (drei Html), OrbitControls                   │      │
│  └───────────────┬───────────────┴───────────────────────────────────────────────────────┘      │
│                  │ fetch('/api/health') — единственный вызов API                                │
└──────────────────┼──────────────────────────────────────────────────────────────────────────────┘
                   ▼
   Node.js + Express: статика (dist/) + GET /api/health. Файл отчёта на сервер НЕ загружается.
```

Data flow: файл → `FileReader.readAsText` → `parseReport(text)` (02) → `ViewerState.report`
→ производные значения (memo по `(report, params)`): комнаты уже в `ParsedReport`;
`buildWallBoxes(report.map, S, T)` (03) → R3F-сцена. Смена параметров не требует
перепарсинга — только пересчёт геометрии стен и мировых размеров.

## 2. Ключевые решения

### 2.1 Где живёт логика: клиент или сервер

**Варианты:** А) вся логика на клиенте (парсинг отчёта и геометрия — чистые TS-модули
в браузере, Express только статика); Б) серверный API принимает файл, вызывает Python
`space_manager` и отдаёт JSON-модель.

**Решение: А.** Причины:

- сценарий «загрузил → смотрю» самодостаточен в браузере: файл читается через
  `<input type=file>`, сервер для этого не нужен (вводная №4);
- вариант Б тянет Python-зависимость на Node-сервер без прироста функциональности:
  viewer НЕ запускает солвер и НЕ редактирует файлы; парсинг отчёта — детерминированный
  текстовой процесс, полностью покрываемый TS (контракт формата — [02](./02-input-parser.md) §1);
- клиентская логика — чистые модули, unit-тестятся без DOM (см.
  [05-testing-acceptance](./05-testing-acceptance.md) §2);
- серверное хранение между сессиями исключено вводной №4.

Последствие: **API Express минимален** (`GET /api/health` + статика, §6). Слой `fetch`
вынесен в `lib/api.ts` — будущие серверные эндпоинты не потребуют переделки UI.

### 2.2 3D-рендер: three.js + react-three-fiber + drei

**Варианты:** А) raw WebGL; Б) CSS 3D transforms; В) Python (pythreejs/trimesh, экспорт
.glb в браузер); Г) **three.js + @react-three/fiber (R3F) + @react-three/drei**.

**Решение: Г.** Причины:

- сцена состоит из примитивов (боксы стен/блоков, плоскости полов, подписи-текст,
  орбитальная камера) — ровно то, что дают three.js + drei (`OrbitControls`, `Html`);
- R3F описывает сцену декларативно на React-компонентах: выбор комнаты, прозрачность
  стен и другие состояния UI автоматически привязываются к материалам/матрицам —
  меньше imperative-кода, чем в raw WebGL;
- вариант В отклонён вводной №4 (отдельный веб-сервис на стеке React/Vite/TS);
- варианты А/Б не дают качества и экосистемы (raycast, controls, Html-подписи) без
  собственного кода.

**Варианты версий:** React 18 → `@react-three/fiber` v8 + `@react-three/drei` v9;
React 19 → fiber v9 + drei v10. **Решение:** фиксировать связку, совместимую с
`react@18.3` (как в `editor/`): `three ^0.169.0`, `@react-three/fiber ^8.17.10`,
`@react-three/drei ^9.114.3`.

### 2.3 Состояние приложения

**Решение:** единый `ViewerState` на клиенте, управляется через React-хук
(`useReducer`) + контекст (тот же паттерн, что `editor/src/state/editorStore.ts`).

```ts
interface ViewerState {
  report: ParsedReport | null;   // результат парсера (модель — 02 §3); null = файл не загружен
  fileName: string | null;       // basename загруженного файла (для статуса/снапшота)
  params: ViewParams;            // параметры отображения (таблица — 04 §3)
  selection: number | null;      // index выбранной комнаты (ParsedReport.rooms[i].index) или null
  cameraPreset: 'iso' | 'top' | 'front';   // последний применённый пресет (04 §4.4)
}

interface ViewParams {
  scale: number;          // S — мировых единиц на клетку, дефолт 1        (03 §1)
  wallHeight: number;     // Hw, дефолт 3                                  (03 §9)
  wallThickness: number;  // T,  дефолт 0.25                               (03 §5)
  unitLabel: string;      // подпись единицы, дефолт 'м'                    (README §3 п.3)
  showBlocked: boolean;   // показывать blocked-блоки, дефолт true          (03 §8)
  wallsOpacity: number;   // 0..1, дефолт 1                                 (04 §3)
  hideWalls: boolean;     // полное скрытие стен, дефолт false              (04 §3)
  showLabels: boolean;    // подписи комнат на сцене, дефолт true           (04 §8)
}
```

Производные значения (не хранятся, мемоизируются): `wallBoxes = buildWallBoxes(
report.map, params.scale, params.wallThickness)` (03 §6), палитра цветов символов
(`palette.ts`, 02 §8), мировые размеры сетки.

Действия редьюсера (исчерпывающий список — разработка реализует ровно эти):

| Action | Источник | Эффект |
|---|---|---|
| `REPORT_LOADED { report, fileName }` | FilePanel: успешный парсинг файла | полная замена `report`/`fileName`; `selection = null`; пресет → «Изометрия» (04 §4.4) |
| `PARAMS_SET { patch }` | ParamsPanel: любое изменение параметра | точечное обновление `params` (пересчёт геометрии — в эффекте, 03 §10) |
| `SELECT_ROOM { roomId: number \| null }` | RoomsPanel / клик в сцене / Esc | выделение комнаты; при выборе из списка — фокус камеры (04 §5) |
| `CAMERA_PRESET { preset }` | Toolbar / клавиши 1–3 | позиция/цель камеры по таблице 04 §4.4 |
| `RESET_PARAMS {}` | ParamsPanel: «Сбросить параметры» | `params` → дефолты (таблица 04 §3) |

Ошибки парсинга в состояние не пишутся (`report` остаётся предыдущим/null) — они
отображаются из `ReportParseError.issues` локально в FilePanel/баннере (04 §2, §9).

Refresh страницы = потеря загруженного отчёта; несохранённого нет — предупреждение
beforeunload НЕ требуется (отличие от редактора).

### 2.4 Структура папок проекта

**Решение:** отдельный корень `viewer3d/` в репозитории (аналог `editor/`, см.
решение 01-architecture ТЗ редактора §2.4) — Node/React-проект не живёт внутри
Python-пакета. Структура:

```
space-manager/                       # корень репозитория (без изменений)
├── README.md, docs/, space_manager/, examples/, tests/ ...
├── docs-editor/, editor/            # существующие компоненты (НЕ трогать)
├── docs-viewer3d/                   # это ТЗ
└── viewer3d/                        # НОВЫЙ: самостоятельный npm-проект
    ├── package.json                 # name "space-viewer3d"; deps и devDeps — §2.5
    ├── tsconfig.json                # strict: true (как в editor/)
    ├── vite.config.ts               # dev-сервер 5174, proxy /api → localhost:3200 (§6)
    ├── server/
    │   └── index.ts                 # Express: статика dist/ + /api/health (паттерн editor/server/index.ts)
    ├── src/
    │   ├── main.tsx                 # точка входа SPA
    │   ├── App.tsx                  # layout: FilePanel+ParamsPanel | 3D-canvas | RoomsPanel/Info/Legend (04 §2)
    │   ├── state/viewerStore.ts     # useReducer + контекст, ViewerState (§2.3)
    │   ├── lib/                     # ЧИСТЫЕ модули без React/three — ядро unit-тестов:
    │   │   ├── reportParser.ts      # parseReport(text) → ParsedReport (02 §4–§6)
    │   │   ├── walls.ts             # boundaryEdges / mergeSegments / buildWallBoxes (03 §3–§6)
    │   │   ├── palette.ts           # PALETTE + назначение цветов символам (02 §7)
    │   │   └── api.ts               # fetch /api/health (единственный HTTP-слой)
    │   ├── scene/                   # R3F-компоненты (трёхмерная сцена):
    │   │   ├── Scene.tsx            # Canvas, свет, фон, OrbitControls, пресеты камеры (04 §4)
    │   │   ├── RoomFloor.tsx        # пол одной комнаты (mesh из клеток, выбор/подсветка)
    │   │   ├── Walls.tsx            # InstancedMesh всех боксов стен (прозрачность/скрытие)
    │   │   ├── BlockedBoxes.tsx     # InstancedMesh blocked-блоков
    │   │   └── RoomLabels.tsx       # подписи (drei Html) по комнатам
    │   ├── components/
    │   │   ├── FilePanel.tsx        # загрузка файла, статус отчёта
    │   │   ├── ParamsPanel.tsx      # числовые параметры + тумблеры + сброс (04 §3)
    │   │   ├── RoomsPanel.tsx       # список комнат, выбор → фокус камеры (04 §5)
    │   │   ├── InfoPanel.tsx        # карточка выбранной комнаты (04 §6)
    │   │   ├── Legend.tsx           # symbol → цвет → type id
    │   │   ├── WarningsBanner.tsx   # предупреждения W-* + блок «НЕ УДАЛОСЬ…» (02 §5, 04 §9)
    │   │   └── Toolbar.tsx          # пресеты видов + кнопка PNG-снапшота (04 §4.4, §10)
    │   └── i18n/ru.ts               # все строки UI (RU — единственный язык; 04 §11)
    └── tests/
        ├── fixtures/                # эталонные отчёты для тестов (05 §2.1)
        ├── unit/                    # vitest: reportParser, walls, palette (05 §2–§3)
        └── e2e/                     # playwright: сквозные сценарии (05 §4)
```

### 2.5 Зависимости и их обоснование

| Зависимость | Версия | Зачем |
|---|---|---|
| `react`, `react-dom` | ^18.3.1 | UI (та же версия, что в `editor/`) |
| `three` | ^0.169.0 | 3D-рендеринг (§2.2) |
| `@react-three/fiber` | ^8.17.x | React-составной three.js (совместимо с React 18) |
| `@react-three/drei` | ^9.114.x | `OrbitControls`, `Html` (подписи), утилиты камеры (§2.2) |
| `express` | ^4.x | статика + `/api/health` (вводная №4) |
| `vite` + `@vitejs/plugin-react` | ^6 / ^4 | dev-сервер + сборка (вводная №4) |
| `typescript` | ^5.7 | `strict: true` |
| `vitest` | ^3 | unit-тесты чистых модулей (05 §2) |
| `@playwright/test` | ^1.6x | e2e (05 §4) |
| `tsx`, `concurrently` | — | запуск `server/index.ts`, dev-режим (паттерн `editor/package.json`) |
| `@types/react`, `@types/react-dom`, `@types/node`, `@types/three`, `@types/express` | — | типизация |

**Решение:** других runtime-зависимостей не вводится: state — useReducer (без state-либ),
вёрстка — CSS без UI-фреймворка, YAML-библиотека НЕ нужна (вход — текст отчёта, не YAML).

### 2.6 Запуск

**Dev:**

```bash
cd viewer3d
npm install
npm run dev        # параллельно: vite (5174, HMR) + express (3200);
                   # vite proxy переводит /api → localhost:3200
# браузер: http://localhost:5174
```

**Prod:**

```bash
npm run build      # tsc --noEmit && vite build → viewer3d/dist/
npm start          # express раздаёт dist/ (статика + SPA-fallback), порт 3200 (env PORT)
# браузер: http://localhost:3200
```

**Порты.** **Решение:** prod-порт `viewer3d` = **3200** (а не 3000 у `editor/`), dev-vite
= **5174** — чтобы редактор и viewer могли работать одновременно. e2e поднимает сервер
на порту **3210** (05 §4). SPA-fallback: любой GET-путь, кроме `/api/*` и существующей
статики, отдаёт `dist/index.html` (копируется поведение `editor/server/index.ts`).

### 2.7 Последовательность базового сценария «загрузил → смотрю»

```
Пользователь        Browser (React SPA)                    Express
    │                      │                                    │
    │ 1. выбрать result-*. ├──── File Input ────────────────────┤
    │◄─────────────────────┤ FileReader.readAsText ('utf-8')    │
    │                      │ parseReport(text) → ParsedReport   │
    │                      │   ошибки V-* → баннер, сцена пуста │
    │                      │   успех → memo: buildWallBoxes(...)│
    │ 2. крутит камеру,    │ OrbitControls / пресеты (04 §4)    │
    │   меняет параметры   │ dispatch(PARAMS_SET) → пересчёт    │
    │   (Hw/T/S), кликает  │ геометрии стен + мировые размеры   │
    │   по комнатам        │ selection → подсветка + InfoPanel  │
    │ 3. «Снапшот PNG»     │ renderer.toBlob → <a download>     │
    │◄────── браузер сохраняет файл ─────────────────────────────┤
```

Express участвует только в стартовом `GET /api/health` (статус-строка UI) и раздате статики.

### 2.8 Граница совместимости с space-manager

Единственный формальный контракт — **текстовый формат отчёта**:

1. источник истины — `space_manager/report.py::build_report` / `render_grid` /
   `format_table` и `space_manager/cli.py::_place` (запись `report_text + "\n"`);
2. полевой контракт зафиксирован в [02-input-parser](./02-input-parser.md) §1 — этот
   раздел ТЗ является спецификацией для парсера;
3. viewer НЕ импортирует Python и не зависит от него в runtime; совместимость
   гарантируется приёмочным сквозным тестом «свежесгенерированный отчёт CLI отображается
   корректно» ([05](./05-testing-acceptance.md) §5).

Известное свойство формата, влияющее на архитектуру: отчёт **не содержит** явной
таблицы соответствий «символ карты → id типа» (карта — символы, таблица — type_id);
поэтому метки комнат присваиваются эвристикой ([02](./02-input-parser.md) §6).
