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
    // 30s (was 10s). Integration tests do multiple bcrypt hashes plus real
    // MySQL round-trips in a single test; at 10s the margin was thin enough
    // that unrelated tests intermittently timed out under load, and adding any
    // new integration test destabilised existing ones (#71). Test-env bcrypt
    // cost is also lowered (see `bcryptCost()` in models/user.ts); this timeout
    // is the belt to that suspenders. Unit tests still finish in milliseconds —
    // this only raises the ceiling for a genuine hang.
    testTimeout: 30_000,
    // Integration tests share a single MySQL + Redis, so test files must
    // run sequentially — otherwise one file's schema rebuild
    // (`resetSchemaFromMigrations`) drops tables out from under another.
    fileParallelism: false,
  },
});
