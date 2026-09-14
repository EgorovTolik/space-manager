// Модальное окно предпросмотра (ТЗ 03 §3): картинка в оригинальном качестве,
// под ней имя файла и дата; закрытие — крестик / фон / Esc.
// Навигация: стрелки «←»/«→» листают ВСЮ коллекцию превью текущей карточки
// с wrap-around (с конца — в начало); при >1 превью показывается счётчик «N / M».
import { useState } from 'react';

import Modal from './Modal';
import { ru } from '../i18n/ru';
import type { PreviewEntry } from '../lib/api';
import { formatDate, previewUrl } from '../lib/format';

interface PreviewModalProps {
  /** Slug проекта — для URL превью. */
  slug: string;
  /** Коллекция превью текущей карточки (полный список). */
  entries: PreviewEntry[];
  /** Индекс открытого превью в коллекции. */
  index: number;
  onClose: () => void;
}

export default function PreviewModal({ slug, entries, index, onClose }: PreviewModalProps): JSX.Element {
  const [idx, setIdx] = useState(() => Math.min(Math.max(0, index), Math.max(0, entries.length - 1)));
  const count = entries.length;
  const many = count > 1;
  // Wrap-around: из конца — в начало и наоборот.
  const prev = (): void => setIdx((i) => (i - 1 + count) % count);
  const next = (): void => setIdx((i) => (i + 1) % count);

  const cur = entries[idx] ?? entries[0];
  // Не бывает: карточка рендерит превью только при непустом списке; защита от гонок.
  if (!cur) return <></>;

  return (
    <Modal wide onClose={onClose}>
      <div className="preview-stage">
        {many && (
          <button type="button" className="preview-nav prev" aria-label={ru.previewPrevAria} onClick={prev}>
            ←
          </button>
        )}
        <img className="preview-full" src={previewUrl(slug, cur.name)} alt={cur.name} />
        {many && (
          <button type="button" className="preview-nav next" aria-label={ru.previewNextAria} onClick={next}>
            →
          </button>
        )}
      </div>
      <p className="muted preview-caption">
        {cur.name} · {formatDate(cur.mtimeIso)}
        {many && <span className="preview-counter">{idx + 1} / {count}</span>}
      </p>
    </Modal>
  );
}
