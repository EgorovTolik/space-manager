// Unit-тесты реестра PNG-снапшота (ТЗ 04 §10 + docs-unified/04 §2.2/§2.4):
// асинхронный контракт takeSnapshot, цель сохранения (setSnapshotTarget),
// рассылка результатов слушателям.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  setSnapshotHandler,
  setSnapshotTarget,
  getSnapshotTarget,
  onSnapshotResult,
  takeSnapshot,
  type SnapshotResult,
} from '../../src/scene/snapshot';

// Реестр — модульное состояние: сбрасываем между тестами.
beforeEach(() => {
  setSnapshotHandler(null);
  setSnapshotTarget(null);
});

describe('snapshot registry (docs-unified/04 §2.2/§2.4)', () => {
  it('takeSnapshot без обработчика → null, слушатели не вызываются', async () => {
    const seen: SnapshotResult[] = [];
    const off = onSnapshotResult((r) => seen.push(r));
    expect(await takeSnapshot()).toBeNull();
    expect(seen).toEqual([]);
    off();
  });

  it('takeSnapshot → результат обработчика; слушатель получает тот же объект', async () => {
    const result: SnapshotResult = { savedToProject: 'preview-20260913-140207.png' };
    setSnapshotHandler(async () => result);
    const seen: SnapshotResult[] = [];
    const off = onSnapshotResult((r) => seen.push(r));
    const got = await takeSnapshot();
    expect(got).toBe(result);
    expect(seen).toEqual([result]);
    off();
  });

  it('обработчик без кадра (null) → слушатели НЕ вызываются', async () => {
    setSnapshotHandler(async () => null);
    const seen: SnapshotResult[] = [];
    const off = onSnapshotResult((r) => seen.push(r));
    expect(await takeSnapshot()).toBeNull();
    expect(seen).toEqual([]);
    off();
  });

  it('setSnapshotTarget/getSnapshotTarget: установка, чтение, снятие (null)', () => {
    expect(getSnapshotTarget()).toBeNull();
    setSnapshotTarget({ projectName: 'demo' });
    expect(getSnapshotTarget()).toEqual({ projectName: 'demo' });
    setSnapshotTarget(null);
    expect(getSnapshotTarget()).toBeNull();
  });

  it('отписка от onSnapshotResult работает', async () => {
    setSnapshotHandler(async () => ({ downloaded: 'viewer3d-snapshot-x.png' }));
    const seen: SnapshotResult[] = [];
    const off = onSnapshotResult((r) => seen.push(r));
    off();
    await takeSnapshot();
    expect(seen).toEqual([]);
  });
});
