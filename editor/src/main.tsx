// Точка входа SPA.
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css'; // единая система кнопок (ручное тестирование, раунд 4)

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Не найден элемент #root');
}

createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
