import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, devices } from '@playwright/test';

import { API_URL, CONSOLE_URL, PORTS, WIDGET_URL, apiEnv } from './support/config.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const isCI = Boolean(process.env['CI']);

export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  timeout: 60_000,
  reporter: isCI ? [['github'], ['list']] : [['list']],

  use: {
    baseURL: CONSOLE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'journeys',
      testMatch: /journeys\/.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
  ],

  // Dedicated ports + a dedicated database, so a run is isolated from any
  // manually-running dev stack. reuseExistingServer locally for fast
  // iteration; always fresh in CI.
  webServer: [
    {
      // Brings up infra + creates + seeds the e2e DB, then execs the api —
      // so the schema and fixtures exist before anything hits it (Playwright
      // starts webServers before globalSetup, so this can't live there).
      command: 'bash e2e/setup-and-serve-api.sh',
      cwd: REPO_ROOT,
      env: apiEnv(),
      url: `${API_URL}/api/v1/health`,
      timeout: 120_000,
      reuseExistingServer: !isCI,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: `../node_modules/.bin/vite --port ${String(PORTS.console)} --strictPort`,
      cwd: resolve(REPO_ROOT, 'ui'),
      env: { API_PROXY_TARGET: API_URL },
      url: CONSOLE_URL,
      timeout: 60_000,
      reuseExistingServer: !isCI,
    },
    {
      command: `../node_modules/.bin/vite --port ${String(PORTS.widget)} --strictPort`,
      cwd: resolve(REPO_ROOT, 'widget'),
      env: { API_PROXY_TARGET: API_URL },
      url: WIDGET_URL,
      timeout: 60_000,
      reuseExistingServer: !isCI,
    },
  ],
});
