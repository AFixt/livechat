import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const REQUIRED_ENV: Record<string, string> = {
  DB_HOST: 'localhost',
  DB_NAME: 'livechat',
  DB_USER: 'livechat_user',
  DB_PASS: 'livechat_pass',
  REDIS_HOST: 'localhost',
  JWT_ACCESS_SECRET: 'access-secret',
  JWT_REFRESH_SECRET: 'refresh-secret',
  COOKIE_SECRET: 'cookie-secret',
  APP_URL: 'http://localhost:3000',
  API_URL: 'http://localhost:3001',
  WIDGET_URL: 'http://localhost:3002',
  SMTP_HOST: 'localhost',
  S3_ACCESS_KEY: 'access-key',
  S3_SECRET_KEY: 'secret-key',
  S3_BUCKET: 'bucket',
};

const REQUIRED_KEYS = Object.keys(REQUIRED_ENV);

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const key of REQUIRED_KEYS) savedEnv[key] = process.env[key];
  savedEnv['NODE_ENV'] = process.env['NODE_ENV'];
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) Reflect.deleteProperty(process.env, key);
    else process.env[key] = value;
  }
  vi.restoreAllMocks();
});

describe('loadEnv', () => {
  it('accepts a fully-populated, valid environment', async () => {
    for (const [key, value] of Object.entries(REQUIRED_ENV)) process.env[key] = value;
    process.env['NODE_ENV'] = 'test';

    const { loadEnv } = await import('./env.js');
    const env = loadEnv();

    expect(env.DB_HOST).toBe('localhost');
    expect(env.NODE_ENV).toBe('test');
    // Defaulted values prove the schema actually ran rather than passing
    // through untouched input.
    expect(env.PORT).toBe(3000);
    expect(env.DB_SSL).toBe(false);
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('exits the process (via the envalid default reporter) when required vars are missing', async () => {
    for (const key of REQUIRED_KEYS) Reflect.deleteProperty(process.env, key);
    process.env['NODE_ENV'] = 'test';

    // envalid's default reporter binds `console.error` once, at module load
    // (`var defaultLogger = console.error.bind(console)`), before this test
    // gets a chance to spy on it — so only `process.exit` is observable here.
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    const { loadEnv } = await import('./env.js');
    loadEnv();

    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
