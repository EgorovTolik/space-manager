// Системный промпт LLM-агента на русском (ТЗ docs-llm/05 §3).
// Четыре пронумерованные части: описание системы, возможности (схемы +
// ограничения), исходная конфигурация (spec.yaml + маски), запрос пользователя.
import path from 'node:path';

import { connectedRegions } from './reportParse.js';
import { maskToGrid, type SpecInfo } from './specInfo.js';

/** Порог «сырые маски»: W×H ≤ 2000 клеток (05 §3.3). */
export const RAW_MASK_MAX_CELLS = 2000;

export interface SystemPromptInput {
  spec: SpecInfo;
  /** Полный текст spec.yaml проекта. */
  specText: string;
  /** Текст blocked.txt (null — маски нет). */
  blockedText: string | null;
  /** Текст preset.txt (null — маски нет). */
  presetText: string | null;
  /** Запрос пользователя дословно. */
  userPrompt: string;
}

function masksSection(input: SystemPromptInput): string {
  const { spec, blockedText, presetText } = input;
  if (spec.width * spec.height <= RAW_MASK_MAX_CELLS) {
    // Сырой текст масок (как есть в файлах).
    const parts: string[] = [];
    if (blockedText !== null) {
      parts.push(`Файл ${spec.blockedFile ?? 'blocked.txt'} (маска блокировок, «*» — заблокировано):\n\n${stripTrailingNewline(blockedText)}`);
    }
    if (presetText !== null) {
      parts.push(`Файл ${spec.presetFile ?? 'preset.txt'} (предзаполненная карта, символы типов — неподвижные кластеры):\n\n${stripTrailingNewline(presetText)}`);
    }
    return parts.join('\n\n');
  }
  // Компактная сводка: F-клеток, заблокировано, пресеты с позициями и размерами.
  const lines: string[] = [];
  if (blockedText !== null) {
    try {
      const grid = maskToGrid(blockedText, spec.width, spec.height);
      let free = 0;
      for (const row of grid) for (const ch of row) if (ch !== '*') free++;
      lines.push(`F — свободных клеток после блокировок: ${free}`);
      lines.push(`Заблокированных клеток: ${spec.width * spec.height - free}`);
    } catch {
      lines.push('Маска блокировок не распознана по размеру.');
    }
  } else {
    lines.push(`F — свободных клеток после блокировок: ${spec.width * spec.height}`);
  }
  if (presetText !== null) {
    try {
      const grid = maskToGrid(presetText, spec.width, spec.height);
      const regions = connectedRegions(grid).filter((r) => r.symbol !== '.' && r.symbol !== '*');
      if (regions.length === 0) {
        lines.push('Пресеты: нет.');
      } else {
        lines.push('Пресеты (связные области, позиции и размеры):');
        for (const r of regions) {
          const type = Object.keys(spec.types).find((t) => spec.types[t].symbol === r.symbol) ?? null;
          const [x0, y0, x1, y1] = r.bbox;
          lines.push(`  - тип ${type ?? '?'} (символ «${r.symbol}»): клеток ${r.cells}, bbox x=${x0}..${x1}, y=${y0}..${y1}`);
        }
      }
    } catch {
      lines.push('Маска пресетов не распознана по размеру.');
    }
  }
  return lines.join('\n');
}

function stripTrailingNewline(text: string): string {
  return text.replace(/\n+$/, '');
}

/** Таблица реестра типов проекта: id → символ → name (LST-7). */
function typesTable(spec: SpecInfo): string {
  const rows = Object.entries(spec.types).map(([id, t]) => `| ${id} | ${t.symbol} | ${t.name ?? '—'} |`);
  return ['| id | символ | name |', '| --- | --- | --- |', ...rows].join('\n');
}

/** Краткое резюме правил размещения генератора по спеке (docs/04, docs/03 §4; LST-7). */
function rulesSummary(spec: SpecInfo): string {
  const { rules } = spec;
  const lines: string[] = [];
  lines.push(`- Связность кластеров и соседство считаются по ${rules.connectivity}-окрестности (диагональное касание учитывается).`);
  if (rules.adjacency.allow !== null) {
    const pairs = rules.adjacency.allow.map(([a, b]) => `${a}↔${b}`).join(', ');
    lines.push(`- Соседство: жёсткий whitelist — разрешены ТОЛЬКО пары: ${pairs} (пары из forbidden всё равно запрещены).`);
  } else if (rules.adjacency.forbidden.length > 0) {
    const pairs = rules.adjacency.forbidden.map(([a, b]) => `${a}↔${b}`).join(', ');
    lines.push(`- Соседство: default-open — любые пары разрешены, кроме запрещённых: ${pairs}.`);
  } else {
    lines.push('- Соседство: любые пары типов разрешены (ни allow, ни forbidden не заданы).');
  }
  const shapeMeaning: Record<string, string> = {
    rectangle: 'ровно заполненный ограничивающий прямоугольник без «дыр»',
    circle: 'клетки в радиусе R от целочисленного центра (расстояние Чебышёва), допуск по границе ≤ 3 клетки',
    free: 'любая связная форма; солвер предпочитает выпуклые (заполненность bounding-box)',
  };
  for (const c of spec.clusters) {
    lines.push(`- Кластер ${c.id} (тип ${c.type}, доля ${c.areaPercent}%): shape=${c.shape} — ${shapeMeaning[c.shape] ?? 'неизвестная форма'}.`);
  }
  lines.push(`- fillAll: ${rules.fillAll} (${rules.fillAll ? 'вся площадь F используется, «лишнее» распределяется пропорционально долям' : 'остаток может остаться свободным'}) — значение спеки, ты НЕ изменяешь его.`);
  lines.push(`- touchAll: ${rules.touchAll} (${rules.touchAll ? 'все кластеры обязаны примыкать друг к другу единым «комом» (жёстко)' : 'кластеры могут быть разнесены зазорами'}) — значение спеки, ты НЕ изменяешь его.`);
  return lines.join('\n');
}

/** Сборка системного промпта (05 §3.1–§3.4). */
export function buildSystemPrompt(input: SystemPromptInput): string {
  const { spec } = input;
  const part1 = [
    '## 1. Описание системы',
    '',
    'space-manager — веб-инструмент размещения замкнутых кластеров (комнаты, коридоры и т.п.)',
    'на пиксельной сетке по YAML-спекации. Генератор ДЕТЕРМИНИРОВАН: одинаковые входные данные + seed →',
    'одинаковый result-файл. Ты — LLM, встроенная в веб-редактор для ПОДБОРА ПАРАМЕТРОВ ГЕНЕРАЦИИ',
    '(seed, бюджеты, доли кластеров в пределах допуска) и ОЦЕНКИ/КОРРЕКТИРОВКИ размещений.',
    'Запуск генератора, чтение файлов и сохранение результатов выполняет СЕРВЕР — ты только принимаешь',
    'решения по данным: предлагаешь параметры запусков, анализируешь отчёты, вносишь точечные правки маски.',
  ].join('\n');

  const canCreateBlockages = spec.blockedFile === null;
  // run_generation: маска-оверрайды доступны только созданным тобой файлам (LST-7).
  const maskArgsLine = [
    canCreateBlockages ? '"blockagesFile":"blocked-llm-….txt",' : '',
    '"presetsFile":"preset-llm-….txt"',
  ].filter((s) => s !== '').join(' ');

  const part2: string[] = [
    '## 2. Возможности (действия и ограничения)',
    '',
    'Каждый ответ — СТРОГО ОДИН валидный JSON вида {"action": <имя>, "args": {...}}',
    '+ опциональное поле "thought" (комментарий/рассуждение; попадает в лог прогона).',
    '',
    'Доступные действия:',
    '',
    '1) run_generation — запуск генератора с оверрайдами параметров.',
    '   Схемы аргументов (все поля опциональны; {} = запуск спеки без оверрайдов):',
    '   {"action":"run_generation","args":{"seed":<целое ≥ 0>,"timeBudget":<число > 0, сек>,',
    `    ${maskArgsLine}}} (любой подмножество полей).`,
    '   blockagesFile/presetsFile — basename масок, созданных тобой инструментами ниже; при прогоне сервер',
    '   использует их ВМЕСТО масок проекта (маску блокировок можно передать только когда у пользователя её нет; пресет',
    '   заменяет собственный preset проекта, если он есть). Доля areaPercent проверяется на допуск ±10% от цели кластера,',
    '   а при новой maskе блокировок — от НОВОЙ базы F (свободных клеток после твоих блокировок).',
    '2) read_result — чтение и анализ отчёта result-файла.',
    '   {"action":"read_result","args":{"file":"result-<YYYYMMDD-HHMMSS>.txt"}}.',
    '3) correct_result — точечная коррекция маски на уровне клеток.',
    '   {"action":"correct_result","args":{"baseFile":"result-….txt",',
    '    "edits":[{"x":<столбец 0..W-1>,"y":<ряд 0..H-1>,"symbol":"<один символ из {*, .} и символов типов спеки>"}],',
    '    "reason":"<почему правка, строка>"}}.',
  ];
  if (canCreateBlockages) {
    part2.push(
      '4) create_blockages_file — создание НОВОЙ маски блокировок проекта.',
      '   {"action":"create_blockages_file","args":{"content":"<полный текст маски: ровно H строк × W символов,',
      '    «*» = заблокировано, «.» = свободно>","reason":"<почему создаётся маска>"}}.',
      '   Результат — новый файл blocked-llm-<YYYYMMDD-HHMMSS>.txt (spec.yaml не изменяется). После создания проценты',
      '   кластеров считаются от НОВОЙ F (свободных клеток) — блокировки меняют базу процентов.',
    );
  }
  const presetNum = canCreateBlockages ? 5 : 4;
  const finishNum = canCreateBlockages ? 6 : 5;
  part2.push(
    `${presetNum}) create_preset_file — создание НОВОЙ маски пресета (неподвижные кластеры).`,
    '   {"action":"create_preset_file","args":{"content":"<полный текст маски: ровно H строк × W символов;',
    '    символы реестра типов спеки = неподвижные кластеры, «.» = пусто>","reason":"<почему создаётся пресет>"}}.',
    '   Результат — новый файл preset-llm-<YYYYMMDD-HHMMSS>.txt и список областей (тип/клетки/bbox). Preset НЕ уменьшает F.',
    '   Используй в run_generation с аргументом "presetsFile": при таком прогоне пресет проекта заменяется твоим.',
    `${finishNum}) finish — завершение прогона с кандидатами для пользователя.`,
    '   {"action":"finish","args":{"candidates":[{"file":"result-….txt","comment":"<оценка относительно запроса>"}],',
    '    "recommended":"result-….txt"}} ("recommended" опционален = file одного из кандидатов).',
    '',
    'ОГРАНИЧЕНИЯ:',
    '- В run_generation можно менять ТОЛЬКО seed, timeBudget, nodeBudget и areaPercent (±10% от цели кластера)',
    '  + имена своих масок blockagesFile/presetsFile.',
    '- ЗАПРЕЩЕНО: touchAll/fillAll (критичные настройки пользователя), размер сетки, типы, формы кластеров,',
    '  правила соседства — такие аргументы сервер отвергнет сообщением-ошибкой.',
    '- Создание НОВЫХ масок (blocked-llm-*/preset-llm-*) разрешено инструментами create_*_file;',
    '  существующие файлы проекта не изменяются никогда.',
    '- КРИТИЧНОЕ ПРАВИЛО: ты НИКОГДА не изменяешь существующий файл. Коррекция создаёт НОВЫЙ файл на основе',
    '  исходного — сервер сам копирует baseFile под новым именем, применяет edits и проверяет копию validate;',
    '  при нарушениях копия удаляется, исходный файл остаётся нетронутым.',
    '- Завершение прогона — только через finish с кандидатами и комментариями. Окончательный выбор результата',
    '  делает ПОЛЬЗОВАТЕЛЬ — не принимай решение за него.',
  );

  const part2Text = part2.join('\n');

  const part3 = [
    '## 3. Исходная конфигурация проекта',
    '',
    'spec.yaml (полный текст):',
    '',
    '```yaml',
    input.specText.replace(/\n+$/, ''),
    '```',
    '',
    masksSection(input),
    '',
    'Формат масок и координаты:',
    `- Сетка проекта: W = ${spec.width} (столбцов) × H = ${spec.height} (рядов).`,
    '- Координаты: x — столбец 0..W-1 слева направо, y — ряд 0..H-1 СВЕРХУ ВНИЗ; первая строка файла маски —',
    '  это верхний ряд сетки (y=0), её первый символ — клетка (x=0, y=0).',
    '- Маска блокировок: ровно H строк по W символов; «*» — заблокированная клетка (не входит в базу F),',
    '  любой другой символ («.») — свободная.',
    '- Пресет: тот же размер; символы реестра типов = неподвижные кластеры (каждая связная группа символов —',
    '  отдельный кластер), «.» — пусто. Preset НЕ уменьшает F: база долей — незаблокированные клетки.',
    '',
    'Реестр типов проекта:',
    typesTable(spec),
    '',
    'Правила размещения генератора (значения из спеки; ты их не изменяешь):',
    rulesSummary(spec),
  ].join('\n');

  const part4 = [
    '## 4. Запрос пользователя',
    '',
    `«${input.userPrompt}»`,
    '',
    'Выполни запрос, работая в рамках лимитов и ограничений; анализируй отчёты после каждого запуска;',
    'по завершении вызови finish с кандидатами и комментариями.',
  ].join('\n');

  return [part1, part2Text, part3, part4].join('\n\n');
}

/** Пути масок проекта (относительные от каталога спеки). */
export function maskPaths(projectDir: string, spec: SpecInfo): { blockedPath: string | null; presetPath: string | null } {
  return {
    blockedPath: spec.blockedFile !== null ? path.resolve(projectDir, spec.blockedFile) : null,
    presetPath: spec.presetFile !== null ? path.resolve(projectDir, spec.presetFile) : null,
  };
}
