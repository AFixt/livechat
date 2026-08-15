import jwt from 'jsonwebtoken';

import { Tenant, VisitorSession } from '../models/index.js';
import { ApiError } from '../utils/api-error.js';

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
      const session = await VisitorSession.create({
        tenantId: tenant.id,
        sessionCookieHash: hash,
        identityTokenSub,
        userAgent: params.userAgent ?? null,
        ipAddress: params.ipAddress ?? null,
        country: null,
        city: null,
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
     * Revoke a visitor session — the "forget me" path (#79). Hard-deletes the
     * row so the visitor's PII and chat linkage are gone, which also serves the
     * geo-privacy deletion requirement, and any replay of the cookie 401s.
     * @param session - The session to forget (from {@link findByCookie}).
     */
    async forget(session: VisitorSession): Promise<void> {
      await session.destroy({ force: true });
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
