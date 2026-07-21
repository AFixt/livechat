import { defineConfig, devices } from '@playwright/test';

const isCI = Boolean(process.env['CI']);

/**
 * Env for the api the widget specs run against — the dev ports the usecase
 * `start_location`s hard-code (widget 5175, api 23001) but a dedicated
 * `livechat_e2e` database. The startup script seeds before serving.
 */
const apiEnv: Record<string, string> = {
  NODE_ENV: 'test',
  PORT: '23001',
  DB_HOST: 'localhost',
  DB_PORT: '23307',
  DB_NAME: 'livechat_e2e',
  DB_USER: 'livechat_user',
  DB_PASS: 'livechat_pass',
  REDIS_HOST: 'localhost',
  REDIS_PORT: '26380',
  JWT_ACCESS_SECRET: 'e2e-access-secret',
  JWT_REFRESH_SECRET: 'e2e-refresh-secret',
  COOKIE_SECRET: 'e2e-cookie-secret',
  APP_URL: 'http://localhost:5174',
  API_URL: 'http://localhost:23001',
  WIDGET_URL: 'http://localhost:5175',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '21026',
  S3_ENDPOINT: 'http://localhost:29000',
  S3_ACCESS_KEY: 'livechat_minio',
  S3_SECRET_KEY: 'livechat_minio_pass',
  S3_BUCKET: 'livechat-attachments',
  LOG_LEVEL: 'warn',
  // These standalone widget specs have no agent socket, so seed one available
  // staff placeholder — otherwise a visitor-initiated chat lands in no_support
  // and the customer-initiates happy path can't reach the active state.
  SEED_STAFF_AVAILABLE: '1',
};

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI ? [['github'], ['list']] : [['list']],
  use: { baseURL: 'http://localhost:5175', trace: 'on-first-retry' },

  projects: [
    {
      // Only the self-contained specs run standalone. `widget-close` and
      // `widget-actively-chatting` declare preconditions (an open panel, an
      // active chat) that a single generated spec cannot establish — those
      // transitions are exercised in the e2e journey suite instead.
      name: 'chromium',
      testMatch: /generated\/widget-(initial|customer-initiates)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: [
    {
      command: 'bash e2e/setup-and-serve-api.sh',
      cwd: '..',
      env: apiEnv,
      url: 'http://localhost:23001/api/v1/health',
      timeout: 120_000,
      reuseExistingServer: !isCI,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: '../node_modules/.bin/vite --port 5175 --strictPort',
      url: 'http://localhost:5175',
      timeout: 60_000,
      reuseExistingServer: !isCI,
    },
  ],
});
