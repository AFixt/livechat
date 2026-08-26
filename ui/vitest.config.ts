import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Node 22.4+ ships its own Web Storage globals, and `localStorage` among them
 * is inert unless the process is started with `--localstorage-file`. Because
 * vitest's jsdom environment leaves pre-existing globals alone, that inert
 * `localStorage` shadows jsdom's working one and `window.localStorage` comes
 * out `undefined` (issue #153). Turning Web Storage off in the test worker
 * hands the name back to jsdom, so the suites exercise real jsdom `Storage`
 * rather than a hand-rolled stub.
 *
 * Node 22 is still the supported runtime (`engines: >=22 <23`). This only stops
 * an out-of-range Node from silently blocking the pre-push gate; it is not an
 * endorsement of running the project on a newer one.
 *
 * Pass the flag only when this Node accepts it, and ask Node rather than
 * inferring it from the presence of the globals. `--no-experimental-webstorage`
 * is the legacy negation of what Node 26 now spells `--webstorage`, so both a
 * runtime that predates the option and a future one that drops the alias must
 * be left alone: an unrecognized option kills every worker with `Worker exited
 * unexpectedly`, naming neither the flag nor storage, and blocks the gate just
 * as thoroughly as #153 did. Falling back to no flag lets the suite run and
 * fail in `web-storage-environment.test.ts`, which says what actually broke.
 */
const WEB_STORAGE_OFF = '--no-experimental-webstorage';
const execArgv = process.allowedNodeEnvironmentFlags.has(WEB_STORAGE_OFF) ? [WEB_STORAGE_OFF] : [];

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
