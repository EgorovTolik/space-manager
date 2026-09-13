// Модалка подтверждения удаления (ТЗ 03 §2/§4): [Удалить] (красная) / [Отмена].
// Пока запрос в полёте — обе кнопки заблокированы (двойной клик невозможен).
import Modal from './Modal';
import { ru, t } from '../i18n/ru';

interface ConfirmDeleteModalProps {
  name: string;
  busy: boolean;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

export default function ConfirmDeleteModal({ name, busy, onConfirm, onCancel }: ConfirmDeleteModalProps): JSX.Element {
  return (
    <Modal title={ru.confirmDelete.title} locked={busy} onClose={onCancel}>
      <p>{t(ru.confirmDelete.body, { name })}</p>
      <div className="modal-actions">
        <button type="button" className="danger" onClick={() => void onConfirm()} disabled={busy}>
          {busy ? ru.confirmDelete.deleting : ru.confirmDelete.delete}
        </button>
        <button type="button" onClick={onCancel} disabled={busy}>
          {ru.confirmDelete.cancel}
        </button>
      </div>
    </Modal>
  );
}
