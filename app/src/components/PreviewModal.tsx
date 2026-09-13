// Модальное окно предпросмотра (ТЗ 03 §3): картинка в оригинальном качестве,
// под ней имя файла и дата; закрытие — крестик / фон / Esc.
import Modal from './Modal';
import { formatDate } from '../lib/format';

interface PreviewModalProps {
  url: string;
  name: string;
  mtimeIso: string;
  onClose: () => void;
}

export default function PreviewModal({ url, name, mtimeIso, onClose }: PreviewModalProps): JSX.Element {
  return (
    <Modal wide onClose={onClose}>
      <img className="preview-full" src={url} alt={name} />
      <p className="muted preview-caption">
        {name} · {formatDate(mtimeIso)}
      </p>
    </Modal>
  );
}
