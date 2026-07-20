import { defineConfig, devices } from '@playwright/test';

const isCI = Boolean(process.env['CI']);

/**
 * Env for the api the generated specs run against — the dev ports the
 * usecase `start_location`s hard-code (console 5174, api 23001), but a
 * dedicated `livechat_e2e` database so it never touches dev data. NODE_ENV
 * `test` skips rate limiting; the startup script seeds before serving.
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
};

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI ? [['github'], ['list']] : [['list']],
  use: { baseURL: 'http://localhost:5174', trace: 'on-first-retry' },

  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      // Admin specs assume a super_admin is authenticated. `admin-invite-user`
      // is excluded: the DSL emits selectOption() for its role dropdown, which
      // only drives a native <select>; MUI renders a listbox combobox. Upstream
      // in @afixt/usecase-runner, tracked in #6.
      name: 'admin',
      testMatch: /generated\/admin-(create-tenant|view-tenants|view-users)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/admin.json' },
      dependencies: ['setup'],
    },
    {
      name: 'support-dashboard',
      testMatch: /generated\/support-view-dashboard\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/staff.json' },
      dependencies: ['setup'],
    },
    {
      // Its own session — logout blacklists the token, which would otherwise
      // break the dashboard spec that shares it.
      name: 'support-logout',
      testMatch: /generated\/support-logout\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/staff-logout.json' },
      dependencies: ['setup'],
    },
    {
      name: 'support-anon',
      testMatch: /generated\/support-login.*\.spec\.ts/,
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
      command: '../node_modules/.bin/vite --port 5174 --strictPort',
      url: 'http://localhost:5174',
      timeout: 60_000,
      reuseExistingServer: !isCI,
    },
  ],
});
