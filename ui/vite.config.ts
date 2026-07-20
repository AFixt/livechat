import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/api': {
        // Override the target so the e2e stack can point the console at its
        // dedicated api port; defaults to the dev api port.
        target: process.env['API_PROXY_TARGET'] ?? 'http://localhost:23001',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  resolve: {
    alias: {
      '@livechat/shared': new URL('../shared/src/index.ts', import.meta.url).pathname,
    },
  },
});
