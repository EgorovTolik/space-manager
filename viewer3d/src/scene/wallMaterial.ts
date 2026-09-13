// Прозрачность стен (регрессия после ручного тестирования): three.js НЕ применяет
// смену material.transparent / material.opacity на УЖЕ СМОНТИРОВАННОМ материале без
// пересборки шейдерной программы — при wallsOpacity = 1 материал создаётся opaque
// (NoBlending), и «докрутка» .opacity визуально игнорируется, пока меш не
// пересоздан (например, сменой count → key). Поэтому свойства всегда применяем
// явно к ЖИВОМУ материале через ref + needsUpdate.

/** Структурный тип: всё, что нужно для применения прозрачности (three Material). */
export interface WallMaterialLike {
  transparent: boolean;
  opacity: number;
  /** three.js требует сброс программы при смене transparent → true. */
  needsUpdate: boolean;
}

/**
 * Применить прозрачность стен к живому материалу БЕЗ пересоздания меша.
 * Вынесено в чистую функцию — регрессионный unit-тест проверяет её на spy-материале.
 */
export function applyWallOpacity(material: WallMaterialLike, opacity: number): void {
  material.transparent = opacity < 1;
  material.opacity = opacity;
  // Смена transparent (в обе стороны) меняет шейдерный путь (NoBlending ↔ NormalBlending) —
  // без needsUpdate three.js отрисует старый opaque-пасс и слайдер «не работает».
  material.needsUpdate = true;
}
