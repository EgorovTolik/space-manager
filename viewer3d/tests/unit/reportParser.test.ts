// Unit-тесты парсера отчёта (ТЗ 05 §2, кейсы P1–P12) + покрытие всех кодов
// V-*/W-* (ТЗ 02 §5): у каждого кода — позитивный кейс (код возникает) и
// негативный (валидный файл → кода нет; роль негатива для всех кодов играет P1:
// issues реального отчёта пуст).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseReport, ReportParseError } from '../../src/lib/reportParser';
import type { ParsedReport, Room } from '../../src/lib/reportParser';

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8');
}

function roomBySymbol(r: ParsedReport, symbol: string): Room {
  const found = r.rooms.find((rm) => rm.symbol === symbol);
  if (!found) throw new Error(`room with symbol ${symbol} not found`);
  return found;
}

describe('reportParser: кейсы ТЗ 05 §2', () => {
  it('P1: реальный отчёт report_basic.txt — 3 комнаты, метки по таблице, без issues', () => {
    const r = parseReport(fixture('report_basic.txt'));
    expect(r.width).toBe(50);
    expect(r.height).toBe(50);
    expect(r.map).toHaveLength(50);
    expect(r.infeasible).toBe(false);
    expect(r.infeasibleText).toBeNull();
    expect(r.warningsSection).toEqual([]);
    // негативное покрытие ВСЕХ кодов §5 ТЗ 02: валидный файл → issues пуст
    expect(r.issues).toEqual([]);

    expect(r.rooms).toHaveLength(3);
    const sizes = r.rooms.map((rm) => rm.size).sort((a, b) => a - b);
    expect(sizes).toEqual([225, 375, 650]);

    const roomR = roomBySymbol(r, 'R');
    expect(roomR.size).toBe(650);
    expect(roomR.label).toBe('room1');
    expect(roomR.typeId).toBe('ROOM1');
    expect(roomR.tableRow?.id).toBe('room1');

    const roomW = roomBySymbol(r, 'W');
    expect(roomW.size).toBe(375);
    expect(roomW.label).toBe('room2');
    expect(roomW.typeId).toBe('ROOM2');

    const roomC = roomBySymbol(r, 'C');
    expect(roomC.size).toBe(225);
    expect(roomC.label).toBe('corridor1');
    expect(roomC.typeId).toBe('CORRIDOR');

    expect(r.tableRows).toHaveLength(3);
    expect(r.unmatchedRows).toEqual([]);
    expect(r.blockedCells).toEqual([]);
    expect(r.unknownCells).toEqual([]);
  });

  it('P2: эталон 4×3 — уникальные метки ra/rc, неоднозначные B/D → автоимена', () => {
    const r = parseReport(fixture('report_minimal.txt'));
    expect(r.width).toBe(4);
    expect(r.height).toBe(3);
    expect(r.issues).toEqual([]);
    expect(r.rooms).toHaveLength(4);

    // растровый порядок: A, B, C, D
    expect(r.rooms.map((rm) => rm.index)).toEqual([1, 2, 3, 4]);
    const a = roomBySymbol(r, 'A');
    expect(a.size).toBe(3);
    expect(a.label).toBe('ra');
    expect(a.typeId).toBe('A');

    const b = roomBySymbol(r, 'B');
    expect(b.size).toBe(2);
    expect(b.label).toBe('room-B-1'); // 2 кандидата (rb, rd) → без назначения
    expect(b.typeId).toBeNull();
    expect(b.tableRow).toBeNull();

    const c = roomBySymbol(r, 'C');
    expect(c.size).toBe(4);
    expect(c.label).toBe('rc');
    expect(c.typeId).toBe('C');

    const d = roomBySymbol(r, 'D');
    expect(d.size).toBe(2);
    expect(d.label).toBe('room-D-1');
    expect(d.typeId).toBeNull();

    // строки B и D (оба факт=2) не сопоставлены — в порядке файла
    expect(r.unmatchedRows.map((row) => row.id)).toEqual(['rb', 'rd']);
  });

  it('P3: RR..RR + одна строка r1/R/2 — ранняя комната получает r1, поздняя автоимя', () => {
    const r = parseReport(fixture('report_ambiguous.txt'));
    expect(r.width).toBe(6);
    expect(r.height).toBe(1);
    expect(r.rooms).toHaveLength(2);
    for (const rm of r.rooms) {
      expect(rm.symbol).toBe('R');
      expect(rm.size).toBe(2);
    }
    // ранняя в растровом обходе (0,0) → строка таблицы; поздняя (4,0) → автоимя
    const early = r.rooms.find((rm) => rm.cells[0][0] === 0) as Room;
    const late = r.rooms.find((rm) => rm.cells[0][0] === 4) as Room;
    expect(early.label).toBe('r1');
    expect(early.typeId).toBe('R');
    // автоимя использует порядковый номер символа в растре (2-я комната R), кейс P3
    expect(late.label).toBe('room-R-2');
    expect(late.typeId).toBeNull();
    expect(r.unmatchedRows).toEqual([]);
  });

  it('P4: infeasible-отчёт — блок зафиксирован, комната распознана, факт=0 в unmatched', () => {
    const r = parseReport(fixture('report_infeasible.txt'));
    expect(r.infeasible).toBe(true);
    expect(r.infeasibleText).toBeTruthy();
    expect((r.infeasibleText as string).startsWith('НЕ УДАЛОСЬ')).toBe(true);
    expect(r.infeasibleText).toContain('Причина:');

    expect(r.rooms).toHaveLength(1);
    const a = r.rooms[0];
    expect(a.symbol).toBe('A');
    expect(a.size).toBe(3);
    expect(a.label).toBe('alpha');
    expect(a.typeId).toBe('A');

    // строка с факт=0 (zeta) не участвует в сопоставлении (§6.2 п.1) и уходит в unmatched
    expect(r.unmatchedRows).toHaveLength(1);
    expect(r.unmatchedRows[0].id).toBe('zeta');
    expect(r.unmatchedRows[0].actual).toBe(0);
  });

  it('P5: непрямоугольная карта → ReportParseError с V-MAP-RECT (номер строки, размеры)', () => {
    let caught: unknown;
    try {
      parseReport(fixture('report_notrect.txt'));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ReportParseError);
    const err = caught as ReportParseError;
    const rectIssues = err.issues.filter((i) => i.code === 'V-MAP-RECT');
    expect(rectIssues.length).toBeGreaterThanOrEqual(1);
    // первая неровная строка — №2 (0-based y=1): длина 3, ожидаемо 5
    expect(rectIssues[0].message).toBe('Карты не прямоугольная: строка 2 имеет длину 3, ожидаемо 5');
    expect(rectIssues[0].level).toBe('error');
  });

  it('P6: файл без секции КАРТА → V-NO-MAP', () => {
    let caught: unknown;
    try {
      parseReport(fixture('report_nomap.txt'));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ReportParseError);
    const err = caught as ReportParseError;
    expect(err.issues.map((i) => i.code)).toEqual(['V-NO-MAP']);
    expect(err.issues[0].message).toContain('не найдена секция "== КАРТА =="');
  });

  it('P7: сетка 201×10 (генерация) → V-MAP-DIMS-LIMIT с «201×10»', () => {
    const lines = ['== КАРТА ==', ''];
    for (let y = 0; y < 10; y += 1) lines.push('A'.repeat(201));
    let caught: unknown;
    try {
      parseReport(lines.join('\n'));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ReportParseError);
    const err = caught as ReportParseError;
    const issue = err.issues.find((i) => i.code === 'V-MAP-DIMS-LIMIT');
    expect(issue).toBeTruthy();
    expect(issue?.message).toBe('Сетка 201×10 превышает лимит v1 (200×200)');
  });

  it('P8: 130 изолированных комнат (генерация) → V-ROOMS-LIMIT', () => {
    // 25×20: в чётных строках 'A' через клетку → 13 на строку × 10 строк = 130 комнат
    const rows: string[] = [];
    for (let y = 0; y < 20; y += 1) {
      rows.push(y % 2 === 0 ? 'A.A.A.A.A.A.A.A.A.A.A.A.A' : '.'.repeat(25));
    }
    const text = ['== КАРТА ==', '', ...rows].join('\n');
    let caught: unknown;
    try {
      parseReport(text);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ReportParseError);
    const err = caught as ReportParseError;
    const issue = err.issues.find((i) => i.code === 'V-ROOMS-LIMIT');
    expect(issue).toBeTruthy();
    expect(issue?.message).toBe('Найдено 130 комнат — превышен лимит v1 (128)');
  });

  it('P9: строка таблицы из 5 полей → W-TABLE-ROW с номером строки, комнаты с автоименами', () => {
    const r = parseReport(fixture('report_badtable.txt')); // не бросает — только warning
    const rowIssue = r.issues.find((i) => i.code === 'W-TABLE-ROW');
    expect(rowIssue).toBeTruthy();
    expect(rowIssue?.level).toBe('warning');
    // строка «aa | bb | cc | dd | ee» — №10 файла (1-based)
    expect(rowIssue?.message).toContain('№10');

    expect(r.tableRows).toEqual([]);
    expect(r.rooms).toHaveLength(2);
    expect(roomBySymbol(r, 'A').label).toBe('room-A-1');
    expect(roomBySymbol(r, 'B').label).toBe('room-B-1');
  });

  it('P10: клетка «?» → W-UNKNOWN-CELLS с координатами, псевдокомната unknown-1', () => {
    const text = [
      '== КАРТА ==',
      '',
      'AAA?',
      'BBBB',
      '',
      '== ТАБЛИЦА: запрошено / фактически / отклонение ==',
      '',
      'id | type | доля (%) | цель (клеток) | факт (клеток) | отклонение | статус',
      '-- | ---- | -------- | ------------- | ------------- | ---------- | ------',
      'ra | A    | 50       | 3             | 3             | 0          | ок',
      'rb | B    | 50       | 4             | 4             | 0          | ок',
      '',
      '== ПРЕДУПРЕЖДЕНИЯ ==',
      '',
      'нет',
      '',
    ].join('\n');
    const r = parseReport(text);
    expect(r.unknownCells).toEqual([[3, 0]]);
    const warnIssue = r.issues.find((i) => i.code === 'W-UNKNOWN-CELLS');
    expect(warnIssue).toBeTruthy();
    expect(warnIssue?.level).toBe('warning');
    expect(warnIssue?.message).toContain('(3,0)');

    // «?» образует псевдокомнату (ТЗ 02 §3/§6.4): автоимя, typeId null
    expect(r.rooms).toHaveLength(3);
    const unknown = r.rooms.find((rm) => rm.symbol === '?') as Room;
    expect(unknown.label).toBe('unknown-1');
    expect(unknown.typeId).toBeNull();
    expect(unknown.size).toBe(1);
    // обычные комнаты сопоставлены
    expect(roomBySymbol(r, 'A').label).toBe('ra');
    expect(roomBySymbol(r, 'B').label).toBe('rb');
  });

  it('P11: повторный парсинг того же текста — глубоко равные результаты', () => {
    const text = fixture('report_basic.txt');
    const r1 = parseReport(text);
    const r2 = parseReport(text);
    expect(r2).toEqual(r1);
  });

  it('P12: CRLF-копия report_basic.txt — результат равен P1', () => {
    const text = fixture('report_basic.txt');
    const crlf = text.replace(/\n/g, '\r\n');
    expect(crlf).not.toBe(text); // действительно другая кодировка переводов строк
    const rCrlf = parseReport(crlf);
    const rLf = parseReport(text);
    expect(rCrlf).toEqual(rLf);
  });
});

describe('reportParser: покрытие кодов ТЗ 02 §5 (дополнительно к P1–P12)', () => {
  it('V-MAP-EMPTY: заголовок КАРТА без строк сетки → ошибка', () => {
    const text = ['== КАРТА ==', '', '== ТАБЛИЦА: запрошено / фактически / отклонение =='].join('\n');
    let caught: unknown;
    try {
      parseReport(text);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ReportParseError);
    const err = caught as ReportParseError;
    expect(err.issues.map((i) => i.code)).toEqual(['V-MAP-EMPTY']);
  });

  it('V-MAP-CHAR: управляющий символ в клетке → ошибка с кодом U+XXXX и координатами', () => {
    const text = ['== КАРТА ==', '', 'A\u0001B', '...'].join('\n');
    let caught: unknown;
    try {
      parseReport(text);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ReportParseError);
    const err = caught as ReportParseError;
    const issue = err.issues.find((i) => i.code === 'V-MAP-CHAR');
    expect(issue).toBeTruthy();
    expect(issue?.message).toBe('Запрещённый символ U+0001 в клетке (1,0)');
  });

  it('W-TABLE-MISSING: корректная карта без секции ТАБЛИЦА → warning + автоимена', () => {
    const r = parseReport(['== КАРТА ==', '', 'AA', 'BB'].join('\n'));
    expect(r.rooms).toHaveLength(2);
    expect(roomBySymbol(r, 'A').label).toBe('room-A-1');
    expect(roomBySymbol(r, 'B').label).toBe('room-B-1');
    const issue = r.issues.find((i) => i.code === 'W-TABLE-MISSING');
    expect(issue).toBeTruthy();
    expect(issue?.level).toBe('warning');
  });

  it('W-UNKNOWN-CELLS: ≤5 клеток — полный список; >5 — «… и ещё m»', () => {
    // 4 клетки → все координаты, без сокращения
    const small = ['== КАРТА ==', '', '??..', '??..'].join('\n');
    const rSmall = parseReport(small);
    expect(rSmall.unknownCells).toHaveLength(4);
    const issueSmall = rSmall.issues.find((i) => i.code === 'W-UNKNOWN-CELLS');
    expect(issueSmall?.message).toContain('(0,0), (1,0), (0,1), (1,1)');
    expect(issueSmall?.message).not.toContain('и ещё');

    // 7 клеток → первые 5 координат + «… и ещё 2»
    const big = ['== КАРТА ==', '', '??????.', '?......'].join('\n');
    const rBig = parseReport(big);
    expect(rBig.unknownCells).toHaveLength(7);
    const issueBig = rBig.issues.find((i) => i.code === 'W-UNKNOWN-CELLS');
    expect(issueBig?.message).toContain('(0,0), (1,0), (2,0), (3,0), (4,0), … и ещё 2');
  });

  it("blocked-клетки '*' собираются в blockedCells (растровый порядок)", () => {
    const r = parseReport(['== КАРТА ==', '', 'A*B', '*..'].join('\n'));
    expect(r.blockedCells).toEqual([[1, 0], [0, 1]]);
    // '*' не комнаты
    expect(r.rooms.map((rm) => rm.symbol)).toEqual(['A', 'B']);
  });

  it('доля preset «—» → share null; доля числа → число', () => {
    const text = [
      '== КАРТА ==',
      '',
      'AA',
      '',
      '== ТАБЛИЦА: запрошено / фактически / отклонение ==',
      '',
      'id | type | доля (%) | цель (клеток) | факт (клеток) | отклонение | статус',
      '-- | ---- | -------- | ------------- | ------------- | ---------- | ------',
      'p1 | P    | —        | 2             | 2             | 0          | ок',
      '',
      '== ПРЕДУПРЕЖДЕНИЯ ==',
      '',
      'нет',
      '',
    ].join('\n');
    const r = parseReport(text);
    expect(r.tableRows).toHaveLength(1);
    expect(r.tableRows[0].share).toBeNull();
  });

  it('секция ПРЕДУПРЕЖДЕНИЯ: многострочный текст сохраняется по строкам', () => {
    const text = [
      '== КАРТА ==',
      '',
      'AA',
      '',
      '== ТАБЛИЦА: запрошено / фактически / отклонение ==',
      '',
      'id | type | доля (%) | цель (клеток) | факт (клеток) | отклонение | статус',
      '-- | ---- | -------- | ------------- | ------------- | ---------- | ------',
      'a1 | A    | 50       | 2             | 2             | 0          | ок',
      '',
      '== ПРЕДУПРЕЖДЕНИЯ ==',
      '',
      'WARNING: a1 (A) получился меньше запрошенного: 2 клеток вместо цели 3 (-33%).',
      '         Полностью вписать кластер в заданную долю не удалось.',
      '',
    ].join('\n');
    const r = parseReport(text);
    expect(r.warningsSection).toHaveLength(2);
    expect(r.warningsSection[0]).toContain('WARNING: a1 (A)');
  });
});
