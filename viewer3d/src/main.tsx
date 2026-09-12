// Точка входа SPA (ТЗ 01 §2.4).

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ViewerProvider } from './state/viewerStore';
import './styles.css';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Не найден контейнер #root в index.html');
}

createRoot(container).render(
  <StrictMode>
    <ViewerProvider>
      <App />
    </ViewerProvider>
  </StrictMode>,
);
