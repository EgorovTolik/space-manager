import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Единый сервис (docs-unified/01 §5 / 04 §1.7): base '/editor/' — раздача с :4080
// под /editor/*; dev-сервер Vite на 5173, proxy /api → единый сервис (localhost:4080).
export default defineConfig({
  base: '/editor/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4080',
    },
  },
});
