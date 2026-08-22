/**
 * Shared Playwright configuration for the *generated* usecase specs that the
 * `ui` and `widget` workspaces run.
 *
 * Those two configs were byte-identical apart from a port, a projects list and
 * one env key, which put ~53 duplicated lines through the `jscpd` gate (the
 * repo's threshold is 1%). They are kept separate from `./config.ts` because
 * they deliberately target a *different* stack: the generated specs hard-code
 * the dev ports in their `start_location`, whereas the cross-ends journeys in
 * `./config.ts` use an isolated high-port range so a journey run never collides
 * with a dev stack.
 */
import { defineConfig } from '@playwright/test';

import type { PlaywrightTestConfig } from '@playwright/test';

/** True when running under CI, which forbids `.only` and enables retries. */
export const isCI = Boolean(process.env.CI);

/**
 * Dev-stack ports the generated usecase specs hard-code in their
 * `start_location`. The api still gets a dedicated `livechat_e2e` database, so
 * a run never touches dev data.
 */
export const DEV_STACK_PORTS = { api: 23001, console: 5174, widget: 5175 } as const;

/**
 * Build the environment for the api child process the generated specs run
 * against. `NODE_ENV=test` makes `server.ts` skip the rate limiters, so
 * repeated logins across a run (and CI retries) never trip the auth limiter.
 * @param extra - Additional env entries for a specific suite.
 * @returns A process-env-shaped record for the api child process.
 */
export function buildApiEnv(extra: Record<string, string> = {}): Record<string, string> {
  return {
    NODE_ENV: 'test',
    PORT: String(DEV_STACK_PORTS.api),
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
    APP_URL: `http://localhost:${String(DEV_STACK_PORTS.console)}`,
    API_URL: `http://localhost:${String(DEV_STACK_PORTS.api)}`,
    WIDGET_URL: `http://localhost:${String(DEV_STACK_PORTS.widget)}`,
    SMTP_HOST: 'localhost',
    SMTP_PORT: '21026',
    S3_ENDPOINT: 'http://localhost:29000',
    S3_ACCESS_KEY: 'livechat_minio',
    S3_SECRET_KEY: 'livechat_minio_pass',
    S3_BUCKET: 'livechat-attachments',
    LOG_LEVEL: 'warn',
    ...extra,
  };
}

/** Options for {@link defineGeneratedSpecConfig}. */
export interface GeneratedSpecConfigOptions {
  /** Port the workspace's own vite dev server listens on (its `baseURL`). */
  port: number;
  /** The workspace's Playwright projects. */
  projects: NonNullable<PlaywrightTestConfig['projects']>;
  /** Extra api env entries beyond {@link buildApiEnv}'s defaults. */
  apiEnvExtra?: Record<string, string>;
}

/**
 * Build the Playwright config a workspace uses to run its generated usecase
 * specs: the shared run settings, the api web server (which brings up infra and
 * seeds the database before serving), and the workspace's own vite server.
 * @param options - Per-workspace settings (see {@link GeneratedSpecConfigOptions}).
 * @returns The Playwright config to default-export.
 */
export function defineGeneratedSpecConfig(
  options: GeneratedSpecConfigOptions,
): PlaywrightTestConfig {
  const baseUrl = `http://localhost:${String(options.port)}`;
  return defineConfig({
    testDir: './e2e',
    fullyParallel: false,
    workers: 1,
    forbidOnly: isCI,
    retries: isCI ? 2 : 0,
    reporter: isCI ? [['github'], ['list']] : [['list']],
    use: { baseURL: baseUrl, trace: 'on-first-retry' },

    projects: options.projects,

    webServer: [
      {
        command: 'bash e2e/setup-and-serve-api.sh',
        cwd: '..',
        env: buildApiEnv(options.apiEnvExtra),
        url: `http://localhost:${String(DEV_STACK_PORTS.api)}/api/v1/health`,
        timeout: 120_000,
        reuseExistingServer: !isCI,
        stdout: 'pipe',
        stderr: 'pipe',
      },
      {
        command: `../node_modules/.bin/vite --port ${String(options.port)} --strictPort`,
        url: baseUrl,
        timeout: 60_000,
        reuseExistingServer: !isCI,
      },
    ],
  });
}
