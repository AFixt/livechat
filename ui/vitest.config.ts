import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.d.ts', 'src/reset.d.ts', 'src/main.tsx', 'src/test-setup.ts'],
    },
  },
  resolve: {
    alias: {
      '@livechat/shared': new URL('../shared/src/index.ts', import.meta.url).pathname,
    },
  },
});
