// Регрессия «Прозрачность стен не работает при ПЕРВОЙ загрузке»:
// материал InstancedMesh создаётся один раз (wallsOpacity=1 → opaque, NoBlending),
// и three.js игнорирует изменение .transparent/.opacity на ЖИВОМ материале без
// needsUpdate — «чинилось» только пересозданием меша (смена count → key при
// смене проекта). Фикс: src/scene/wallMaterial.ts — applyWallOpacity() вызывается
// из useEffect([opacity]) в Walls через ref на материал. Тест фиксирует именно это
// поведение: свойства обязаны применяться к уже существующему (не пересозданному)
// объекту-материалу, включая needsUpdate.

import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { applyWallOpacity, type WallMaterialLike } from '../../src/scene/wallMaterial';

describe('applyWallOpacity (регрессия: слайдер прозрачности при первой загрузке)', () => {
  it('spy-материал: transparent/opacity/needsUpdate применяются к ЖИВОМУ объекту', () => {
    // Материал «создан при первой загрузке» со стандартным wallsOpacity = 1.0 → opaque.
    const material = { transparent: false, opacity: 1, needsUpdate: false } as WallMaterialLike;
    const needsUpdateSpy = vi.fn();
    Object.defineProperty(material, 'needsUpdate', {
      get: () => (material as unknown as { __n: boolean }).__n ?? false,
      set: (v: boolean) => {
        (material as unknown as { __n: boolean }).__n = v;
        needsUpdateSpy();
      },
    });

    // Движение слайдера БЕЗ пересоздания меша/материала.
    applyWallOpacity(material, 0.35);

    expect(material.transparent).toBe(true); // opaque → transparent
    expect(material.opacity).toBe(0.35);
    expect(needsUpdateSpy).toHaveBeenCalledTimes(1); // без него three.js останется на NoBlending-пассе
    expect(material.needsUpdate).toBe(true);

    // Возврат слайдера в 1.0 — обратно в opaque, всё равно через needsUpdate
    // (смена transparent в обе стороны меняет шейдерный путь).
    applyWallOpacity(material, 1);
    expect(material.transparent).toBe(false);
    expect(material.opacity).toBe(1);
    expect(needsUpdateSpy).toHaveBeenCalledTimes(2);
  });

  it('реальный THREE.MeshLambertMaterial: свойства существуют и переключаются на смонтированном материале', () => {
    const material = new THREE.MeshLambertMaterial({ transparent: false, opacity: 1 });
    expect(material.transparent).toBe(false);
    const versionBefore = material.version;

    // three r169: needsUpdate — только setter (get'а нет) — он инкрементирует version,
    // и именно это триггерит пересборку шейдерной программы в рендере.
    applyWallOpacity(material, 0.5);
    expect(material.transparent).toBe(true);
    expect(material.opacity).toBe(0.5);
    expect(material.version).toBeGreaterThan(versionBefore); // needsUpdate сработал

    const versionMid = material.version;
    applyWallOpacity(material, 0.75);
    expect(material.opacity).toBe(0.75);
    expect(material.version).toBeGreaterThan(versionMid);
  });

  it('границы: opacity === 1 → opaque, opacity < 1 (включая 0) → transparent', () => {
    for (const [opacity, expectedTransparent] of [
      [1, false],
      [0.999, true],
      [0.5, true],
      [0, true],
    ] as const) {
      const material = { transparent: !expectedTransparent, opacity: 1 - opacity } as WallMaterialLike;
      // намеренно «неверное» стартовое состояние — функция обязана привести к верному
      material.transparent = !expectedTransparent;
      applyWallOpacity(material, opacity);
      expect(material.transparent).toBe(expectedTransparent);
      expect(material.opacity).toBe(opacity);
    }
  });
});
