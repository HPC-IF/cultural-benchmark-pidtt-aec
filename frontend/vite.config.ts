import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/pidtt-aec/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api/conicet': {
        target: 'http://192.168.1.79:8900',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/conicet/, ''),
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
