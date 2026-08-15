import jwt from 'jsonwebtoken';

import { VisitorSession } from '../models/index.js';
import { ApiError } from '../utils/api-error.js';

import { hashSessionId, mintVisitorCookie, verifyVisitorCookie } from './visitor-cookie.js';

import type { Env } from '../config/env.js';

interface VisitorSessionDeps {
  env: Pick<Env, 'COOKIE_SECRET'>;
}

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
     * Create a tracked visitor-session row for a subject that has cleared the
     * consent gate (presence granted, or an actively-started chat). Captures
     * the behavioral/PII fields the console shows.
     * @param params - Tenant, subject key, and captured fields.
     * @returns The created session.
     */
    async createTracked(params: CreateTrackedParams): Promise<VisitorSession> {
      const now = new Date();
      return VisitorSession.create({
        tenantId: params.tenantId,
        sessionCookieHash: params.subjectKey,
        identityTokenSub: params.identityTokenSub ?? null,
        userAgent: params.userAgent ?? null,
        ipAddress: params.ipAddress ?? null,
        country: params.country ?? null,
        city: params.city ?? null,
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
      return VisitorSession.findOne({ where: { sessionCookieHash: subjectKey } });
    },

    /**
     * Look up a VisitorSession by its signed cookie value.
     * @param cookieValue - Raw cookie value from the widget.
     * @returns The matching session.
     * @throws 401 if the cookie is missing/invalid or the session has been removed.
     */
    async findByCookie(cookieValue: string): Promise<VisitorSession> {
      const subjectKey = this.subjectKeyFromCookie(cookieValue);
      const session = await this.findBySubjectKey(subjectKey);
      if (session === null) throw ApiError.unauthorized('Visitor session not found');
      return session;
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
