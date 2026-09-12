// Тулбар над сценой (ТЗ 04 §4.4, §10) — заглушка скелета: пресеты видов + PNG.
// Применение позиций камеры и экспорт снапшота — подзадача 5 (нужна сцена).

import { useViewer } from '../state/viewerStore';
import { ru } from '../i18n/ru';
import type { CameraPreset } from '../state/viewerStore';

const PRESETS: Array<{ preset: CameraPreset; label: string }> = [
  { preset: 'iso', label: ru.presetIso },
  { preset: 'top', label: ru.presetTop },
  { preset: 'front', label: ru.presetFront },
];

export function Toolbar() {
  const { state, dispatch } = useViewer();
  const disabled = state.report === null;
  return (
    <div className="toolbar" role="toolbar">
      {PRESETS.map(({ preset, label }) => (
        <button
          key={preset}
          type="button"
          disabled={disabled}
          title={disabled ? ru.disabledHint : undefined}
          className={state.cameraPreset === preset ? 'active' : ''}
          onClick={() => dispatch({ type: 'CAMERA_PRESET', preset })}
        >
          {label}
        </button>
      ))}
      <button type="button" disabled={disabled} title={ru.pngSnapshotButton}>
        PNG
      </button>
    </div>
  );
}
