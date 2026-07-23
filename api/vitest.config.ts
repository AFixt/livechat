import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/reset.d.ts',
        // Process entrypoints: they wire the app together and run on boot, so
        // exercising them proves nothing the integration suite does not.
        'src/server.ts',
        'src/config/index.ts',
        // Operator CLI scripts, run by hand against a real database.
        'src/scripts/**',
      ],
      thresholds: {
        lines: 80,
        statements: 80,
        branches: 75,
        functions: 80,
      },
    },
    testTimeout: 10_000,
    // Integration tests share a single MySQL + Redis, so test files must
    // run sequentially — otherwise one file's schema rebuild
    // (`resetSchemaFromMigrations`) drops tables out from under another.
    fileParallelism: false,
  },
});
