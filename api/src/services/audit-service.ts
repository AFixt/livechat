import { AuditLog } from '../models/index.js';

import type { Logger } from 'pino';

interface AuditEntry {
  userId?: string | null;
  tenantId?: string | null;
  action: string;
  // Explicitly `| undefined` so callers can pass an absent field straight
  // through under `exactOptionalPropertyTypes` without conditional spreads.
  resourceType?: string | undefined;
  resourceId?: string | undefined;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | undefined;
}

/**
 * Build an audit service that writes rows into `audit_logs`.
 * @param logger - Pino logger for write failures.
 * @returns An audit service with a single `record` method.
 */
export function createAuditService(logger: Logger) {
  return {
    /**
     * Persist an audit entry. Never throws — a failed audit write must not
     * break the calling flow.
     * @param entry - The entry.
     */
    async record(entry: AuditEntry): Promise<void> {
      try {
        await AuditLog.create({
          userId: entry.userId ?? null,
          tenantId: entry.tenantId ?? null,
          action: entry.action,
          resourceType: entry.resourceType ?? null,
          resourceId: entry.resourceId ?? null,
          ipAddress: entry.ipAddress ?? null,
          userAgent: entry.userAgent ?? null,
          metadata: entry.metadata ?? null,
        });
      } catch (err) {
        logger.error({ err, action: entry.action }, 'audit write failed');
      }
    },
  };
}

/**
 * Shape of the audit service.
 */
export type AuditService = ReturnType<typeof createAuditService>;
