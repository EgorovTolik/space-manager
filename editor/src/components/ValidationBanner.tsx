// Баннер ошибок валидации (ТЗ 04 §1/§7, ТЗ 05 §3 п.1).
// Левая колонка, под панелью файлов: «⚠ Ошибки валидации (N)», клик → раскрывающийся
// список «код + message». Данные — state.ui.errors (пересчёт в GridCanvas с debounce 300 мс).
import { useState } from 'react';
import type { CSSProperties } from 'react';
import { ru } from '../i18n/ru';
import { useEditor } from '../state/editorStore';

const baseStyle: CSSProperties = { padding: '6px 8px', borderRadius: 4, border: '1px solid #ccc' };
const warnStyle: CSSProperties = { ...baseStyle, background: '#fdecea', borderColor: '#e53935' };
const okStyle: CSSProperties = { ...baseStyle, background: '#f0f7f0', borderColor: '#c3e6cb' };

export default function ValidationBanner(): JSX.Element {
  const { state } = useEditor();
  const errors = state.ui.errors;
  const [open, setOpen] = useState(false);

  return (
    <section className="panel validation-banner" style={errors.length > 0 ? warnStyle : okStyle}>
      {/* Единственная кнопка панели — на всю ширину (правило одиночной кнопки
          styles.css); прозрачный «текстовый» вид сохранён инлайн-стилями. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'block',
          width: '100%',
          textAlign: 'left',
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: errors.length > 0 ? 'pointer' : 'default',
          fontWeight: 700,
          color: errors.length > 0 ? '#c62828' : '#4a7a4a',
          fontSize: 13,
        }}
      >
        {errors.length > 0 ? `⚠ ${ru.validationBanner.title} (${errors.length})` : ru.validationBanner.noErrors}
      </button>
      {open && errors.length > 0 && (
        <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12 }}>
          {errors.map((e, i) => (
            <li key={`${e.code}-${i}`} style={{ marginBottom: 4 }}>
              <code>{e.code}</code> — {e.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
