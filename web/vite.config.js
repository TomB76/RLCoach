import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_PORT = process.env.PORT || 4317;

export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    port: 5317,
    strictPort: false,
    proxy: {
      '/api': `http://127.0.0.1:${API_PORT}`,
      '/live': {
        target: `ws://127.0.0.1:${API_PORT}`,
        ws: true,
      },
    },
  },
});
