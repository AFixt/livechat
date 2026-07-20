import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [preact()],
  server: {
    port: 5175,
    proxy: {
      '/api': {
        // Override the target so the e2e stack can point the widget at its
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
    lib: {
      entry: 'src/main.ts',
      name: 'AfixtLivechatWidget',
      formats: ['iife'],
      fileName: () => 'widget.js',
    },
    rollupOptions: {
      output: {
        extend: true,
      },
    },
    cssCodeSplit: false,
    emptyOutDir: true,
  },
});
