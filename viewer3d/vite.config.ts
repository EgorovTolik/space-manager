import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// ТЗ 01 §2.6: dev-сервер Vite на 5174, proxy /api → Express (localhost:3200).
// Порты отличаемые от editor/ (5173/3000), чтобы редактор и viewer работали одновременно.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/api': 'http://localhost:3200',
    },
  },
});
