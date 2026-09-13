// Пустой workspace (ТЗ 03 §1): подсказка + две кнопки действий.
import { ru } from '../i18n/ru';

interface EmptyStateProps {
  onCreate: () => void;
  onImport: () => void;
}

export default function EmptyState({ onCreate, onImport }: EmptyStateProps): JSX.Element {
  return (
    <div className="panel empty-state">
      <p>{ru.empty.hint}</p>
      <div className="empty-actions">
        <button type="button" onClick={onCreate}>
          {ru.actions.create}
        </button>
        <button type="button" onClick={onImport}>
          {ru.actions.import}
        </button>
      </div>
    </div>
  );
}
