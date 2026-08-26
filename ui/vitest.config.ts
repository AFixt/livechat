import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Node 22.4+ ships its own Web Storage globals, and `localStorage` among them
 * is inert unless the process is started with `--localstorage-file`. Because
 * vitest's jsdom environment leaves pre-existing globals alone, that inert
 * `localStorage` shadows jsdom's working one and `window.localStorage` comes
 * out `undefined` (issue #153). Turning Web Storage off in the test worker
 * hands the name back to jsdom. The flag is only passed when this Node
 * actually exposes those globals, so older runtimes that predate it are not
 * given an option they would reject.
 */
const execArgv = 'localStorage' in globalThis ? ['--no-experimental-webstorage'] : [];

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    execArgv,
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
