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
 */
export const initVisitorSessionInputSchema = z.object({
  tenantKey: z.string().min(1).max(255),
  identityToken: z.string().optional(),
  currentUrl: z.string().max(2048).optional(),
  referrer: z.string().max(2048).optional(),
  language: z.string().max(16).optional(),
});
/**
 * Input for initializing a visitor session from the widget.
 */
export type InitVisitorSessionInput = z.infer<typeof initVisitorSessionInputSchema>;

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
