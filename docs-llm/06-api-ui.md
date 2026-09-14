# 06. API и UI (LLM-эндпоинты, раздел «LLM-генерация» в редакторе)

> Сводный индекс: [README.md](./README.md) · Цикл/журнал: [05-agent-loop-limits](./05-agent-loop-limits.md) ·
> Протокол: [03-protocol-json](./03-protocol-json.md) · Тесты: [07-testing-acceptance](./07-testing-acceptance.md).

## 1. API (Node/Express, `app/server/index.ts`)

Все эндпоинты добавляются в существующий `createApp()` паттернами проекта:
`asyncH`-обёртка, ошибки — `ApiError` → `{ error: CODE, message: RU }`, проекты
используются через `requireProjectDir`. **Одна активная LLM-сессия на проект** —
через ту же очередь проекта (`createProjectQueue`).

### 1.1 `GET /api/llm/providers` → провайдеры + модели

Ответ (ключи в ответе **не передаются**):

```jsonc
{ "configured": true,
  "defaultModel": "eac-mac-ai/Qwen3.6-35B-A3B-UD-Q6_K.gguf",
  "providers": [
    { "id": "eac-home-ai",
      "models": [
        { "id": "Qwen3.6-35B-A3B-UD-Q6_K.gguf", "label": "лучшая локальная" },
        { "id": "another-model.gguf", "label": null } ] } ] }
```

- без/с невалидным `llm.config.json` → `{ "configured": false, "reason": "..." }` (200; 02 §5);
- модели — авто-опрос `{url}/v1/models` с кэшем TTL ~60 c (02 §4); недоступный провайдер
  отдаётся со списком моделей из (стального) кэша либо `models: []`.

### 1.2 `POST /api/projects/:p/llm-generate` → старт прогона

Тело:

```jsonc
{ "prompt": "сделай коридор поменьше, комнаты ближе к целям",   // строка, 1..4000 символов
  "modelId": "eac-mac-ai/Qwen3.6-35B-A3B-UD-Q6_K.gguf",        // "<provider>/<modelId>", provider ∈ конфиг
  "limits": {                                                  // опционально; незаданные → дефолты 05 §2
    "maxIterations": 5, "timeBudgetPerRun": 2.0 } }
```

Ответ **202**: `{ "sessionId": "20260913-200232" }` (id = имя журнала, 05 §5). Сессия
стартует асинхронно; цикл — [05](./05-agent-loop-limits.md) §1. Ошибки:

| Код | HTTP | Когда |
|---|---|---|
| `LLM_INVALID_BODY` | 400 | пустой/некорректный `prompt`; нечисловые или ≤ 0 лимиты (`maxIterations`, `timeBudgetPerRun`); `maxIterations > 50`; неизвестные поля `limits`. Старое поле `totalTimeoutSec` **молча игнорируется** (совместимость со старым UI, LST-7) |
| `LLM_NOT_CONFIGURED` | 503 | `llm.config.json` отсутствует/невалиден (02 §5) |
| `LLM_UNKNOWN_MODEL` | 422 | provider из `modelId` не в конфиге |
| `LLM_SESSION_ACTIVE` | 409 | у проекта уже есть сессия `running` |

### 1.3 `GET /api/projects/:p/llm-status?session=<id>` → состояние прогона

UI опрашивает раз в **~1.5 c** — зафиксированный ВАРИАНТ «б»; **SSE НЕ делать**.

```jsonc
{ "state": "running",                        // running | done | stopped | error (= status журнала, 05 §4)
  "log": [                                    // шаги с начала (журнал + финальная строка)
    { "n": 1, "action": "run_generation", "ok": true, "summary": "…result-20260913-200232.txt (exit 0)" } ],
  "candidates": [ { "file": "…", "comment": "…" } ],   // только при done
  "recommended": "…",                          // только при done и если был указан
  "note": "…",                                 // опционально: авто-завершение по стагнации (05 §2.1)
  "error": null,                              // текст причины при stopped/error
  "startedAt": "…", "finishedAt": null }
```

Неизвестный `session` → 404 `LLM_NO_SESSION`. Ответ строится из живого состояния
сессии/журнала; после терминального состояния — стабильно из файла журнала.

### 1.4 `POST /api/projects/:p/llm-stop` → остановка

200 `{ "state": "stopping" }` (флаг + SIGKILL child-процесса, 05 §4); если сессия уже
терминальна — 200 с текущим `state`. Неизвестный `session`/нет активной → 404
`LLM_NO_SESSION`.

### 1.5 `GET /api/projects/:p/llm-sessions` и `.../llm-sessions/:id`

- список: `{ "sessions": [ { "sessionId", "status", "modelId", "promptPreview" /*первые 120 символов*/,
  "startedAt", "finishedAt" } ] }`, newest-first (по имени файла — имя несёт timestamp);
- полный: содержимое журнала `llm-sessions/<id>.json` без изменений (05 §5); отсутствующий
  id → 404 `LLM_NO_SESSION`.

## 2. UI (редактор, `editor/`)

### 2.1 Место и принцип

Новый раздел **«LLM-генерация»** — в панели генерации рядом с существующей кнопкой
**«⚡ Генерировать размещение», которая ОСТАЁТСЯ без изменений** (запуск генератора
без LLM, `POST .../generate`). Новый компонент `editor/src/components/LlmPanel.tsx`
(паттерны существующих панелей: useReducer-store, CSS без UI-фреймворка). Все строки —
в i18n **`editor/src/i18n/ru.ts`**, новый блок `llm: { … }` (RU — единственный язык).

### 2.2 Элементы раздела

| Элемент | Поведение |
|---|---|
| Textarea промпта | текст запроса; пустой → «Запустить» недоступна |
| Выпадающий список моделей | из `GET /api/llm/providers`: «provider/modelId (подпись)»; дефолт — `defaultModel`; при сбое опроса отдельных моделей — то, что удалось получить |
| Поля лимитов | два числовых поля с **дефолтами-плейсхолдерами: 5 / 2.0** (maxIterations / timeBudgetPerRun); пустые поля = дефолты — в тело `limits` не передаются. Жёсткого временного лимита сессии нет (LST-7): старое поле totalTimeoutSec, если приходит от старого UI, сервер молча игнорирует |
| «Запустить» | `POST .../llm-generate`; пока сессия активна — заменена на «Стоп» (`POST .../llm-stop`) |
| Лог шагов (вживую) | опрос `GET .../llm-status` раз в **~1.5 c** (вариант «б», без SSE): строки шагов «N. action — summary (ok/ошибка)»; по терминальному состоянию опрос останавливается |
| Кандидаты (по завершении) | список: имя файла, комментарий LLM, отметка **«рекомендовано»**; у каждого — ссылка **«Открыть в Viewer3D»**: `/viewer3d/?project=<slug>&result=<file>` (существующий URL viewer3d). Выбор за пользователем |
| Последняя сессия | при отсутствии активной сессии панель показывает **последнюю** из `GET .../llm-sessions` (состояние, лимиты, лог, кандидаты) — 05 §5 |

### 2.3 Состояние «LLM не настроен»

При `configured: false` (02 §5): в разделе строка **«LLM не настроен»** + подсказка
(создать `llm.config.json` по шаблону `llm.config.example.json`); select моделей, поля
лимитов и «Запустить» **недоступны**; остальной редактор (включая обычную генерацию)
работает без изменений.

### 2.4 Ошибки UI

- 409 `LLM_SESSION_ACTIVE` → строка «Уже идёт LLM-прогон: <state>» (панель переходит в режим наблюдения этой сессии);
- 503/422/400 — текст `message` из ответа API (RU) под кнопкой;
- ошибка опроса статуса (сеть) → повтор следующего тика, без сброса состояния.
