// Формат имени PNG-снапшота (ТЗ 04 §10): viewer3d-snapshot-<YYYYmmdd-HHMMSS>.png —
// тот же формат timestamp, что у CLI-отчётов.

import { describe, it, expect } from 'vitest';
import { snapshotTimestamp, snapshotFileName, previewFileName } from '../../src/lib/timestamp';

describe('snapshotTimestamp / snapshotFileName', () => {
  it('форматирует дату как YYYYmmdd-HHMMSS (локальное время)', () => {
    const d = new Date(2026, 8, 11, 9, 5, 3); // 11.09.2026 09:05:03
    expect(snapshotTimestamp(d)).toBe('20260911-090503');
  });

  it('имя файла — viewer3d-snapshot-<ts>.png', () => {
    const d = new Date(2026, 0, 2, 23, 59, 58); // 02.01.2026
    expect(snapshotFileName(d)).toBe('viewer3d-snapshot-20260102-235958.png');
  });

  it('имя соответствует шаблону (проверка по регулярке)', () => {
    const name = snapshotFileName(new Date(2026, 11, 31, 0, 0, 1));
    expect(name).toMatch(/^viewer3d-snapshot-\d{8}-\d{6}\.png$/);
  });
});

describe('previewFileName (docs-unified/04 §2.4)', () => {
  it('имя файла предпросмотра — preview-<ts>.png', () => {
    const d = new Date(2026, 8, 13, 14, 2, 7); // 13.09.2026 14:02:07
    expect(previewFileName(d)).toBe('preview-20260913-140207.png');
  });

  it('имя соответствует шаблону (проверка по регулярке)', () => {
    const name = previewFileName(new Date(2026, 0, 1, 0, 0, 0));
    expect(name).toMatch(/^preview-\d{8}-\d{6}\.png$/);
  });
});
