import { Op } from 'sequelize';

import { VisitorSession } from '../models/index.js';

import { VISITOR_PII_COLUMNS, visitorPiiNulls } from './visitor-pii.js';

import type { Logger } from 'pino';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * How expired visitor data is disposed of:
 * - `anonymize` strips every PII column but keeps the row so chat transcripts
 *   remain referentially intact (the default).
 * - `delete` hard-deletes the visitor session; the `ON DELETE CASCADE` foreign
 *   keys remove its chats, messages and events too.
 */
export type RetentionStrategy = 'anonymize' | 'delete';

/**
 * Personal-data columns cleared by the `anonymize` strategy. Defined in
 * `visitor-pii.ts` and shared with on-demand erasure (#121), so a new PII
 * column cannot be handled by the sweep but missed by a data-subject request.
 */
const PII_COLUMNS = VISITOR_PII_COLUMNS;

interface PurgeParams {
  /** Retention window in days; sessions untouched for longer are purged. */
  retentionDays: number;
  /** Disposal strategy. Defaults to `anonymize`. */
  strategy?: RetentionStrategy;
  /** Injectable clock for deterministic tests. Defaults to `new Date()`. */
  now?: Date;
}

/**
 * Outcome of a purge run — logged and returned so the script/cron can report.
 */
export interface PurgeResult {
  /** The computed cutoff; sessions last seen before this are expired. */
  cutoff: Date;
  /** Strategy actually applied. */
  strategy: RetentionStrategy;
  /** Rows anonymized (0 when strategy is `delete`). */
  anonymized: number;
  /** Rows hard-deleted (0 when strategy is `anonymize`). */
  deleted: number;
}

interface DataRetentionDeps {
  logger: Logger;
}

/**
 * Build the data-retention service.
 * @param deps - Logger for structured run reporting.
 * @returns Retention operations.
 */
export function createDataRetentionService(deps: DataRetentionDeps) {
  /**
   * Purge visitor sessions (and, when deleting, their cascade-linked chat
   * data) whose `last_seen_at` predates the retention window. Idempotent: a
   * second run over the same window finds nothing left to anonymize.
   * @param params - Retention window, strategy and optional clock.
   * @returns Counts and the cutoff applied.
   */
  async function purgeExpiredVisitorData(params: PurgeParams): Promise<PurgeResult> {
    const strategy: RetentionStrategy = params.strategy ?? 'anonymize';
    const now = params.now ?? new Date();
    const cutoff = new Date(now.getTime() - params.retentionDays * MS_PER_DAY);

    if (strategy === 'delete') {
      const deleted = await VisitorSession.destroy({
        where: { lastSeenAt: { [Op.lt]: cutoff } },
        force: true,
      });
      deps.logger.info(
        { cutoff, strategy, deleted, retentionDays: params.retentionDays },
        'visitor data retention: hard-deleted expired sessions',
      );
      return { cutoff, strategy, anonymized: 0, deleted };
    }

    const [anonymized] = await VisitorSession.update(visitorPiiNulls(), {
      where: {
        lastSeenAt: { [Op.lt]: cutoff },
        [Op.or]: PII_COLUMNS.map((column) => ({ [column]: { [Op.ne]: null } })),
      },
    });
    deps.logger.info(
      { cutoff, strategy, anonymized, retentionDays: params.retentionDays },
      'visitor data retention: anonymized expired sessions',
    );
    return { cutoff, strategy, anonymized, deleted: 0 };
  }

  return { purgeExpiredVisitorData };
}

/**
 * Shape of the data-retention service.
 */
export type DataRetentionService = ReturnType<typeof createDataRetentionService>;
