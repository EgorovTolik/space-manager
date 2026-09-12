# 02. Модель данных и форматы файлов

> Сводный индекс: [../docs-editor/README.md](./README.md) · Архитектура:
> [01-architecture](./01-architecture.md) · Валидация: [05-validation](./05-validation.md)

Этот документ — **контракт** между редактором и spaec-manager: точно описывает внутреннюю
модель редактора, её маппинг на поля файлов по `docs/03-placement-spec.md` и правила
сериализации при скачивании. Форматы не меняются (вводная №8).

## 1. Внутренняя модель редактора (TypeScript)

```ts
// ── YAML-спекация (маппинг — таблица §2) ───────────────────────────────
interface SpecDoc {
  grid: { width: number; height: number };
  blockedFile: string | null;   // имя файла маски блокировок в спеке (см. §6)
  presetFile:  string | null;   // имя файла preset-карты в спеке
  types: Record<string, TypeDef>;            // ключ = id типа (порядок хранения — порядок загрузки/добавления)
  rules: Rules;
  clusters: ClusterEntry[];                  // порядок = порядок в списке UI
}

interface TypeDef { symbol: string; name: string | null }

type ShapeKind = 'free' | 'rectangle' | 'circle';

interface ClusterEntry {
  id: string;                 // уникальный внутри спеки
  type: string;               // ключ из types
  areaPercent: number;        // (0..100], число (целое или дробное)
  shape: ShapeKind;
}

interface Rules {
  connectivity: 4 | 8;                     // дефолт 8; v1-UI редактирует только 8 (см. §2 примечание)
  adjacency: {
    forbidden: [string, string][];         // неупорядоченные пары id типов
    allow: [string, string][] | null;      // null = default-open
  };
  size: { min: number | null; max: number | null };
  convexity: { weight: 'soft' | 'hard' };  // v1-UI: только soft (hard зарезервирован docs/04 §5)
  fillAll: boolean;
  touchAll: boolean;
}

// ── Текстовые маски (размер = grid.width × grid.height) ────────────────
interface MaskGrid {
  width: number;
  height: number;
  // cells[y][x]: индексация строка×столбец, y сверху вниз (как в масках и на canvas)
  cells: CellValue[][];
}

type BlockedCell = 'blocked' | 'free';                 // для blockedMask
type PresetCell = { kind: 'preset'; symbol: string }   // символ ОДНОГО из типов спеки
              | { kind: 'free' };                      // для presetMask
```

Инварианты: `MaskGrid.width/height` всегда равны `spec.grid.width/height`
(при смене размера — пересоздание, [04-ui-ux](./04-ui-ux.md) §3.4). Символы в
`PresetCell.symbol` берутся только из `Object.values(spec.types).map(t => t.symbol)`
(вводная №7).

## 2. Маппинг модель ↔ YAML (поле в поле)

Источник истины по форматам — `docs/03-placement-spec.md`. Таблица:

| Модель редактора | YAML-поле (docs/03) | Тип/примечание |
|---|---|---|
| `grid.width`, `grid.height` | `grid.width`, `grid.height` | целые > 0 |
| `blockedFile` | `blockedFile` | строка (относительный путь) или `null` |
| `presetFile` | `presetFile` | то же |
| ключи `types` | ключи блока `types` | id типа; значение — `{ symbol, name }` |
| `TypeDef.symbol` | `types.<ID>.symbol` | одиночный символ, не `.` и не `*`, без дублей (05 §2) |
| `TypeDef.name` | `types.<ID>.name` | строка или отсутствует в YAML (→ `null`) |
| `rules.connectivity` | `rules.connectivity` | 4 или 8; в v1 UI редактируется только 8 (docs/03 §1: «текущий срез задачи: 8»). Значение из загруженного файла сохраняется и сериализуется как есть; поле в UI — read-only индикатор |
| `rules.adjacency.forbidden` | `rules.adjacency.forbidden` | список пар `[A, B]`; пустой список → `[]` |
| `rules.adjacency.allow` | `rules.adjacency.allow` | список пар или `null` |
| `rules.size.min/max` | `rules.size.min/max` | целые ≥ 0 или `null` |
| `rules.convexity.weight` | `rules.convexity.weight` | `soft` (v1) / `hard` (зарезервировано; загруженное значение round-trip'ится как есть, редактирования в UI нет) |
| `rules.fillAll` | `rules.fillAll` | boolean |
| `rules.touchAll` | `rules.touchAll` | boolean (docs/04 §9) |
| `clusters[]` | `clusters: [...]` | список; порядок элементов = порядок в модели |
| `ClusterEntry.id/type/areaPercent/shape` | одноимённые поля элемента | `areaPercent`: число (0..100]; `shape`: free/rectangle/circle |

Порядок ключей внутри одного YAML-документа при сериализации — фиксированный,
по docs/03 §1: `grid → blockedFile → presetFile → types → rules → clusters`; в
`rules`: `connectivity → adjacency → size → convexity → fillAll → touchAll`.

## 3. Текстовые маски: формат и правила символов

Полностью повторяет docs/03 §2–§3 (редактор не меняет семантику):

**Маска блокировок** (`blockedFile`), размер ровно `width × height`:
- чтение: символ `*` → клетка заблокирована; **любой другой символ** (пробел, `.`, `-`) → свободная. Чтение — терпимое.
- запись: заблокированная → `*`; свободная → `.` (единый канонический символ, см. §5).

**Preset-карта** (`presetFile`), тот же размер:
- чтение: символ, совпадающий с `symbol` какого-то типа из спеки → клетка preset; любой другой символ (в т.ч. пробел, `.`, `-`) → свободная. Символ, **не совпадающий ни с одним типом**, → ошибка валидации V-MASK-PRESET (§05), а не «свободно».
- запись: preset-клетка → её символ; свободная → `.`.

Обе маски: ровно `height` строк по `width` символов, перевод строки `\n`,
последняя строка — с завершающим `\n`. Пробельных символов в концах строк нет
(пробел как «свободная» клетка допустим при ЧТЕНИИ, но при ЗАПИСИ не генерируется).

## 4. Сериализация spec.yaml (dump)

**Решение:** `spec.yaml` при скачивании **собирается из структурной модели**
(функция `dumpSpec(SpecDoc) → string`), а не редактируется как текст.

Последствия и правила:

1. **Комментарии исходного файла НЕ сохраняются.** Это допустимое ограничение v1 —
   зафиксировано явно (см. [07-nfr-limits](./07-nfr-limits.md) §4). Пользователь
   предупреждается при первом скачивании изменённой спеки: «комментарии исходного
   файла не переносятся».
2. Стили YAML фиксированы (определённость round-trip):
   - отступ — 2 пробела; блок-стиль (`js-yaml` dump со `indent: 2, lineWidth: -1`);
   - строки в кавычках только когда необходимо (символ типа, значения с спецсимволами);
     символы типов всегда в двойных кавычках — как в examples (`symbol: "R"`);
   - `null` пишется как `null`; пустые списки как `[]`; пары adjacency — `[A, B]`;
   - порядок ключей — по §2; порядок элементов `clusters` и пар `forbidden/allow`
     = порядок в модели (порядок редактирования в UI).
3. Числа: `width/height/size.min/size.max/connectivity` — целые без дробной части;
   `areaPercent` — как введено пользователем (целое пишется без `.0`, дробное — в
   десятичной записи, запятая не поддерживается).
4. Сериализатор **не выдумывает значения**: каждое поле модели обязано быть заполнено
   парсингом загруженного файла или действиями UI; дефолты при парсинге — по docs/03:
   `name: null`, `allow: null`, `size.min/max: null`, `convexity.weight: soft`,
   `fillAll: false`, `touchAll: false` (отсутствующие в YAML → дефолт; на dump —
   прописываются явно).

5. **Неизвестные поля.** Поля YAML, отсутствующие в модели ([02](./02-data-model-formats.md) §1)
   (например, будущие расширения spaec-manager), при парсинге **отбрасываются** с одноразовым
   предупреждением в UI: «В файле встречены неизвестные поля: rules.newFeature — они не будут
   сохранены при скачивании». **Решение:** молчаливое сохранение «чужих» полей (прозрачный
   pass-through) в v1 не делается — это сломило бы детерминированность dump и round-trip;
   пользователь явно видит, что отброшено.

Функции слоя (модуль `lib/specYaml.ts`): `parseSpec(text): SpecDoc` (js-yaml +
приведение к модели с проверками типов), `dumpSpec(doc): string`.

### Канонический пример dump (эталон для тестов)

Модель, полученная из `examples/spec_touchall.yaml`, сериализуется в точно такой текст
(этот фрагмент — эталон для unit-теста §2.1 [06](./06-testing-acceptance.md)):

```yaml
grid:
  width: 12
  height: 8
blockedFile: blocked_touchall.txt
presetFile: null
types:
  ROOM: { symbol: "R", name: Комната }
  CORRIDOR: { symbol: "C", name: Коридор }
  GARDEN: { symbol: "G", name: Сад }
rules:
  connectivity: 8
  adjacency:
    forbidden: []
    allow: null
  size:
    min: null
    max: null
  convexity:
    weight: soft
  fillAll: false
  touchAll: true
clusters:
  - id: room1
    type: ROOM
    areaPercent: 40
    shape: free
  - id: corridor1
    type: CORRIDOR
    areaPercent: 35
    shape: free
  - id: garden1
    type: GARDEN
    areaPercent: 25
    shape: free
```

Нюансы, зафиксированные этим примером:
- `blockedFile` пишется как **basename** без `./` (правило §6 — редактор не знает путей);
- строки без спецсимволов (`name: Комната`) — без кавычек; символ типа — всегда в
  двойных кавычках;
- `forbidden: []`, `allow: null`, `min/max: null` — явные, даже если в исходнике их не было
  (дефолты прописываются, правило §4 п.4);
- порядок типов и кластеров = порядок реестра/списка в UI.

## 5. Сериализация масок (dump) и round-trip

Функции (`lib/maskText.ts`): `parseBlockedMask(text, w, h)`, `parsePresetMask(text, w, h, typeSymbols)`,
`dumpMask(mask: MaskGrid): string`.

**Round-trip (критерий приёмки [06](./06-testing-acceptance.md) §2):** маска, загруженная
без изменений и скачанная обратно, **побайтово идентична ИСХОДНОМУ файлу только при
условии**, что исходный файл уже в канонической форме (свободные клетки — `.`).
Обоснование: чтение терпимо к пробелам/`-`, а запись — канонически `.`; поэтому
«пробел = свободно» в исходнике превратится в «`.` = свободно». Это осознанное решение:

**Решение:** каноническая форма записи — `.` (единая, предсказуемая побайтово).
Исходники examples (`blocked_basic.txt`, `preset_example.txt`) уже в этой форме,
поэтому эталонные round-trip-тесты на них дают побайтовое совпадение.

## 6. Имена файлов при скачивании

Правила (реализуются в `FilesPanel`, [04-ui-ux](./04-ui-ux.md) §1):

| Файл | Имя по умолчанию при скачивании |
|---|---|
| spec.yaml | имя исходно загруженного файла спеки (например, `spec_basic.yaml`); если спека создана «с нуля» кнопкой — `spec.yaml` |
| маска блокировок | значение поля `spec.blockedFile` (basename), если задано; иначе basename исходно загруженной маски; иначе `blocked.txt` |
| preset-карта | аналогично: `spec.presetFile` → исходное имя → `preset.txt` |

**Решение:** при скачивании masks **одновременно** обновляется поле `blockedFile`/
`presetFile` в модели спеки на basename скачанной маски (если пользователь скачивает
спеку ПОСЛЕ скачивания маски и имена разошлись) — иначе спека ссылалась бы на файл,
которого нет рядом. Если маска не загружалась вовсе — поле спеки при скачивании
приводится к `null` (маски нет в системе). Обратное правило: загрузка маски/презета
автоматически ставит их basename в соответствующее поле спеки (если поле было `null`).

## 7. Создание файла «с нуля»

**Варианты:** А) можно только загружать существующие файлы; Б) UI позволяет создать
пустую спеку с заданным W×H и пустыми масками.

**Решение: Б.** Кнопка «Создать спеку…» в `FilesPanel`: диалог width/height (целые > 0,
без ограничения сверху — вводная №5) → создаётся `SpecDoc` с дефолтами §4 и двумя пустыми
масками. Маски «с нуля» — по кнопкам «Добавить маску блокировок» / «Добавить preset-карту»
(размер = grid, все клетки свободны).

## 8. Что модель НЕ содержит

- Результат размещения, отчёт, `result-*.txt` — вне редактора (вводная №2).
- Путь к файлу на диске пользователя — редактор не сохраняет и не знает его; только имя
  basename из имени загруженного файла (§6).
