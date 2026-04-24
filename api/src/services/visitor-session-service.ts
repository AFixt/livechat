import { Tenant, VisitorSession } from '../models/index.js';
import { ApiError } from '../utils/api-error.js';

import { hashSessionId, mintVisitorCookie, verifyVisitorCookie } from './visitor-cookie.js';

import type { Env } from '../config/env.js';

interface VisitorSessionDeps {
  env: Pick<Env, 'COOKIE_SECRET'>;
}

interface InitParams {
  tenantSlug: string;
  userAgent?: string;
  ipAddress?: string;
  language?: string;
  currentUrl?: string;
  referrer?: string;
  identityTokenSub?: string;
}

interface InitResult {
  session: VisitorSession;
  cookieValue: string;
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

      const { sessionId, cookieValue } = mintVisitorCookie(deps.env.COOKIE_SECRET);
      const hash = hashSessionId(sessionId, deps.env.COOKIE_SECRET);
      const now = new Date();
      const session = await VisitorSession.create({
        tenantId: tenant.id,
        sessionCookieHash: hash,
        identityTokenSub: params.identityTokenSub ?? null,
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
     * Look up a VisitorSession by its signed cookie value.
     * @param cookieValue - Raw cookie value from the widget.
     * @returns The matching session.
     * @throws 401 if the cookie is missing/invalid or the session has been removed.
     */
    async findByCookie(cookieValue: string): Promise<VisitorSession> {
      const sessionId = verifyVisitorCookie(cookieValue, deps.env.COOKIE_SECRET);
      const hash = hashSessionId(sessionId, deps.env.COOKIE_SECRET);
      const session = await VisitorSession.findOne({
        where: { sessionCookieHash: hash },
      });
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
