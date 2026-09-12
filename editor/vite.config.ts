import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// ТЗ 01 §2.6 / 03 §3: dev-сервер Vite на 5173, proxy /api → Express (localhost:3000).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
