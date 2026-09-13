// 3D-сцена (ТЗ 04 §4–§8, 03 §1/§8–§9): базовая плита, полы комнат, стены и blocked-
// блоки (InstancedMesh), подписи (drei Html), OrbitControls с пресетами и фокусом на
// комнате, PNG-снапшот. Все размеры — мировые единицы, системы координат — ТЗ 03 §1.

import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Html } from '@react-three/drei';
import * as THREE from 'three';
import { useViewer, type CameraPreset } from '../state/viewerStore';
import type { ParsedReport, Room } from '../lib/reportParser';
import { symbolPalette, UNKNOWN_SYMBOL_COLOR } from '../lib/palette';
import type { WallBox } from '../lib/walls';
import { presetCamera, roomFocus, type V3 } from './cameraMath';
import { buildRoomFloorGeometry } from './roomFloor';
import { getSnapshotTarget, setSnapshotHandler } from './snapshot';
import { savePreview } from '../lib/api';
import { snapshotFileName } from '../lib/timestamp';
import { ru } from '../i18n/ru';

// Константы сцены (ТЗ 03 §1/§9)
const SCENE_BACKGROUND = '#f2f4f7';
const BASE_PLATE_COLOR = '#c9ced3';
const BASE_PLATE_THICKNESS = 0.25; // константа, не параметр (ТЗ 03 §1)
const WALL_COLOR = '#e0e0e0';
const BLOCKED_COLOR = '#444444';
// (FLOOR_EPS_FACTOR вынесен в src/scene/roomFloor.ts)
/** Подписи — только для комнат не меньше этого числа клеток (ТЗ 04 §8). */
export const LABEL_MIN_CELLS = 4;

interface SceneProps {
  /** Боксы стен (с debounce), вычислены в App через useWallBoxes. */
  wallBoxes: WallBox[];
}

export function Scene({ wallBoxes }: SceneProps) {
  const { state, dispatch } = useViewer();
  const report = state.report;
  const palette = useMemo(
    () => (report === null ? new Map<string, string>() : symbolPalette(report.map)),
    [report],
  );

  return (
    <Canvas
      // preserveDrawingBuffer обязателен для PNG-снапшота (ТЗ 04 §10)
      gl={{ preserveDrawingBuffer: true, antialias: true }}
      camera={{ position: [6, 5.4, 6], fov: 50 }}
      // клик по пустому месту сцены — снять выделение (ТЗ 04 §7)
      onPointerMissed={() => dispatch({ type: 'SELECT_ROOM', roomId: null })}
    >
      <color attach="background" args={[SCENE_BACKGROUND]} />
      {/* Освещение фиксировано (ТЗ 03 §9): ambient 0.6 + directional из (50,100,30), 0.8 */}
      <ambientLight intensity={0.6} />
      <directionalLight position={[50, 100, 30]} intensity={0.8} />
      {/* OrbitControls: вращение ЛКМ, панорама ПКМ, зум колесо; демпфирование (ТЗ 04 §4.2).
          makeDefault — чтобы CameraRig доставал контролы из state.controls. */}
      <OrbitControls makeDefault enableDamping maxPolarAngle={Math.PI} />

      <CameraRig
        report={report}
        preset={state.cameraPreset}
        selection={state.selection}
        scale={state.params.scale}
        wallHeight={state.params.wallHeight}
      />

      {report !== null && (
        <>
          <BasePlate
            W={report.width}
            H={report.height}
            S={state.params.scale}
            onDeselect={() => dispatch({ type: 'SELECT_ROOM', roomId: null })}
          />
          {report.rooms.map((room) => (
            <RoomFloor
              key={room.index}
              room={room}
              W={report.width}
              H={report.height}
              S={state.params.scale}
              color={palette.get(room.symbol) ?? UNKNOWN_SYMBOL_COLOR}
              selected={state.selection === room.index}
              onSelect={(roomId) => dispatch({ type: 'SELECT_ROOM', roomId })}
            />
          ))}
          <Walls
            boxes={wallBoxes}
            height={state.params.wallHeight}
            opacity={state.params.wallsOpacity}
            hidden={state.params.hideWalls}
          />
          <BlockedCells
            cells={report.blockedCells}
            W={report.width}
            H={report.height}
            S={state.params.scale}
            height={state.params.wallHeight}
            visible={state.params.showBlocked}
          />
          {state.params.showLabels && (
            <RoomLabels
              rooms={report.rooms}
              W={report.width}
              H={report.height}
              S={state.params.scale}
              wallHeight={state.params.wallHeight}
            />
          )}
        </>
      )}

      <SnapshotBinder />
    </Canvas>
  );
}

// ---------------------------------------------------------------------------
// Камера: пресеты + фокус на комнате (ТЗ 04 §4.4, §5) — мгновенно, без анимации
// ---------------------------------------------------------------------------

/** Минимальный интерфейс OrbitControls (drei/three-stdlib): цель + update. */
interface ControlsLike {
  target: THREE.Vector3;
  update: () => void;
}

function CameraRig({
  report,
  preset,
  selection,
  scale,
  wallHeight,
}: {
  report: ParsedReport | null;
  preset: CameraPreset;
  selection: number | null;
  scale: number;
  wallHeight: number;
}) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as ControlsLike | null;

  const appliedReport = useRef<ParsedReport | null>(null);
  const appliedPreset = useRef<CameraPreset | null>(null);
  const appliedSelection = useRef<number | null>(null);

  const applyPose = (pose: { position: V3; target: V3 }): void => {
    if (controls === null) return;
    camera.position.set(pose.position[0], pose.position[1], pose.position[2]);
    controls.target.set(pose.target[0], pose.target[1], pose.target[2]);
    controls.update();
  };

  // Новый отчёт → начальный вид «Изометрия» (ТЗ 04 §4.4), сброс отслеживания команд.
  useEffect(() => {
    if (report === null || appliedReport.current === report) return;
    appliedReport.current = report;
    appliedPreset.current = null;
    appliedSelection.current = null;
    applyPose(presetCamera('iso', report.width, report.height, scale, wallHeight));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report, controls]);

  // Смена пресета (кнопка/клавиша) → позиция по таблице ТЗ 04 §4.4.
  useEffect(() => {
    if (report === null || appliedReport.current !== report) return;
    if (preset === appliedPreset.current) return;
    appliedPreset.current = preset;
    applyPose(presetCamera(preset, report.width, report.height, scale, wallHeight));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, controls]);

  // Выделение комнаты (клик в списке/в сцене) → фокус по формуле ТЗ 04 §5.
  // Снятие выделения — без движения камеры.
  useEffect(() => {
    if (report === null || appliedReport.current !== report) return;
    if (selection === null) {
      appliedSelection.current = null;
      return;
    }
    if (selection === appliedSelection.current) return;
    const room = report.rooms.find((r) => r.index === selection);
    appliedSelection.current = selection;
    if (room === undefined || controls === null) return;
    applyPose(
      roomFocus(room, report.width, report.height, scale, wallHeight, [
        camera.position.x,
        camera.position.y,
        camera.position.z,
      ]),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, controls]);

  return null;
}

// ---------------------------------------------------------------------------
// Базовая плита (ТЗ 03 §9): бокс (W+8)·S × 0.25 × (H+8)·S, верхняя грань y = 0
// ---------------------------------------------------------------------------

function BasePlate({ W, H, S, onDeselect }: { W: number; H: number; S: number; onDeselect: () => void }) {
  return (
    <mesh
      position={[0, -BASE_PLATE_THICKNESS / 2, 0]}
      // клик по плите — снять выделение (ТЗ 04 §7)
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        onDeselect();
      }}
    >
      <boxGeometry args={[(W + 8) * S, BASE_PLATE_THICKNESS, (H + 8) * S]} />
      <meshLambertMaterial color={BASE_PLATE_COLOR} />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// Пол комнаты (ТЗ 03 §9): геометрия — src/scene/roomFloor.ts; один mesh на комнату,
// чтобы emissive-подсветка выделения затронула только эту комнату.
// ---------------------------------------------------------------------------

function RoomFloor({
  room,
  W,
  H,
  S,
  color,
  selected,
  onSelect,
}: {
  room: Room;
  W: number;
  H: number;
  S: number;
  color: string;
  selected: boolean;
  onSelect: (roomId: number) => void;
}) {
  const geometry = useMemo(() => buildRoomFloorGeometry(room, W, H, S), [room, W, H, S]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh
      geometry={geometry}
      // клик по полу — выделить комнату (ТЗ 04 §7)
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        onSelect(room.index);
      }}
      onPointerOver={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        document.body.style.cursor = 'default';
      }}
    >
      {/* выделение — emissive-подсветка тем же цветом, intensity 0.25 (ТЗ 04 §7) */}
      <meshLambertMaterial
        color={color}
        emissive={selected ? color : '#000000'}
        emissiveIntensity={selected ? 0.25 : 0}
      />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// Стены: один InstancedMesh из боксов buildWallBoxes (ТЗ 03 §6/§9)
// ---------------------------------------------------------------------------

function Walls({
  boxes,
  height,
  opacity,
  hidden,
}: {
  boxes: WallBox[];
  height: number;
  opacity: number;
  hidden: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const count = Math.max(boxes.length, 1);

  useEffect(() => {
    const mesh = ref.current;
    if (mesh === null) return;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const size = new THREE.Vector3();
    boxes.forEach((box, i) => {
      position.set(box.x, height / 2, box.z); // Y-диапазон 0…Hw (ТЗ 03 §1)
      size.set(box.sx, height, box.sz);
      matrix.compose(position, quaternion, size);
      mesh.setMatrixAt(i, matrix);
    });
    mesh.count = boxes.length;
    mesh.instanceMatrix.needsUpdate = true;
  }, [boxes, height]);

  if (hidden || boxes.length === 0) return null;
  // key по count: args InstancedMesh фиксирует количество при конструировании.
  // frustumCulled=false: bounding sphere базового бокса не покрывает все инстансы.
  return (
    <instancedMesh key={count} ref={ref} args={[undefined, undefined, count]} frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
      <meshLambertMaterial color={WALL_COLOR} transparent={opacity < 1} opacity={opacity} />
    </instancedMesh>
  );
}

// ---------------------------------------------------------------------------
// Blocked-блоки (ТЗ 03 §8): бокс (S, Hw, S) на каждую клетку '*', вровень со стенами
// ---------------------------------------------------------------------------

function BlockedCells({
  cells,
  W,
  H,
  S,
  height,
  visible,
}: {
  cells: Array<[number, number]>;
  W: number;
  H: number;
  S: number;
  height: number;
  visible: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const count = Math.max(cells.length, 1);

  useEffect(() => {
    const mesh = ref.current;
    if (mesh === null) return;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const size = new THREE.Vector3(S, height, S);
    cells.forEach(([x, y], i) => {
      // центр клетки: (x+0.5−W/2)·S, Hw/2, (y+0.5−H/2)·S (ТЗ 03 §8)
      position.set((x + 0.5 - W / 2) * S, height / 2, (y + 0.5 - H / 2) * S);
      matrix.compose(position, quaternion, size);
      mesh.setMatrixAt(i, matrix);
    });
    mesh.count = cells.length;
    mesh.instanceMatrix.needsUpdate = true;
  }, [cells, W, H, S, height]);

  if (!visible || cells.length === 0) return null;
  return (
    <instancedMesh key={count} ref={ref} args={[undefined, undefined, count]} frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
      <meshLambertMaterial color={BLOCKED_COLOR} />
    </instancedMesh>
  );
}

// ---------------------------------------------------------------------------
// Подписи комнат (ТЗ 04 §8): drei Html в (cx, Hw·0.5, cz), только size ≥ 4 клеток
// ---------------------------------------------------------------------------

function RoomLabels({
  rooms,
  W,
  H,
  S,
  wallHeight,
}: {
  rooms: Room[];
  W: number;
  H: number;
  S: number;
  wallHeight: number;
}) {
  return (
    <>
      {rooms
        .filter((room) => room.size >= LABEL_MIN_CELLS)
        .map((room) => {
          const cx = (room.centroid.x - W / 2) * S;
          const cz = (room.centroid.y - H / 2) * S;
          return (
            <Html
              key={room.index}
              position={[cx, wallHeight * 0.5, cz]}
              center
              zIndexRange={[100, 0]}
              style={{ pointerEvents: 'none' }} // не перехватывают клики (ТЗ 04 §8)
            >
              <div className="room-label">{room.label}</div>
            </Html>
          );
        })}
    </>
  );
}

// ---------------------------------------------------------------------------
// PNG-снапшот (ТЗ 04 §10 + docs-unified/04 §2.4): gl.domElement.toBlob → Blob.
// Проектный режим: цель задана (ProjectPanel при загрузке ревизии) → POST
// /api/projects/<p>/preview, имя файла назначает сервер. Ошибка POST — результат
// {error} (баннер панели). Без цели (только dev) — fallback на локальное
// скачивание snapshotFileName(), как в standalone.
// ---------------------------------------------------------------------------

function SnapshotBinder() {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    setSnapshotHandler(async () => {
      const capture = (): Promise<Blob | null> =>
        new Promise<Blob | null>((resolve) => gl.domElement.toBlob(resolve, 'image/png'));
      // Гонка после перестроения сцены (смена ревизии): кадр может ещё не быть
      // готовым — toBlob вернёт null. Одна повторная попытка после следующего кадра;
      // если так и не удалось — видимый баннер ошибки, а не молчание (ТЗ 04 §2.4:
      // результат всегда отражается в статусе/баннере панели).
      let blob = await capture();
      if (blob === null) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        blob = await capture();
      }
      if (blob === null) return { error: ru.snapshotFailed };
      const t = getSnapshotTarget();
      if (t !== null) {
        try {
          const saved = await savePreview(t.projectName, blob);
          return { savedToProject: saved.file };
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) };
        }
      }
      // Fallback: локальное скачивание (docs-unified/04 §2.4).
      const name = snapshotFileName();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = name;
      anchor.click();
      URL.revokeObjectURL(url);
      return { downloaded: name };
    });
    return () => setSnapshotHandler(null);
  }, [gl]);
  return null;
}
