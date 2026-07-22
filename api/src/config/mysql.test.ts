import { pino } from 'pino';
import { describe, expect, it } from 'vitest';

import { createSequelize } from './mysql.js';

import type { Env } from './env.js';
import type { Sequelize } from 'sequelize';

const logger = pino({ level: 'silent' });
const baseEnv: Pick<Env, 'DB_HOST' | 'DB_PORT' | 'DB_NAME' | 'DB_USER' | 'DB_PASS' | 'NODE_ENV'> = {
  DB_HOST: 'localhost',
  DB_PORT: 3306,
  DB_NAME: 'db',
  DB_USER: 'user',
  DB_PASS: 'pass',
  NODE_ENV: 'test',
};

interface Ssl {
  rejectUnauthorized?: boolean;
  ca?: string;
}

/**
 * Read the resolved `dialectOptions.ssl` off a built Sequelize instance.
 * `options` is runtime-only (not in Sequelize 6's public types), so reach it
 * through a narrow cast rather than `any`.
 * @param sequelize - The instance built by createSequelize.
 * @returns The ssl config, or undefined when TLS is off.
 */
function sslOf(sequelize: Sequelize): Ssl | undefined {
  const withOptions = sequelize as unknown as {
    options: { dialectOptions?: { ssl?: Ssl | undefined } };
  };
  return withOptions.options.dialectOptions?.ssl;
}

describe('createSequelize DB TLS', () => {
  it('omits ssl when DB_SSL is false (local docker-compose stays plaintext)', () => {
    const sequelize = createSequelize({ ...baseEnv, DB_SSL: false, DB_SSL_CA: '' }, logger);
    expect(sslOf(sequelize)).toBeUndefined();
  });

  it('enables verified ssl with the provider CA when DB_SSL is true', () => {
    const sequelize = createSequelize(
      { ...baseEnv, DB_SSL: true, DB_SSL_CA: '-----BEGIN CERTIFICATE-----' },
      logger,
    );
    expect(sslOf(sequelize)).toEqual({
      rejectUnauthorized: true,
      ca: '-----BEGIN CERTIFICATE-----',
    });
  });

  it('enables ssl without a ca when DB_SSL is true but no CA is supplied', () => {
    const sequelize = createSequelize({ ...baseEnv, DB_SSL: true, DB_SSL_CA: '' }, logger);
    expect(sslOf(sequelize)).toEqual({ rejectUnauthorized: true });
  });
});
