# 04. Адаптация редактора и viewer3d под проектный режим

> Сводный индекс: [../docs-unified/README.md](./README.md) · API:
> [02-workspace-api](./02-workspace-api.md) · ТЗ исходных компонентов: `../docs-editor/`,
> `../docs-viewer3d/`

Общее правило: **чистая клиентская логика (lib, парсеры, валидация, canvas, сцена,
геометрия) не переписывается**. Меняются только «коннекторные» файлы — панели
загрузки/скачивания и HTTP-слой — плюс однострочные правки конфигов. Перечень
допустимых изменений закрытый: всё, что не перечислено ниже, трогать нельзя.

## 1. Редактор (`editor/`) — проектный режим

### 1.1 Что меняется и почему standalone-режим уходит

| Было (standalone) | Станет (проектный режим) |
|---|---|
| Загрузка spec.yaml / масок с диска пользователя (file input, drag&drop) | Выбор проекта из списка → файлы читаются с сервера (`GET …/file`) |
| Скачивание spec.yaml / масок (Blob + `<a download>`) | Кнопка «Сохранить в проект» → `PUT …/files` |
| Нет связи с генерацией | Кнопка «Генерировать размещение» → `POST …/generate` |

Вводная: проектный режим **полностью заменяет** standalone (загрузка файлов
пользователем больше не нужна — импорт проектов живёт в менеджере, [03](./03-manager-ui.md) §2).

### 1.2 Файлы, которые изменяются (замыкательный список)

| Файл | Изменение |
|---|---|
| `src/components/FilesPanel.tsx` | Переработан в **ProjectFilesPanel** (тот же файл, новая логика): селектор проектов + статусы файлов + «Сохранить в проект» + «Генерировать размещение» + блок результата. Секции W×H, «＋ Создать спеку…», управления масками (Добавить/Удалить) и предупреждений о неизвестных полях **сохраняются** — они оперируют моделью, а не файлами |
| `src/lib/api.ts` | Дополнен функциями проектного API (§1.4); `getHealth` остаётся |
| `src/i18n/ru.ts` | Новые строки (селектор, сохранение, генерация, результат); неиспользуемые строки скачивания могут остаться без удаления |
| `vite.config.ts` | `base: '/editor/'` + proxy `/api → http://localhost:4080` (§1.7) |
| `server/index.ts` | Двойной mount статики для standalone-совместимости ([01](./01-architecture.md) §3.4) — по одной строке |

НЕ изменяются: `src/lib/{specYaml,maskText,validation,gridView,typeColors,fileUtils,
types}.ts`, `src/components/{GridCanvas,ClustersPanel,TypesPanel,RulesPanel,
ValidationBanner}.tsx`, `src/state/editorStore.ts`, `src/App.tsx` (кроме, возможно,
заголовка с кнопкой «← К проектам»).

### 1.3 Логика ProjectFilesPanel

**Состояние панели** (локальное React-состояние, store не меняется):
`projects: ProjectInfo[] | null`, `selected: string | null`, `loading: bool`,
`savedAt: Date | null`, `generating: bool`, `genResult: {resultFile, exitCode, feasible, report} | null`.

**Загрузка проекта** (при выборе в селекторе и при старте с `?project=`):

1. `GET /api/projects` → заполнить селектор (один раз на mount; повтор — по кнопке
   обновления после создания проекта в менеджере не требуется).
2. `GET …/<p>/file?name=spec.yaml` → `parseSpecWithWarnings(text)`; перед
   `dispatch({type:'SPEC_LOADED', doc})` **нормализация имён масок в памяти**: если
   `doc.blockedFile !== null`, заменяем basename на `blocked.txt`; аналогично
   `presetFile` → `preset.txt`. Это нужно, т.к. store (`MASK_LOADED`) пишет имя маски
   в поле спеки только когда оно null — без нормализации импортированная спека с
   нестандартным именем маски после сохранения продолжала бы ссылаться на старый файл.
   Неизвестные поля → существующая заметка (паттерн из FilesPanel, `notice`).
3. Маски: читать файл, если в (нормализованной) спеке поле не null:
   `GET …/file?name=<basename>` → `parseBlockedMaskAny` →
   `dispatch({type:'MASK_LOADED', kind:'blocked', mask, fileName:'blocked.txt'})`;
   аналогично preset через `parsePresetMaskAny(text, typeSymbols)` с пробросом
   `presetErrors` и `fileName:'preset.txt'`. `fileName` в dispatch — каноническое имя.
   Если импортированная спека ссылалась на нестандартное имя (напр.
   `blocked_basic.txt`) — содержимое читается из него, но после первого «Сохранить в
   проект» маске назначается канонический файл, а старый остаётся осиротевшим
   ([02](./02-workspace-api.md) §8). Если файла нет (404) — маска не загружается, в
   статусе секции: «файл не найден на сервере» (не ошибка валидации).
4. Любая ошибка шагов 2–3 → красный баннер панели с текстом ошибки; состояние до
   этой загрузки НЕ сбрасывается (как при ошибке FileReader в viewer3d).

**Dirty-отслеживание:** полностью существующее (`isDirty()`/`markClean()`,
beforeunload, dirty-маркеры файлов в FilesPanel) — сохраняется без изменений.
Маркер «изменено ●» теперь висит на кнопке «Сохранить в проект».

### 1.4 Функции `src/lib/api.ts` (новый HTTP-слой редактора)

```ts
interface ProjectInfo { id: string; name: string; createdAt: string; updatedAt: string; latestResult: string | null }
listProjects(): Promise<ProjectInfo[]>                         // GET /api/projects
loadProjectFile(name: string, file: string): Promise<string>   // GET …/file?name=…
saveProjectFiles(name: string, files: Record<string,string>): Promise<{saved:string[],deleted:string[]}>
generatePlacement(name: string): Promise<{resultFile:string; exitCode:number; feasible:boolean; report:string}>
```

Все функции бросают `Error` с русским текстом из JSON-ошибки API (`{error,message}`).

### 1.5 Кнопка «Сохранить в проект»

Payload строится из текущего состояния store (имена канонические):

| Файл | Источник | Когда включается в payload |
|---|---|---|
| `spec.yaml` | `dumpSpec(state.spec)` | всегда (кнопка неактивна без спеки) |
| `blocked.txt` | `dumpMask(state.blockedMask)` | если `state.blockedMask !== null` |
| `preset.txt` | `dumpMask(state.presetMask)` | если `state.presetMask !== null` |

Маска, удалённая в редакторе (`MASK_CLEARED` → `null`, поле спеки `null`), НЕ
включается — сервер удалит файл ([02](./02-workspace-api.md) §6.9). После успеха:
`markClean()`, сброс dirty-маркеров, статус «Сохранено в 13:15». Ошибки — баннер.

### 1.6 Кнопка «Генерировать размещение» и блок результата

Последовательность по клику (одна кнопка, один спиннер):

1. Если `isDirty()` → сначала выполнить «Сохранить в проект» (§1.5); ошибка
   сохранения прерывает генерацию (генерация работает с тем, что на диске).
2. `POST …/<p>/generate` — индикатор «Генерация размещения… (обычно несколько секунд)».
   Кнопки панели блокируются на время запроса; таймаут клиента не нужен (серверный
   60 с вернёт 504).
3. Блок результата под кнопкой:
   - **exit 0**: зелёная строка «Размещение найдено: `result-<ts>.txt`» + ссылки
     `[Открыть в Viewer3D]` (`/viewer3d?project=<p>&result=<file>`) и свёрнутый
     `<details>` «Отчёт солвера» с полным текстом `report`.
   - **exit 1 (infeasible)**: красная строка «Не удалось разместить все кластеры.» +
     текст причины — строки отчёта ДО маркера `== КАРТА ==` (блок невозможности,
     формат `spaec_manager/report.py::infeasible_block`) + тот же `<details>` с
     полным отчётом.
   - **HTTP-ошибка** (422/504): красный баннер с `message` API; при 422 подсказка
     «Исправьте ошибки валидации и повторите» (ошибка входа солвера почти всегда =
     ошибки V-* из баннера редактора).

### 1.7 Конфиги

`vite.config.ts`: `base: '/editor/'`; proxy `/api → http://localhost:4080`
(был :3000). `server/index.ts`: добавить `app.use('/editor', express.static(distDir))`
(двойной mount, [01](./01-architecture.md) §3.4).

### 1.8 URL-параметр

При mount: `new URLSearchParams(location.search).get('project')` — если задан и есть в
списке → автовыбор; если нет в списке → баннер «Проект «x» не найден» + пустой
селектор. Смена выбора — `history.replaceState` с новым `?project=` (чтобы back/forward
и пересылка ссылки работали).

## 2. Viewer3d (`viewer3d/`) — проектный режим и ревизии

### 2.1 Что меняется

| Было | Станет |
|---|---|
| Загрузка `result-*.txt` с диска (file input + drag&drop, FileReader) | **Селектор проекта** + **селектор ревизий** `result-*`; файл подгружается с сервера |
| PNG-снапшот скачивается на диск (`<a download>`, `viewer3d-snapshot-<ts>.png`) | PNG **сохраняется в проект**: `POST …/<p>/preview` → `preview/<ts>.png`; это фича «сохранение вида визуализации» |
| Кнопки скачивания файлов | отсутствуют (в viewer3d их и не было, кроме снапшота — он переехал в проект) |

**Ключевая фича**: переключение между ревизиями генерации без потери работы —
выбор другого `result-*` просто подгружает другой файл.

### 2.2 Файлы, которые изменяются (замыкательный список)

| Файл | Изменение |
|---|---|
| `src/components/FilePanel.tsx` | Переработан в **ProjectPanel**: два селектора + статусы + кнопка обновления списка ревизий. Баннер ошибок парсинга (`parseError`) — без изменений по логике |
| `src/state/viewerStore.tsx` | В `ViewerState` добавляются поля `projectName: string \| null` и `resultName: string \| null`; action `REPORT_LOADED` дополняется payload-полями `projectName`, `resultName` (текущее поле `fileName` остаётся = имя result-файла). Прочие actions — без изменений |
| `src/scene/snapshot.ts` | Реестр расширяется: рядом с обработчиком кадра регистрируется **цель сохранения** `setSnapshotTarget({projectName} \| null)` (вызывается из ProjectPanel при загрузке отчёта); `takeSnapshot()` получает асинхронный контракт `Promise<SnapshotResult>`: `{savedToProject: string}` или `{downloaded: string}` |
| `src/scene/Scene.tsx` | ТОЛЬКО блок `SnapshotBinder` (PNG): вместо `<a download>` — `POST /api/projects/<p>/preview` с body Blob; при отсутствии проекта — fallback на локальное скачивание как сейчас. Остальная сцена не меняется |
| `src/lib/timestamp.ts` | Добавлена `previewFileName(d)` → `preview-<YYYYmmdd-HHMMSS>.png` (формат timestamp тот же); старая `snapshotFileName` остаётся для fallback-скачивания |
| `src/lib/api.ts` | Функции: `listProjects()`, `listResults(project)`, `loadResultFile(project, file)` — как в §1.4 редактора (та же форма) |
| `src/App.tsx` | Строка статуса дополнена именем проекта и ревизии; кнопка «← К проектам» в заголовке |
| `vite.config.ts` | `base: '/viewer3d/'` + proxy `/api → http://localhost:4080` (был :3200) |
| `server/index.ts` | Двойной mount статики ([01](./01-architecture.md) §3.4) |

НЕ изменяются: `src/lib/{reportParser,walls,palette}.ts`, `src/scene/{cameraMath,roomFloor,useWallBoxes}.ts` (кроме `Scene.tsx::SnapshotBinder`), панели `ParamsPanel/RoomsPanel/InfoPanel/Legend/Toolbar/WarningsBanner` (Toolbar — без изменений: кнопка PNG остаётся на месте).

### 2.3 Логика ProjectPanel

1. `GET /api/projects` → селектор проектов; при выборе:
   `GET …/<p>/results` → селектор ревизий; автовыбор = первый (самый свежий) элемент,
   либо `?result=<file>` из URL, если он есть в списке.
2. Загрузка ревизии: `loadResultFile(p, f)` → `parseReport(text)` →
   `dispatch({type:'REPORT_LOADED', report, fileName:f, projectName:p, resultName:f})`
   + `setSnapshotTarget({projectName:p})`. Ошибка парсинга — существующий баннер.
3. Статусный блок (был у FilePanel) сохраняется: имя файла → теперь «проект: p ·
   файл: f», сетка, число комнат, метка infeasible, число предупреждений.
4. Смена ревизии при уже загруженном отчёте — без подтверждения (данные только в
   памяти; несохранённого нет — viewer ничего не редактирует).

### 2.4 PNG-снапшот → `preview/`

Поток: клик [PNG] в Toolbar → `takeSnapshot()` → `SnapshotBinder`:
`gl.domElement.toBlob` → если цель задана: `POST /api/projects/<p>/preview`
(body blob, `Content-Type: image/png`) → 201 `{file}` → строка статуса на 5 с:
«Предпросмотр сохранён в проект: preview-<ts>.png». Ошибка POST — баннер
«Не удалось сохранить предпросмотр: …». Без цели (проект не выбран — возможно только
в dev) — fallback: локальное скачивание `snapshotFileName()` как сейчас.

Имя файла задаёт сервер ([02](./02-workspace-api.md) §6.13); клиентское имя из
`previewFileName()` используется только для fallback-скачивания.

### 2.5 URL-параметры

`?project=<slug>` — автовыбор проекта; `?result=<имя>` — автовыбор ревизии (при
отсутствии в списке игнорируется). Ссылки формируются: менеджер ([03](./03-manager-ui.md) §2),
редактор (§1.6), модалка превью не ссылается на viewer.

## 3. Единый стиль и общие css-классы

`app/src/styles.css` содержит общий набор классов (`.panel`, `.muted`, `.toolbar`,
баннеры) — копия/обобщение `viewer3d/src/styles.css`. Подключение в editor/viewer3d:
**не обязательно** для v1 — их существующие стили работают; требование лишь
визуальной согласованности (системный шрифт, 14 px, те же цвета акцентов). Если при
реализации появятся расхождения — правятся только css, не компоненты.

## 4. Тестирование адаптаций (сводка; детали — [05](./05-testing-acceptance.md))

- Unit-тесты lib редактора/viewer3d **не меняются** (lib не трогаем).
- E2E editor: сценарии загрузки/скачивания файлов заменяются на моки API
  (`page.route('/api/**')`); новые сценарии: выбор проекта → статусы; сохранение →
  проверка тела PUT; генерация → мок-ответ → блок результата (exit 0 и exit 1).
- E2E viewer3d: загрузка через селекторы (моки API); снапшот — перехват POST
  `/api/projects/p/preview` (проверка Content-Type и PNG-магических байтов тела).

## 5. Открытые решения

1. Кнопка «Обновить список» в селекторах (актуальность после генерации из редактора)
   — в v1 списка ревизий переспрашивается при каждой смене проекта; ручное
   обновление — v2 (свежая ревизия видна сразу после перехода по ссылке из редактора,
   этого достаточно).
2. Отображение в viewer3d предупреждений солвера отдельным баннером уже реализовано
   (`WarningsBanner` по `warningsSection`) — без изменений.
