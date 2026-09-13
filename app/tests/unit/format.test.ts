// Чистые формatters и пути навигации (ТЗ 03 §1/§2/§6).
import { describe, expect, it } from 'vitest';

import { editorPath, formatDate, formatSize, previewUrl, viewerPath } from '../../src/lib/format';
import { t } from '../../src/i18n/ru';

const p2 = (n: number): string => String(n).padStart(2, '0');

describe('formatDate', () => {
  it('null и пустая строка → «—»', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate('')).toBe('—');
  });

  it('битый ISO → «—»', () => {
    expect(formatDate('not-a-date')).toBe('—');
  });

  it('формат DD.MM.YYYY HH:mm локального времени (ТЗ 03 §1)', () => {
    const iso = '2026-09-13T13:15:04.210Z';
    const d = new Date(iso);
    expect(formatDate(iso)).toBe(
      `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`,
    );
    // ровно один двоеточие (время), секунд и суффиксов ISO нет
    expect(formatDate(iso).match(/:/g)?.length).toBe(1);
    expect(formatDate(iso)).not.toMatch(/\.(\d)Z?$/);
  });
});

describe('formatSize', () => {
  it('байты → «N Б»', () => {
    expect(formatSize(0)).toBe('0 Б');
    expect(formatSize(512)).toBe('512 Б');
    expect(formatSize(1023)).toBe('1023 Б');
  });

  it('килобайты → «N КБ» (округление)', () => {
    expect(formatSize(47 * 1024)).toBe('47 КБ'); // пример из ТЗ 03 §1
    expect(formatSize(1024 * 1024 - 1)).toBe('1024 КБ');
  });

  it('мегабайты → «N.N МБ»', () => {
    expect(formatSize(Math.round(1.5 * 1024 * 1024))).toBe('1.5 МБ');
    expect(formatSize(256 * 1024 * 1024)).toBe('256.0 МБ');
  });

  it('мусор → «—»', () => {
    expect(formatSize(-5)).toBe('—');
    expect(formatSize(Number.NaN)).toBe('—');
  });
});

describe('пути навигации (ТЗ 03 §6, 04 §2.5/§3.5)', () => {
  it('editor: /editor?project=<name>', () => {
    expect(editorPath('demo-project')).toBe('/editor?project=demo-project');
    expect(editorPath('a b')).toBe('/editor?project=a%20b');
  });

  it('viewer3d: ?result= только при latestResult', () => {
    expect(viewerPath('p1', null)).toBe('/viewer3d?project=p1');
    expect(viewerPath('p1', 'result-20260913-131504.txt')).toBe(
      '/viewer3d?project=p1&result=result-20260913-131504.txt',
    );
  });

  it('previewUrl: /api/projects/<p>/preview?file=<имя>', () => {
    expect(previewUrl('p1', 'preview-20260913-140512.png')).toBe(
      '/api/projects/p1/preview?file=preview-20260913-140512.png',
    );
  });
});

describe('t() — подстановка плейсхолдеров', () => {
  it('заменяет {ключ}', () => {
    expect(t('Проект «{name}» импортирован: файлов {n}, пропущено {m}', { name: 'x', n: 3, m: 1 })).toBe(
      'Проект «x» импортирован: файлов 3, пропущено 1',
    );
  });

  it('неизвестный плейсхолдер остаётся как есть', () => {
    expect(t('A {nope} B', {})).toBe('A {nope} B');
  });
});
