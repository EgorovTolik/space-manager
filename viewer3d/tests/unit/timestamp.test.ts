// Формат имени PNG-снапшота (ТЗ 04 §10): viewer3d-snapshot-<YYYYmmdd-HHMMSS>.png —
// тот же формат timestamp, что у CLI-отчётов.

import { describe, it, expect } from 'vitest';
import { snapshotTimestamp, snapshotFileName } from '../../src/lib/timestamp';

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
