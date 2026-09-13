// Модалка переименования (ТЗ 03 §2): поле нового имени + [Сохранить]/[Отмена].
// Замечание 2: меняется только человекочитаемое имя (display-name); каталог и
// slug не изменяются. Валидация — та же, что при создании; ошибки API App
// показывает баннером, модалка остаётся открытой.
import { useState } from 'react';

import Modal from './Modal';
import { ru } from '../i18n/ru';
import { isValidProjectName } from '../lib/slug';

interface RenameDialogProps {
  initialName: string;
  /** Бросает ApiRequestError при ошибке (App ловит и показывает баннер). */
  onSave: (newName: string) => Promise<void>;
  onClose: () => void;
}

export default function RenameDialog({ initialName, onSave, onClose }: RenameDialogProps): JSX.Element {
  const [value, setValue] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (): Promise<void> => {
    if (!isValidProjectName(value)) {
      setError(ru.create.invalidName);
      return;
    }
    setBusy(true);
    setError(null);
    let ok = false;
    try {
      await onSave(value); // успех → App закрывает модалку и перезапрашивает список
      ok = true;
    } finally {
      // при ошибке onSave бросает — App показывает баннер, модалка остаётся открытой
      if (!ok) setBusy(false);
    }
  };

  return (
    <Modal title={ru.rename.title} locked={busy} onClose={onClose}>
      <input
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
        aria-label={ru.rename.newLabel}
        autoFocus
      />
      <p className="muted rename-hint">{ru.rename.hint}</p>
      {error && <p className="field-error">{error}</p>}
      <div className="modal-actions">
        <button type="button" onClick={() => void save()} disabled={busy}>
          {busy ? ru.rename.saving : ru.rename.save}
        </button>
        <button type="button" onClick={onClose} disabled={busy}>
          {ru.rename.cancel}
        </button>
      </div>
    </Modal>
  );
}
