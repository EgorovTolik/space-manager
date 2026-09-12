// Панель «Параметры» (ТЗ 04 §3): числовые поля с диапазонами/шагами из таблицы,
// текстовая единица ≤ 10 символов, чекбоксы, слайдер прозрачности (неактивен при
// hideWalls — значение сохраняется), «Сбросить параметры» → RESET_PARAMS.

import { useViewer } from '../state/viewerStore';
import type { ViewParams } from '../state/viewerStore';
import { ru } from '../i18n/ru';

/** Диапазоны параметров (таблица ТЗ 04 §3). */
const RANGES = {
  scale: { min: 0.1, max: 50, step: 0.1 },
  wallHeight: { min: 0.1, max: 20, step: 0.1 },
  wallThickness: { min: 0.05, max: 2, step: 0.05 },
} as const;

const UNIT_LABEL_MAX_LENGTH = 10;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

interface NumberRowProps {
  label: string;
  keyName: keyof typeof RANGES;
  params: ViewParams;
  disabled: boolean;
  onChange: (patch: Partial<ViewParams>) => void;
}

function NumberRow({ label, keyName, params, disabled, onChange }: NumberRowProps) {
  const range = RANGES[keyName];
  return (
    <div className="param-row">
      <label htmlFor={`param-${keyName}`}>{label}</label>
      <input
        id={`param-${keyName}`}
        className="params-input"
        type="number"
        min={range.min}
        max={range.max}
        step={range.step}
        value={params[keyName]}
        disabled={disabled}
        onChange={(e) => {
          const value = Number.parseFloat(e.target.value);
          if (Number.isFinite(value)) {
            onChange({ [keyName]: clamp(value, range.min, range.max) } as Partial<ViewParams>);
          }
        }}
      />
    </div>
  );
}

export function ParamsPanel() {
  const { state, dispatch } = useViewer();
  const disabled = state.report === null;
  const params = state.params;
  const set = (patch: Partial<ViewParams>): void => dispatch({ type: 'PARAMS_SET', patch });

  return (
    <section className="panel panel-params" aria-label={ru.panelParams}>
      <h2>{ru.panelParams}</h2>
      <div className={disabled ? 'muted' : ''} title={disabled ? ru.disabledHint : undefined}>
        <NumberRow label={ru.paramScale} keyName="scale" params={params} disabled={disabled} onChange={set} />
        <NumberRow
          label={ru.paramWallHeight}
          keyName="wallHeight"
          params={params}
          disabled={disabled}
          onChange={set}
        />
        <NumberRow
          label={ru.paramWallThickness}
          keyName="wallThickness"
          params={params}
          disabled={disabled}
          onChange={set}
        />
        <div className="param-row">
          <label htmlFor="param-unit">{ru.paramUnit}</label>
          <input
            id="param-unit"
            className="params-input"
            type="text"
            maxLength={UNIT_LABEL_MAX_LENGTH}
            value={params.unitLabel}
            disabled={disabled}
            onChange={(e) => set({ unitLabel: e.target.value.slice(0, UNIT_LABEL_MAX_LENGTH) })}
          />
        </div>
        <div className="param-row">
          <label htmlFor="param-show-blocked">{ru.paramShowBlocked}</label>
          <input
            id="param-show-blocked"
            type="checkbox"
            checked={params.showBlocked}
            disabled={disabled}
            onChange={(e) => set({ showBlocked: e.target.checked })}
          />
        </div>
        <div className="param-row">
          <label htmlFor="param-opacity">{ru.paramWallsOpacity}</label>
          <span className="opacity-control">
            {/* при hideWalls слайдер неактивен, значение сохраняется (ТЗ 04 §3) */}
            <input
              id="param-opacity"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={params.wallsOpacity}
              disabled={disabled || params.hideWalls}
              onChange={(e) => set({ wallsOpacity: Number.parseFloat(e.target.value) })}
            />
            <span className="opacity-value">{params.wallsOpacity.toFixed(2)}</span>
          </span>
        </div>
        <div className="param-row">
          <label htmlFor="param-hide-walls">{ru.paramHideWalls}</label>
          <input
            id="param-hide-walls"
            type="checkbox"
            checked={params.hideWalls}
            disabled={disabled}
            onChange={(e) => set({ hideWalls: e.target.checked })}
          />
        </div>
        <div className="param-row">
          <label htmlFor="param-show-labels">{ru.paramShowLabels}</label>
          <input
            id="param-show-labels"
            type="checkbox"
            checked={params.showLabels}
            disabled={disabled}
            onChange={(e) => set({ showLabels: e.target.checked })}
          />
        </div>
        <button type="button" disabled={disabled} onClick={() => dispatch({ type: 'RESET_PARAMS' })}>
          {ru.resetParamsButton}
        </button>
      </div>
    </section>
  );
}
