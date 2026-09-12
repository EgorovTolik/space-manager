// 3D-сцена (ТЗ 04 §4) — скелет: пустой R3F Canvas с OrbitControls, светом и фоном.
// Контент (BasePlate, RoomFloor, Walls, BlockedBoxes, RoomLabels, пресеты камеры)
// добавляется в подзадачах 4–5.

import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';

/** Цвет фона сцены (ТЗ 03 §9): #f2f4f7. */
const SCENE_BACKGROUND = '#f2f4f7';

export function Scene() {
  return (
    <Canvas
      // preserveDrawingBuffer обязателен для PNG-снапшота (ТЗ 04 §10)
      gl={{ preserveDrawingBuffer: true, antialias: true }}
      camera={{ position: [6, 5.4, 6], fov: 50 }}
    >
      <color attach="background" args={[SCENE_BACKGROUND]} />
      {/* Освещение фиксировано (ТЗ 03 §9): ambient 0.6 + directional из (50,100,30), 0.8 */}
      <ambientLight intensity={0.6} />
      <directionalLight position={[50, 100, 30]} intensity={0.8} />
      {/* OrbitControls: вращение ЛКМ, панорама ПКМ, зум колесо; демпфирование (ТЗ 04 §4.2).
          Цель по умолчанию — центр сетки на половине высоты стен; без ограничения «под пол». */}
      <OrbitControls enableDamping target={[0, 1.5, 0]} maxPolarAngle={Math.PI} />
    </Canvas>
  );
}
