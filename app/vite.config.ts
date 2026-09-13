import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// ТЗ 01 §5: dev-сервер менеджера на 5175, proxy /api → единый API (localhost:4080).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    proxy: {
      '/api': 'http://localhost:4080',
    },
  },
});
