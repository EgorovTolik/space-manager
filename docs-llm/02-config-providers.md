# 02. Конфигурация провайдеров LLM (llm.config.json)

> Сводный индекс: [README.md](./README.md) · Архитектура: [01-architecture](./01-architecture.md) ·
> Протокол: [03-protocol-json](./03-protocol-json.md) · API/UI: [06-api-ui](./06-api-ui.md).

## 1. Место хранения и git-политика

**Решения (зафиксированы):**

1. Файл конфигурации — **`llm.config.json` В КОРНЕ ПРОЕКТА**
   `/Users/anatoliy/piProjects/space-manager/llm.config.json`. Читается только
   Node-сервером (`app/server/llm/config.ts`); браузер не получает ни файла, ни ключей.
2. `llm.config.json` **добавляется в `.gitignore`** (ключи не коммитить).
3. В репозиторий попадает **только `llm.config.example.json`** — тот же формат и те же
   четыре провайдера, но `apiKey: "ПРЕДСТАВЬТЕ_КЛЮЧ"` в каждой записи.

## 2. Формат файла

Формат совпадает с `/Users/anatoliy/piProjects/multiagents/config.json` (поля
`providers`, `defaultModel`; без полей multiagents-сервера):

```jsonc
{
  "providers": {
    "<имя провайдера>": {
      "url": "<OpenAI-совместимый base url>",   // без завершающего "/" (не обязательно)
      "apiKey": "..."                          // Bearer-токен для /v1/*
    }
  },
  "defaultModel": "eac-mac-ai/Qwen3.6-35B-A3B-UD-Q6_K.gguf",   // строка "<provider>/<modelId>"
  "labels": {                                   // опциональные подписи моделей для UI
    "<provider/model>": "подпись"               // напр. "лучшая локальная"
  }
}
```

Поля:

| Поле | Тип | Обязательность | Семантика |
|---|---|---|---|
| `providers` | объект | да (пустой `{}` — невалидно) | карта `<имя>` → `{url, apiKey}`; имя `[a-z0-9_-]{1,40}` |
| `providers.<id>.url` | строка | да | base URL OpenAI-совместимого API; запросы идут на `{url}/v1/models` и `{url}/v1/chat/completions` |
| `providers.<id>.apiKey` | строка | да (пустая — невалидно) | отправляется заголовком `Authorization: Bearer <apiKey>` |
| `defaultModel` | строка | да | дефолтная модель для старта, формат `<provider>/<modelId>`; provider обязан быть в `providers` |
| `labels` | объект | нет (дефолт `{}`) | ключ — полная строка `<provider>/<modelId>`, значение — человекочитаемая подпись для выпадающего списка UI |

## 3. Изначальные четыре провайдера

Значения копируются из `/Users/anatoliy/piProjects/multiagents/config.json`:

| id | url | apiKey | label |
|---|---|---|---|
| `eac-mac-ai` | `http://localhost:44221` | `kv-123` | — |
| `eac-home-ai` | `http://eac-agent.online:44221` | `kv-123` | «лучшая локальная» (label вешается на используемые модели провайдера) |
| `eac-work-ai` | `http://eac-agent.online:44222` | `kv-123` | — |
| `gl-hub` | `https://litellm-master.dev2.k8s.eltc.ru` | значение поля `apiKey` провайдера `gl-hub` в multiagents/config.json (копировать при setup; в доки полный ключ не выносится, чтобы секрет не попал в git) | — |

**Дефолтная модель для старта:** `eac-mac-ai/Qwen3.6-35B-A3B-UD-Q6_K.gguf`
(поле `defaultModel`, §2).

Содержимое примера (`llm.config.example.json`, в git):

```json
{
  "providers": {
    "eac-mac-ai":   { "url": "http://localhost:44221",       "apiKey": "ПРЕДСТАВЬТЕ_КЛЮЧ" },
    "eac-home-ai":  { "url": "http://eac-agent.online:44221", "apiKey": "ПРЕДСТАВЬТЕ_КЛЮЧ" },
    "eac-work-ai":  { "url": "http://eac-agent.online:44222", "apiKey": "ПРЕДСТАВЬТЕ_КЛЮЧ" },
    "gl-hub":       { "url": "https://litellm-master.dev2.k8s.eltc.ru", "apiKey": "ПРЕДСТАВЬТЕ_КЛЮЧ" }
  },
  "defaultModel": "eac-mac-ai/Qwen3.6-35B-A3B-UD-Q6_K.gguf",
  "labels": {
    "eac-home-ai/Qwen3.6-35B-A3B-UD-Q6_K.gguf": "лучшая локальная"
  }
}
```

## 4. Модель-дискавери (авто-опрос)

**Решение:** список моделей каждого провайдера получается АВТОМАТИЧЕСКИ запросом
`GET {url}/v1/models` с заголовком `Authorization: Bearer <apiKey>` — тот же паттерн,
что обкатан в multiagents (`multiagents/server/src/index.ts`, обработчик
`/api/providers/:id/models`, ~строка 529).

Правила (зафиксированы):

1. **Кэш:** список кэшируется на провайдер с TTL **~60 c** (константа
   `MODELS_CACHE_TTL = 60_000` мс в `app/server/llm/config.ts`). Пока кэш свежий —
   HTTP-запрос не идёт.
2. **Свежий успех:** ответ `{ data: [{ id }, …] }` → отсортированный список `id`;
   обновить кэш с отметкой времени.
3. **Сбой/таймаут (timeout запроса 10 c):** вернуть КЭШ даже просроченный, если он
   есть (ответ с пометкой `stale`); кэша нет — ошибка провайдера (в UI: «не удалось
   получить модели», провайдер остаётся в списке без моделей). Поведение повторяет
   multiagents-паттерн.
4. **Подписи:** к каждой найденной модели `<provider>/<id>` добавляется подпись из
   `labels`, если ключ задан; UI показывает `modelId (подпись)`.
5. Модель в `defaultModel`, отсутствующая в свежем списке, НЕ исключается — она
   остаётся дефолтом (провайдер мог временно не ответить).

## 5. Состояние «LLM не настроен»

**Решение:** если `llm.config.json` **отсутствует или невалиден** (не JSON; нарушена
схема §2: нет `providers`, пустая `apiKey`, неизвестный provider в `defaultModel` и
т.п.):

1. Сервер работает как раньше — ВСЕ существующие эндпоинты (`/api/projects*`,
   генерация, viewer3d) полностью функциональны.
2. `GET /api/llm/providers` → `{ "configured": false }` (код 200; причина — поле
   `reason`: «файл не найден» / текст ошибки схемы на русском).
3. В редакторе раздел «LLM-генерация» показывает строку **«LLM не настроен»** с
   подсказкой создать `llm.config.json` по шаблону; select моделей и кнопка
   «Запустить» **недоступны** (06 §2.3).
4. Запросы `POST /api/projects/:p/llm-generate` в этом состоянии → 503
   `LLM_NOT_CONFIGURED`.

Конфиг перечитывается сервером при каждом обращении к LLM-эндпоинтам (lstat раз на
запрос — дёшево, паттерн ленивого workspace в `app/server/index.ts`); перезапуск
сервиса после создания/правки файла НЕ требуется.

## 6. Запросы к провайдеру (LLM-вызов)

Chat-запрос — OpenAI-совместимый: `POST {url}/v1/chat/completions` с телом
`{ "model": "<provider>/<modelId>", "messages": [...] }`; заголовок
`Authorization: Bearer <apiKey>`. Прочие параметры запроса (temperature и т.п.)
**не задаются** — значения по умолчанию провайдера. Таймаут одного LLM-вызова: 120 c
(защита от повисшего HTTP-вызова; жёсткого временного лимита самой сессии нет —
05 §1/§2). Ответ обрабатывается протоколом
[03](./03-protocol-json.md) §2 (извлечение первого `{...}` блока). Ошибка HTTP/сети →
ошибка сессии `error` (05 §3): повторных LLM-вызовов по одному шагу НЕ делается.
