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

/** Сборка системного промпта (05 §3.1–§3.4). */
export function buildSystemPrompt(input: SystemPromptInput): string {
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

  const part2 = [
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
    '    "nodeBudget":<целое > 0>,"areaPercent":{"<id кластера>":<новая доля % >}}} (любой подмножество полей).',
    '2) read_result — чтение и анализ отчёта result-файла.',
    '   {"action":"read_result","args":{"file":"result-<YYYYMMDD-HHMMSS>.txt"}}.',
    '3) correct_result — точечная коррекция маски на уровне клеток.',
    '   {"action":"correct_result","args":{"baseFile":"result-….txt",',
    '    "edits":[{"x":<столбец 0..W-1>,"y":<ряд 0..H-1>,"symbol":"<один символ из {*, .} и символов типов спеки>"}],',
    '    "reason":"<почему правка, строка>"}}.',
    '4) finish — завершение прогона с кандидатами для пользователя.',
    '   {"action":"finish","args":{"candidates":[{"file":"result-….txt","comment":"<оценка относительно запроса>"}],',
    '    "recommended":"result-….txt"}} ("recommended" опционален = file одного из кандидатов).',
    '',
    'ОГРАНИЧЕНИЯ:',
    '- Можно менять ТОЛЬКО seed, timeBudget, nodeBudget и areaPercent (±10% от цели кластера).',
    '- ЗАПРЕЩЕНО: touchAll (критичная настройка пользователя), размер сетки, маски, типы, формы кластеров —',
    '  такие аргументы сервер отвергнет сообщением-ошибкой.',
    '- КРИТИЧНОЕ ПРАВИЛО: ты НИКОГДА не изменяешь существующий файл. Коррекция создаёт НОВЫЙ файл на основе',
    '  исходного — сервер сам копирует baseFile под новым именем, применяет edits и проверяет копию validate;',
    '  при нарушениях копия удаляется, исходный файл остаётся нетронутым.',
    '- Завершение прогона — только через finish с кандидатами и комментариями. Окончательный выбор результата',
    '  делает ПОЛЬЗОВАТЕЛЬ — не принимай решение за него.',
  ].join('\n');

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
  ].join('\n');

  const part4 = [
    '## 4. Запрос пользователя',
    '',
    `«${input.userPrompt}»`,
    '',
    'Выполни запрос, работая в рамках лимитов и ограничений; анализируй отчёты после каждого запуска;',
    'по завершении вызови finish с кандидатами и комментариями.',
  ].join('\n');

  return [part1, part2, part3, part4].join('\n\n');
}

/** Пути масок проекта (относительные от каталога спеки). */
export function maskPaths(projectDir: string, spec: SpecInfo): { blockedPath: string | null; presetPath: string | null } {
  return {
    blockedPath: spec.blockedFile !== null ? path.resolve(projectDir, spec.blockedFile) : null,
    presetPath: spec.presetFile !== null ? path.resolve(projectDir, spec.presetFile) : null,
  };
}
