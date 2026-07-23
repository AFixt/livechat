import type { AuditService } from '../services/audit-service.js';
import type { Request } from 'express';

/** The parts of an audit entry a call site has to supply itself. */
export interface AuditDetails {
  action: string;
  resourceType?: string;
  resourceId?: string;
  /** Overrides the actor's tenant — e.g. the tenant a request acted upon. */
  tenantId?: string | null;
  metadata?: Record<string, unknown>;
  /** Overrides the actor — for events where `req.user` is not yet set. */
  userId?: string | null;
}

/**
 * Record an audit entry, filling actor and request context from the request.
 *
 * `AuditService.record` never throws (a failed audit write logs and continues),
 * so awaiting this cannot break the calling flow. It is awaited rather than
 * fired-and-forgotten so the row is durable before the response goes out —
 * auth and admin actions are low-volume enough that the extra insert does not
 * matter, and an audit trail that races the response is not much of a trail.
 * @param audit - The audit service.
 * @param req - The request being audited.
 * @param details - Action-specific fields.
 */
export async function recordAudit(
  audit: AuditService,
  req: Request,
  details: AuditDetails,
): Promise<void> {
  await audit.record({
    userId: details.userId ?? req.user?.id ?? null,
    tenantId: details.tenantId ?? req.user?.tenantId ?? null,
    action: details.action,
    resourceType: details.resourceType,
    resourceId: details.resourceId,
    ipAddress: req.ip ?? null,
    userAgent: req.header('user-agent') ?? null,
    metadata: details.metadata,
  });
}
