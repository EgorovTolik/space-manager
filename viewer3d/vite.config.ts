import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Единый сервис (docs-unified/01 §5 / 04 §2.2): base '/viewer3d/' — раздача с :4080
// под /viewer3d/*; dev-сервер Vite на 5174, proxy /api → единый сервис (localhost:4080).
export default defineConfig({
  base: '/viewer3d/',
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/api': 'http://localhost:4080',
    },
  },
});
