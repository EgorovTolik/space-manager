// Модалка переименования (ТЗ 03 §2): поле нового имени + [Сохранить]/[Отмена].
// Валидация slug — та же, что при создании; ошибки API (409/404) App показывает
// баннером, модалка остаётся открытой.
import { useState } from 'react';

import Modal from './Modal';
import { ru } from '../i18n/ru';
import { isValidSlug } from '../lib/slug';

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
    if (!isValidSlug(value)) {
      setError(ru.create.invalidSlug);
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
