import jwt from 'jsonwebtoken';

import { Tenant, VisitorSession } from '../models/index.js';
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

interface InitParams {
  tenantSlug: string;
  userAgent?: string;
  ipAddress?: string;
  language?: string;
  currentUrl?: string;
  referrer?: string;
  /**
   * Coarse ISO 3166-1 alpha-2 country from the edge, when the deployment has a
   * trusted geo header configured (#120). Already country-level, so it passes
   * through `coarsenGeo` unchanged; the minimization rules in #57 are what stop
   * anything finer ever being persisted.
   */
  country?: string | null;
  /**
   * Raw HS256 JWT minted by the client's backend with the tenant's
   * `embed_secret`. When present and valid, the decoded `sub` claim is
   * stored on the visitor session so staff can correlate the chat with
   * the client's own user record.
   */
  identityToken?: string;
}

interface IdentityTokenPayload {
  sub: string;
  email?: string;
  name?: string;
}

interface InitResult {
  session: VisitorSession;
  cookieValue: string;
}

/**
 * Verify the optional identity-token JWT against a tenant's embed secret.
 * Extracted so the reducer in `init()` stays under the complexity cap.
 * @param token - Raw JWT (or undefined, in which case returns null).
 * @param secret - Tenant `embed_secret` (HS256).
 * @returns The `sub` claim, or null when no token was provided.
 * @throws 400 ApiError on any verification failure.
 */
function verifyIdentityToken(token: string | undefined, secret: string): string | null {
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
      const sessionId = verifyVisitorCookie(cookieValue, deps.env.COOKIE_SECRET);
      return hashSessionId(sessionId, deps.env.COOKIE_SECRET);
    },

    /**
     * Create a brand-new visitor session and return the signed cookie.
     * @param params - Init params from the widget.
     * @returns The new session + its signed cookie value.
     */
    async init(params: InitParams): Promise<InitResult> {
      const tenant = await Tenant.findOne({
        where: { slug: params.tenantSlug, status: 'active' },
      });
      if (tenant === null) throw ApiError.badRequest('Unknown tenant');

      const identityTokenSub = verifyIdentityToken(params.identityToken, tenant.embedSecret);

      const { sessionId, cookieValue } = mintVisitorCookie(deps.env.COOKIE_SECRET);
      const hash = hashSessionId(sessionId, deps.env.COOKIE_SECRET);
      const now = new Date();
      // Data minimization at the point of capture: the IP is truncated (last
      // IPv4 octet / last 80 IPv6 bits zeroed) and geolocation is coarsened to
      // country level before it is ever persisted. See pii-minimize.ts and
      // docs/adr/0020-geo-retention-minimization.md.
      const geo = coarsenGeo({ country: params.country ?? null, city: null });
      const session = await VisitorSession.create({
        tenantId: tenant.id,
        sessionCookieHash: hash,
        identityTokenSub,
        userAgent: params.userAgent ?? null,
        ipAddress: truncateIp(params.ipAddress),
        country: geo.country,
        city: geo.city,
        language: params.language ?? null,
        currentUrl: params.currentUrl ?? null,
        referrer: params.referrer ?? null,
        status: 'active',
        firstSeenAt: now,
        lastSeenAt: now,
      });
      return { session, cookieValue };
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
      const sessionId = verifyVisitorCookie(cookieValue, deps.env.COOKIE_SECRET);
      const hash = hashSessionId(sessionId, deps.env.COOKIE_SECRET);
      const session = await VisitorSession.findOne({
        where: { sessionCookieHash: hash },
      });
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
      const sessionId = verifyVisitorCookie(cookieValue, deps.env.COOKIE_SECRET);
      const hash = hashSessionId(sessionId, deps.env.COOKIE_SECRET);
      const session = await VisitorSession.findOne({
        where: { sessionCookieHash: hash },
      });
      if (session !== null) await session.destroy({ force: true });
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
