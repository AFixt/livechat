import jwt from 'jsonwebtoken';

import { VisitorSession } from '../models/index.js';
import { ApiError } from '../utils/api-error.js';
import { coarsenGeo, truncateIp } from '../utils/pii-minimize.js';

import { hashSessionId, mintVisitorCookie, verifyVisitorCookie } from './visitor-cookie.js';

import type { Env } from '../config/env.js';

interface VisitorSessionDeps {
  env: Pick<
    Env,
    'COOKIE_SECRET' | 'VISITOR_SESSION_ABSOLUTE_TTL_HOURS' | 'VISITOR_SESSION_IDLE_TTL_HOURS'
  >;
}

const MS_PER_HOUR = 60 * 60 * 1000;

interface IdentityTokenPayload {
  sub: string;
  email?: string;
  name?: string;
}

interface CreateTrackedParams {
  tenantId: string;
  /**
   * The durable subject key — HMAC of the visitor cookie's session id. Stored
   * as `session_cookie_hash` so the socket handshake and consent records line
   * up with this row. Obtain via {@link VisitorSessionService.mintHandle} or
   * {@link VisitorSessionService.subjectKeyFromCookie}.
   */
  subjectKey: string;
  /** Verified `sub` claim from the client identity token, if any. */
  identityTokenSub?: string | null;
  userAgent?: string | null;
  ipAddress?: string | null;
  language?: string | null;
  currentUrl?: string | null;
  referrer?: string | null;
  country?: string | null;
  city?: string | null;
}

/**
 * Verify the optional identity-token JWT against a tenant's embed secret.
 * @param token - Raw JWT (or undefined, in which case returns null).
 * @param secret - Tenant `embed_secret` (HS256).
 * @returns The `sub` claim, or null when no token was provided.
 * @throws 400 ApiError on any verification failure.
 */
export function verifyIdentityToken(token: string | undefined, secret: string): string | null {
  if (token === undefined) return null;
  try {
    const decoded = jwt.verify(token, secret, {
      algorithms: ['HS256'],
    }) as IdentityTokenPayload;
    if (typeof decoded.sub !== 'string' || decoded.sub.length === 0) {
      throw ApiError.badRequest('Identity token missing sub claim');
    }
    return decoded.sub;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw ApiError.badRequest('Invalid identity token');
  }
}

/**
 * Build the visitor-session service.
 * @param deps - Env (for cookie secret).
 * @returns Visitor session methods.
 */
export function createVisitorSessionService(deps: VisitorSessionDeps) {
  /**
   * Derive the durable subject key (hex HMAC of the cookie's session id) from a
   * signed visitor cookie. Single source of truth for the cookie -> subject-key
   * derivation used by every lookup below.
   * @param cookieValue - Raw cookie value from the widget.
   * @returns The subject key.
   * @throws 401 if the cookie signature is invalid.
   */
  function subjectKeyOf(cookieValue: string): string {
    const sessionId = verifyVisitorCookie(cookieValue, deps.env.COOKIE_SECRET);
    return hashSessionId(sessionId, deps.env.COOKIE_SECRET);
  }

  /**
   * Load the tracked row for a subject key, without any expiry gate.
   * @param subjectKey - The durable subject key.
   * @returns The row, or null when the subject has no tracked session.
   */
  async function findBySubject(subjectKey: string): Promise<VisitorSession | null> {
    return VisitorSession.findOne({ where: { sessionCookieHash: subjectKey } });
  }

  /**
   * Hard-delete a subject's tracked row, if present. Idempotent.
   * @param subjectKey - The durable subject key.
   */
  async function forgetSubject(subjectKey: string): Promise<void> {
    const session = await findBySubject(subjectKey);
    if (session !== null) await session.destroy({ force: true });
  }

  return {
    /**
     * Mint a signed visitor cookie **without** creating any `visitor_sessions`
     * row. Used for the consent gate: a visitor in an opt-in jurisdiction gets
     * a durable subject handle (so consent can be recorded and the widget can
     * function) while no PII/behavioral row exists until they consent or engage.
     * @returns The cookie value to set and the derived durable subject key.
     */
    mintHandle(): { cookieValue: string; subjectKey: string } {
      const { sessionId, cookieValue } = mintVisitorCookie(deps.env.COOKIE_SECRET);
      const subjectKey = hashSessionId(sessionId, deps.env.COOKIE_SECRET);
      return { cookieValue, subjectKey };
    },

    /**
     * Derive the durable subject key from a signed visitor cookie. Equals the
     * `session_cookie_hash` of any tracked session minted from the same cookie,
     * so consent records and session rows line up.
     * @param cookieValue - Raw cookie value from the widget.
     * @returns The subject key (hex HMAC of the session id).
     * @throws 401 if the cookie is missing/invalid.
     */
    subjectKeyFromCookie(cookieValue: string): string {
      return subjectKeyOf(cookieValue);
    },

    /**
     * Create a tracked visitor-session row for a subject that has cleared the
     * consent gate (presence granted, or an actively-started chat). Captures
     * the behavioral/PII fields the console shows.
     * @param params - Tenant, subject key, and captured fields.
     * @returns The created session.
     */
    async createTracked(params: CreateTrackedParams): Promise<VisitorSession> {
      const now = new Date();
      // Data minimization at the point of capture: the IP is truncated (last
      // IPv4 octet / last 80 IPv6 bits zeroed) and geolocation is coarsened to
      // country level before it is ever persisted. See pii-minimize.ts and
      // docs/adr/0020-geo-retention-minimization.md.
      const geo = coarsenGeo({ country: params.country ?? null, city: params.city ?? null });
      return VisitorSession.create({
        tenantId: params.tenantId,
        sessionCookieHash: params.subjectKey,
        identityTokenSub: params.identityTokenSub ?? null,
        userAgent: params.userAgent ?? null,
        ipAddress: truncateIp(params.ipAddress ?? undefined),
        country: geo.country,
        city: geo.city,
        language: params.language ?? null,
        currentUrl: params.currentUrl ?? null,
        referrer: params.referrer ?? null,
        status: 'active',
        firstSeenAt: now,
        lastSeenAt: now,
      });
    },

    /**
     * Look up a tracked session by its durable subject key.
     * @param subjectKey - The subject key (from cookie or handle).
     * @returns The session, or null if none has been created (gated visitor).
     */
    async findBySubjectKey(subjectKey: string): Promise<VisitorSession | null> {
      return findBySubject(subjectKey);
    },

    /**
     * Look up a VisitorSession by its signed cookie value, enforcing absolute
     * and idle expiry server-side (#79). The cookie `maxAge` is only a
     * client-side hint and is trivially replayable, so the real bound lives
     * here — and, because the socket handshake also calls this, it covers the
     * `/visitor` namespace too.
     * @param cookieValue - Raw cookie value from the widget.
     * @returns The matching, non-expired session.
     * @throws 401 if the cookie is invalid, the session is gone, or it has
     *   passed its absolute or idle lifetime.
     */
    async findByCookie(cookieValue: string): Promise<VisitorSession> {
      const session = await findBySubject(subjectKeyOf(cookieValue));
      // A revoked ("forget me") session is hard-deleted, so a missing row is
      // also the revoked case.
      if (session === null) throw ApiError.unauthorized('Visitor session not found');

      const now = Date.now();
      const absoluteMs = deps.env.VISITOR_SESSION_ABSOLUTE_TTL_HOURS * MS_PER_HOUR;
      const idleMs = deps.env.VISITOR_SESSION_IDLE_TTL_HOURS * MS_PER_HOUR;
      if (now - new Date(session.firstSeenAt).getTime() > absoluteMs) {
        throw ApiError.unauthorized('Visitor session expired');
      }
      if (now - new Date(session.lastSeenAt).getTime() > idleMs) {
        throw ApiError.unauthorized('Visitor session expired');
      }
      return session;
    },

    /**
     * Revoke a visitor session by its cookie — the "forget me" path (#79).
     * Resolves the row from the signed cookie **without** applying the expiry
     * gate in {@link findByCookie}, then hard-deletes it, so the visitor's PII
     * and chat linkage are gone even when the session has already gone
     * absolutely/idle-expired. This is what serves the geo-privacy deletion
     * requirement; any replay of the cookie afterwards 401s. Idempotent: an
     * unknown or already-forgotten cookie is a no-op.
     * @param cookieValue - Raw cookie value from the widget.
     * @throws 401 if the cookie signature is invalid (nothing to forget).
     */
    async forgetByCookie(cookieValue: string): Promise<void> {
      await forgetSubject(subjectKeyOf(cookieValue));
    },

    /**
     * Hard-delete the tracked row for a subject key, if any. Used both by the
     * "forget me" path and by the consent gate when presence tracking stops
     * being permitted (withdrawal / GPC), so a revoked visitor's behavioral row
     * does not linger. Idempotent.
     * @param subjectKey - The durable subject key.
     */
    async forgetBySubjectKey(subjectKey: string): Promise<void> {
      await forgetSubject(subjectKey);
    },

    /**
     * Revoke a visitor session by id — the staff-initiated counterpart to the
     * visitor's own "forget me" (#123, following #79).
     *
     * Hard-deletes for the same reason `forgetByCookie` does: a soft-deleted
     * row would still be found by {@link findByCookie}, and the whole point is
     * that the cookie stops working. Because both the HTTP `/visitor/*` routes
     * and the `/visitor` socket handshake resolve through `findByCookie`, a
     * missing row is already rejected there — so revocation needs no new
     * rejection path, it reuses the one #94 built.
     *
     * Deliberately does not apply the expiry gate: an already-expired session
     * must still be revocable, since the row (and its PII) outlives the window
     * in which the cookie works.
     * @param sessionId - The `visitor_sessions.id` to revoke.
     * @param callerTenantId - The caller's tenant, or null for untenanted AFixt
     *   staff who span every tenant (#19).
     * @returns The revoked session's tenant and id, for presence cleanup.
     * @throws 404 if no such session; 403 if it belongs to another tenant.
     */
    async revokeById(
      sessionId: string,
      callerTenantId: string | null,
    ): Promise<{ tenantId: string; id: string }> {
      const session = await VisitorSession.findByPk(sessionId);
      if (session === null) throw ApiError.notFound('Visitor session not found');
      if (callerTenantId !== null && session.tenantId !== callerTenantId) {
        throw ApiError.forbidden('Visitor belongs to a different tenant');
      }
      const revoked = { tenantId: session.tenantId, id: session.id };
      await session.destroy({ force: true });
      return revoked;
    },

    /**
     * Bump `last_seen_at` and optionally update `current_url`.
     * @param session - The session (already loaded from {@link findByCookie}).
     * @param currentUrl - Optional new URL.
     */
    async heartbeat(session: VisitorSession, currentUrl?: string): Promise<void> {
      session.lastSeenAt = new Date();
      session.status = 'active';
      if (currentUrl !== undefined) session.currentUrl = currentUrl;
      await session.save();
    },
  };
}

/**
 * Shape of the visitor-session service.
 */
export type VisitorSessionService = ReturnType<typeof createVisitorSessionService>;
