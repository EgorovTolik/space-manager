// Общий каркас модального окна (ТЗ 03 §2/§3): фон-оверлей, панель, закрытие
// крестиком / кликом по фону / Esc; пока модалка открыта — скролл страницы
// блокируется. `locked` — запрос в полёте: закрытие запрещено.
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

import { ru } from '../i18n/ru';

interface ModalProps {
  title?: string;
  onClose: () => void;
  /** Запрет закрытия (запрос в полёте) — ТЗ 03 §2 «кнопка блокируется». */
  locked?: boolean;
  /** Широкая модалка (превью картинки). */
  wide?: boolean;
  children: ReactNode;
}

export default function Modal({ title, onClose, locked = false, wide = false, children }: ModalProps): JSX.Element {
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !lockedRef.current) closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; // ТЗ 03 §3: скролл блокируется
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !lockedRef.current) closeRef.current();
      }}
    >
      <div role="dialog" aria-modal="true" className={wide ? 'modal wide' : 'modal'}>
        {title && <h2>{title}</h2>}
        <button
          type="button"
          className="modal-close"
          aria-label={ru.closeAria}
          disabled={locked}
          onClick={() => {
            if (!lockedRef.current) closeRef.current();
          }}
        >
          ✕
        </button>
        {children}
      </div>
    </div>
  );
}
