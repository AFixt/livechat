import { Sequelize, type Options } from 'sequelize';

import type { Env } from './env.js';
import type { Logger } from 'pino';

/**
 * Build the Sequelize instance for the livechat MySQL database.
 * @param env - Validated env containing MySQL connection vars.
 * @param logger - Pino logger; Sequelize SQL queries log at `debug`.
 * @returns A configured (but not yet connected) Sequelize instance.
 */
export function createSequelize(
  env: Pick<Env, 'DB_HOST' | 'DB_PORT' | 'DB_NAME' | 'DB_USER' | 'DB_PASS' | 'NODE_ENV'>,
  logger: Logger,
): Sequelize {
  const options: Options = {
    dialect: 'mysql',
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    username: env.DB_USER,
    password: env.DB_PASS,
    logging:
      env.NODE_ENV === 'development'
        ? (sql: string) => {
            logger.debug({ sql }, 'sql');
          }
        : false,
    define: {
      timestamps: true,
      paranoid: true,
      underscored: true,
    },
    pool: {
      max: 10,
      min: 0,
      acquire: 30_000,
      idle: 10_000,
    },
  };

  return new Sequelize(options);
}
