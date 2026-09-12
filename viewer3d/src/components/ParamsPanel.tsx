// Панель «Параметры» (ТЗ 04 §3) — заглушка скелета: заголовок + подписи полей.
// Реальные поля/слайдеры и debounce-пересчёт — вместе со сценой (подзадача 5).

import { useViewer } from '../state/viewerStore';
import { ru } from '../i18n/ru';

export function ParamsPanel() {
  const { state, dispatch } = useViewer();
  const disabled = state.report === null;
  return (
    <section className="panel panel-params" aria-label={ru.panelParams}>
      <h2>{ru.panelParams}</h2>
      <div className={disabled ? 'muted' : ''} title={disabled ? ru.disabledHint : undefined}>
        <dl className="params-list">
          <dt>{ru.paramScale}</dt>
          <dd>{state.params.scale}</dd>
          <dt>{ru.paramWallHeight}</dt>
          <dd>{state.params.wallHeight}</dd>
          <dt>{ru.paramWallThickness}</dt>
          <dd>{state.params.wallThickness}</dd>
          <dt>{ru.paramUnit}</dt>
          <dd>{state.params.unitLabel}</dd>
          <dt>{ru.paramShowBlocked}</dt>
          <dd>{state.params.showBlocked ? '✓' : ''}</dd>
          <dt>{ru.paramWallsOpacity}</dt>
          <dd>{state.params.wallsOpacity}</dd>
          <dt>{ru.paramHideWalls}</dt>
          <dd>{state.params.hideWalls ? '✓' : ''}</dd>
          <dt>{ru.paramShowLabels}</dt>
          <dd>{state.params.showLabels ? '✓' : ''}</dd>
        </dl>
        <button type="button" disabled={disabled} onClick={() => dispatch({ type: 'RESET_PARAMS' })}>
          {ru.resetParamsButton}
        </button>
      </div>
    </section>
  );
}
