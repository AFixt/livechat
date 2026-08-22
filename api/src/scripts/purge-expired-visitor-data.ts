import { loadEnv } from '../config/env.js';
import { createLogger } from '../config/logger.js';
import { createSequelize } from '../config/mysql.js';
import { initModels } from '../models/index.js';
import { createDataRetentionService } from '../services/data-retention-service.js';

/**
 * Data-retention job: purge visitor sessions (and, under the `delete`
 * strategy, their cascade-linked chats/messages) that have gone untouched
 * longer than `VISITOR_DATA_RETENTION_DAYS`.
 *
 * Idempotent and safe to run repeatedly — intended to be invoked on a
 * schedule by real infrastructure (a platform cron / scheduled job), not by a
 * GitHub Actions cron (see CLAUDE.md "no scheduled GitHub Actions").
 *
 * Configured entirely from env:
 *   VISITOR_DATA_RETENTION_DAYS      retention window (default 90)
 *   VISITOR_DATA_RETENTION_STRATEGY  `anonymize` (default) | `delete`
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env);
  const sequelize = createSequelize(env, logger);
  initModels(sequelize);

  const retention = createDataRetentionService({ logger });

  try {
    await sequelize.authenticate();
    const result = await retention.purgeExpiredVisitorData({
      retentionDays: env.VISITOR_DATA_RETENTION_DAYS,
      strategy: env.VISITOR_DATA_RETENTION_STRATEGY,
    });
    logger.info({ result }, 'visitor data retention job complete');
  } catch (err) {
    logger.fatal({ err }, 'visitor data retention job failed');
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
}

void main();
