// Тулбар над сценой (ТЗ 04 §4.4, §10): пресеты видов (ISO/top/front) + PNG-снапшот.
// Применение позиций камеры — CameraRig в сцене (по state.cameraPreset); снапшот —
// через реестр scene/snapshot.ts (обработчик регистрирует SnapshotBinder).

import { useViewer } from '../state/viewerStore';
import type { CameraPreset } from '../state/viewerStore';
import { takeSnapshot } from '../scene/snapshot';
import { ru } from '../i18n/ru';

const PRESETS: Array<{ preset: CameraPreset; label: string; hotkey: string }> = [
  { preset: 'iso', label: ru.presetIso, hotkey: '1' },
  { preset: 'top', label: ru.presetTop, hotkey: '2' },
  { preset: 'front', label: ru.presetFront, hotkey: '3' },
];

export function Toolbar() {
  const { state, dispatch } = useViewer();
  const disabled = state.report === null;
  return (
    <div className="toolbar" role="toolbar">
      {PRESETS.map(({ preset, label, hotkey }) => (
        <button
          key={preset}
          type="button"
          disabled={disabled}
          title={disabled ? ru.disabledHint : `${label} (${hotkey})`}
          className={state.cameraPreset === preset ? 'active' : ''}
          onClick={() => dispatch({ type: 'CAMERA_PRESET', preset })}
        >
          {label}
        </button>
      ))}
      <button
        type="button"
        disabled={disabled}
        title={disabled ? ru.disabledHint : ru.pngSnapshotTitle}
        onClick={() => takeSnapshot()}
      >
        {ru.pngSnapshotButton}
      </button>
    </div>
  );
}
