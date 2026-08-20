import { z } from 'zod';

/**
 * Visitor session status — matches the `visitor_sessions.status` ENUM.
 */
export const visitorStatusSchema = z.enum(['active', 'idle', 'offline']);
/**
 * Visitor session status value.
 */
export type VisitorStatus = z.infer<typeof visitorStatusSchema>;

/**
 * Public shape of a visitor session — what the support console sees.
 * The raw session cookie is never included.
 */
export const visitorSessionSafeSchema = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  identityTokenSub: z.string().nullable(),
  userAgent: z.string().max(500).nullable(),
  ipAddress: z.string().max(64).nullable(),
  country: z.string().max(64).nullable(),
  city: z.string().max(128).nullable(),
  language: z.string().max(16).nullable(),
  currentUrl: z.string().max(2048).nullable(),
  referrer: z.string().max(2048).nullable(),
  status: visitorStatusSchema,
  firstSeenAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
});
/**
 * Safe visitor-session object.
 */
export type VisitorSessionSafe = z.infer<typeof visitorSessionSafeSchema>;

/**
 * Input schema for `POST /visitor/session` — widget init call.
 *
 * `gpc` is the widget's `navigator.globalPrivacyControl` reading, which feeds
 * the consent gate. There is deliberately no `country`/`region` here:
 * jurisdiction decides whether tracking is opt-in or opt-out, so it is resolved
 * server-side from a trusted edge header (`GEO_COUNTRY_HEADER`), never from a
 * body the embedding page controls. A client signal that can only *deny*
 * tracking (GPC) is safe to accept; one that could *grant* it is not.
 */
export const initVisitorSessionInputSchema = z.object({
  tenantKey: z.string().min(1).max(255),
  identityToken: z.string().optional(),
  currentUrl: z.string().max(2048).optional(),
  referrer: z.string().max(2048).optional(),
  language: z.string().max(16).optional(),
  gpc: z.boolean().optional(),
});
/**
 * Input for initializing a visitor session from the widget.
 */
export type InitVisitorSessionInput = z.infer<typeof initVisitorSessionInputSchema>;

/**
 * Response shape for `POST /visitor/session`. `sessionId` is `null` when the
 * consent gate suppressed tracking (no `visitor_sessions` row was created); the
 * widget uses `tracking.presence` to decide whether to open the presence socket.
 */
export const initVisitorSessionResultSchema = z.object({
  sessionId: z.uuid().nullable(),
  tenantId: z.uuid(),
  /**
   * Per-cookie CSRF token (#77). Issued regardless of the tracking decision —
   * a consent-gated visitor can still start a chat, which is a CSRF-protected
   * write, so the widget always needs this.
   */
  csrfToken: z.string(),
  jurisdiction: z.string(),
  gpc: z.boolean(),
  tracking: z.object({
    functional: z.enum(['granted', 'denied']),
    presence: z.enum(['granted', 'denied']),
    analytics: z.enum(['granted', 'denied']),
  }),
});
/**
 * Result of initializing a visitor session.
 */
export type InitVisitorSessionResult = z.infer<typeof initVisitorSessionResultSchema>;

/**
 * Input schema for `POST /visitor/heartbeat` — updates `current_url`, keeps
 * status `active`.
 */
export const visitorHeartbeatInputSchema = z.object({
  currentUrl: z.string().max(2048).optional(),
});
/**
 * Input for a visitor heartbeat.
 */
export type VisitorHeartbeatInput = z.infer<typeof visitorHeartbeatInputSchema>;
