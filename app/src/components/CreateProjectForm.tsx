// Inline-форма создания проекта в шапке (ТЗ 03 §2): поле имени + [Создать]/[Отмена].
// Замечание 2: произвольное человекочитаемое имя (кириллица/пробелы/регистр);
// slug генерирует сервер. Валидация display-name ДО отправки; ошибки API — inline.
import { useState } from 'react';

import { ru } from '../i18n/ru';
import { ApiRequestError } from '../lib/api';
import { isValidProjectName } from '../lib/slug';

interface CreateProjectFormProps {
  /** Бросает ApiRequestError при ошибке — форма показывает её inline. */
  onSubmit: (name: string) => Promise<void>;
  onCancel: () => void;
}

export default function CreateProjectForm({ onSubmit, onCancel }: CreateProjectFormProps): JSX.Element {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    if (!isValidProjectName(value)) {
      setError(ru.create.invalidName);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(value); // успех → форма скрывается в App (перезапрос списка)
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <form
      className="inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <input
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
        placeholder={ru.create.placeholder}
        aria-label={ru.create.placeholder}
        autoFocus
      />
      <button type="submit" disabled={busy}>
        {busy ? ru.create.creating : ru.create.submit}
      </button>
      <button type="button" onClick={onCancel} disabled={busy}>
        {ru.create.cancel}
      </button>
      {error && <span className="field-error">{error}</span>}
    </form>
  );
}
