import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Absolute paths: the app is always served from the origin root
  // (http://127.0.0.1:<port>/), and relative paths break at deep routes
  // like /admin/settings (assets resolve to /admin/assets/... and the SPA
  // fallback then serves index.html as the script -> white screen).
  base: '/',
  plugins: [react()],
  build: {
    outDir: '../../apps/hotshare-win/src/renderer/public',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
});
