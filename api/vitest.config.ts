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
      exclude: ['src/**/*.d.ts', 'src/reset.d.ts', 'src/server.ts', 'src/config/index.ts'],
      thresholds: {
        lines: 80,
        statements: 80,
        branches: 75,
        functions: 80,
      },
    },
    testTimeout: 10_000,
    // Integration tests share a single MySQL + Redis, so test files must
    // run sequentially — otherwise `sequelize.sync({ force: true })` in
    // one file drops tables out from under another.
    fileParallelism: false,
  },
});
