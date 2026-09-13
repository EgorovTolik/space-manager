# 01. Архитектура LLM-управления генерацией

> Сводный индекс: [README.md](./README.md) · Конфиг провайдеров: [02-config-providers](./02-config-providers.md) ·
> Протокол: [03-protocol-json](./03-protocol-json.md) · Валидатор: [04-validate-subcommand](./04-validate-subcommand.md) ·
> Цикл и лимиты: [05-agent-loop-limits](./05-agent-loop-limits.md) · API/UI: [06-api-ui](./06-api-ui.md) ·
> Тесты: [07-testing-acceptance](./07-testing-acceptance.md).

## 1. Контекст системы (существующее, НЕ изменяется)

| Компонент | Директория | Что это |
|---|---|---|
| Python-солвер | `space_manager/` (+ `.venv/`) | **Python 3.9** (без `match`, без `X \| Y` в аннотациях). CLI: `.venv/bin/python -m space_manager place <spec.yaml> [--seed N] [--time-budget S] [--node-budget N] [--out FILE]`. Детерминирован: одинаковые входные данные + seed → одинаковый result. Exit-codes (docs/06 §7): 0 — размещение найдено, 1 — infeasible, 2 — ошибка входа. В эту ТЗ добавляется **только** новая подкоманда `validate` ([04](./04-validate-subcommand.md)). |
| Формат result | — | Текст с секциями: `== КАРТА ==` (маска: `*` — блокировка, `.` — пусто, символы типов из `spec.types`; строки по y = 0..height−1, внутри строки x = 0..width−1), `== ТАБЛИЦА: запрошено / фактически / отклонение ==`, `== ПРЕДУПРЕЖДЕНИЯ ==` / блок невозможности. Пример: `workspace/1/result-20260913-200232.txt`. Формат НЕ меняется (README §3). |
| Унифицированный сервис | `app/` (Express, :4080) | Менеджер проектов в `workspace/<slug>/` (`project.json`, `spec.yaml`, `blocked.txt`, `preset.txt`, `result-*.txt`). Генерация = `POST /api/projects/:p/generate`: очередь «одна активная на проект» + `spawn` Python, SIGKILL по таймауту. Чистый spawn-модуль — `app/server/generate.ts` (`runSolver`, `createProjectQueue`); роуты и `ApiError` — `app/server/index.ts`, `app/server/errors.ts`. |
| Редактор | `editor/` (React + Vite + TS) | Панели Файлы/Кластеры/Маски/Генерация; кнопка «⚡ Генерировать размещение» в `FilesPanel.tsx`; i18n — единый словарь `src/i18n/ru.ts` (RU — единственный язык). |
| 3D-визуализатор | `viewer3d/` | Открывает result-файлы: `/viewer3d/?project=<slug>&result=<file>`. Без изменений. |

## 2. Ключевое решение: LLM-модуль на сервере

**Решение:** вся LLM-логика — новый каталог **`app/server/llm/`** в Node-сервисе
(Express :4080). В браузере нет НИЧЕГО, кроме UI-раздела «LLM-генерация» и опроса
статуса.

Причины (зафиксированы):

1. **API-ключи провайдеров не должны попадать во фронт.** Конфиг
   (`llm.config.json`, решение [02](./02-config-providers.md)) читается только
   сервером; браузеру отдаются имена моделей без ключей.
2. **Цикл «запуск генератора → анализ → следующий запуск» держится рядом с
   существующей очередью генераций.** LLM-прогон запускает тот же `runSolver` из
   `app/server/generate.ts` и проходит через ту же `createProjectQueue()` на проект —
   LLM не может «создать параллельную» генерацию, минуя очередь; остановка (SIGKILL)
   использует тот же механизм, что у обычной генерации.
3. **Редактор = только UI.** Текстовый промпт, выбор модели/лимитов, кнопки
   «Запустить»/«Стоп», лог шагов, список кандидатов — см. [06-api-ui](./06-api-ui.md) §2.

Последствие: LLM-модуль — единственный потребитель `llm.config.json`; при его
отсутствии сервис деградирует ровно до «LLM не настроен» (README §5 п.1), а не ломается.

## 3. Общая схема

```
┌────────────────────────── Браузер (editor SPA, /editor) ──────────────────────────┐
│  Раздел «LLM-генерация» (новый):                                                  │
│   • textarea промпта, select моделей (provider/model), поля лимитов               │
│   • «Запустить» → POST /api/projects/:p/llm-generate {prompt, modelId, limits}    │
│   • опрос GET .../llm-status?session=<id> раз в ~1.5 с (вариант «б», БЕЗ SSE)     │
│   • лог шагов вживую; по завершении — кандидаты: файл, комментарий LLM,           │
│     отметка «рекомендовано», ссылка /viewer3d/?project=<slug>&result=<file>       │
│  Кнопка «⚡ Генерировать размещение» — БЕЗ ИЗМЕНЕНИЙ (POST .../generate)          │
└───────────────┬───────────────────────────────────────────────────────────────────┘
                ▼ REST /api/*
┌──────────────────────────── Node.js + Express :4080 (app/) ────────────────────────┐
│  index.ts: новые роуты /api/llm/providers, /api/projects/:p/llm-* (06 §1)         │
│                                                                                   │
│  server/llm/ (НОВЫЙ каталог):                                                     │
│   ├─ config.ts      — загрузка llm.config.json + модель-дискавери {url}/v1/models │
│   │                   с кэшем TTL ~60 c (02)                                      │
│   ├─ protocol.ts    — извлечение ПЕРВОГО {...} блока, валидация {action,args}     │
│   │                   (03 §2)                                                     │
│   ├─ actions.ts     — исполнители 4 действий: run_generation / read_result /      │
│   │                   correct_result / finish + ВАЛИДАЦИЯ ОВЕРРАЙДОВ (03 §4–§7)  │
│   ├─ session.ts     — агентный цикл, состояния running→done|stopped|error,        │
│   │                   лимиты, стоп-флаг, системный промпт (05)                    │
│   └─ sessions.ts    — чтение/запись журнала workspace/<slug>/llm-sessions/*.json  │
│                                                                                   │
│  generate.ts (СУЩЕСТВУЮЩИЙ, не меняется): runSolver + createProjectQueue          │
└───────┬───────────────────────────────────┬───────────────────────────────────────┘
        ▼ HTTP {url}/v1/chat/completions    ▼ spawn (очередь проекта)
  LLM-провайдеры (GGUF, локальные):     .venv/bin/python -m space_manager
  eac-mac-ai / eac-home-ai /             place <spec> [--seed N] --time-budget 2.0 \
  eac-work-ai / gl-hub                    --out result-<ts>.txt        (в прогоне)
                                        .venv/bin/python -m space_manager
                                        validate <result> --spec <spec>   (correct_result, 04)
```

Data flow одного шага цикла: сообщение LLM → `protocol.ts` извлекает `{action,args}`
→ `actions.ts` валидирует аргументы (оверрайды — 03 §5) и исполняет → результат
(отчёт/сводка/нарушения/подтверждение) упаковывается следующим сообщением истории →
следующий запрос к LLM. Цикл и стоп-условия — [05](./05-agent-loop-limits.md).

## 4. Структура нового кода

```
space-manager/                       # корень репозитория
├── llm.config.json                  # НОВЫЙ, в .gitignore (ключи; НЕ коммитить)
├── llm.config.example.json          # НОВЫЙ, В git: те же провайдеры, apiKey "ПРЕДСТАВЬТЕ_КЛЮЧ" (02 §3)
├── app/
│   └── server/
│       ├── index.ts                 # +5 LLM-роутов (06 §1); существующие роуты не меняются
│       ├── errors.ts                # +коды ApiError: LLM_NOT_CONFIGURED, LLM_SESSION_ACTIVE,
│       │                            #   LLM_UNKNOWN_MODEL, LLM_INVALID_BODY, LLM_NO_SESSION
│       └── llm/                     # НОВЫЙ каталог (схема — §3; тесты — 07 §2)
├── space_manager/
│   ├── cli.py                       # +подкоманда validate (аргументы, exit-codes — 04 §2)
│   └── validate_*.py                # НОВЫЙ модуль валидатора: переиспользует rules.py /
│                                    #   report.py / spec_io.py (04 §5)
├── tests/                           # +pytest validate_* (07 §3)
├── editor/src/
│   ├── components/LlmPanel.tsx      # НОВЫЙ: раздел «LLM-генерация» (06 §2)
│   └── i18n/ru.ts                   # +блок llm: {...} — все строки на русском
└── workspace/<slug>/llm-sessions/   # НОВЫЕ файлы журнала прогонов <YYYYMMDD-HHMMSS>.json (05 §4)
```

## 5. Границы и что НЕ меняется

1. **Форматы файлов** `result-*.txt`, `spec.yaml`, `blocked.txt`, `preset.txt` —
   без изменений (README §3). LLM создаёт result-файлы ТОЛЬКО двумя способами:
   стандартный запуск `place --out` и сохранение откорректированной копии под новым
   именем `result-<ts>.txt` — оба дают файлы того же формата, которые автоматически
   попадают в существующую историю результатов проекта (`GET .../results`, селектор
   viewer3d) — ни один компонент для этого не переписывается.
2. **Обычная генерация** (`POST /api/projects/:p/generate`, кнопка «⚡») — без
   изменений; LLM-прогон лишь повторно использует `runSolver`/очередь.
3. **Python-солвер** — не меняется, кроме добавления подкоманды `validate` (04):
   `place`, её флаги, exit-codes и формат отчёта идентичны docs/06.
4. **viewer3d, app-UI менеджера проектов** — без изменений.
5. **Одноместный локальный режим** сохраняется: одна активная LLM-сессия на проект
   (очередь), аутентификации нет (паттерн docs-unified README п.10).
