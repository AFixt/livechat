import {
  initVisitorSessionInputSchema,
  visitorHeartbeatInputSchema,
  visitorInitiateChatInputSchema,
  type InitVisitorSessionInput,
  type VisitorHeartbeatInput,
  type VisitorInitiateChatInput,
} from '@livechat/shared';
import { Router } from 'express';

import { computeCsrfToken, csrfProtection } from '../middlewares/csrf.js';
import { parsedBody, validate } from '../middlewares/validate.js';
import { ApiError } from '../utils/api-error.js';
import { asyncHandler } from '../utils/async-handler.js';

import { VISITOR_COOKIE_NAME, visitorCookieOptions } from './visitor-cookie-options.js';

import type { Env } from '../config/env.js';
import type { ChatService, PresenceService, VisitorSessionService } from '../services/index.js';

interface VisitorRouterDeps {
  env: Env;
  visitorSession: VisitorSessionService;
  chat: ChatService;
  presence: PresenceService;
}

/**
 * Build the `/visitor` sub-router — customer-widget-facing endpoints.
 * Protected only by the signed visitor cookie; no JWT.
 * @param deps - Env + visitor/chat services.
 * @returns Express router.
 */
export function buildVisitorRouter(deps: VisitorRouterDeps): Router {
  const router = Router();

  // Bootstrap endpoint: intentionally NOT CSRF-protected. A CSRF token is
  // derived from the visitor cookie, which does not exist yet on the first
  // call, so there is nothing to verify. It mints a fresh anonymous session and
  // exposes no cross-origin-readable data (restrictive CORS), so the only
  // cross-site effect is minting a throwaway session — no privileged action.
  router.post(
    '/session',
    validate({ body: initVisitorSessionInputSchema }),
    asyncHandler(async (req, res) => {
      const body = parsedBody(req, initVisitorSessionInputSchema) satisfies InitVisitorSessionInput;
      const ua = req.header('user-agent');
      const initArgs: Parameters<VisitorSessionService['init']>[0] = {
        tenantSlug: body.tenantKey,
      };
      if (ua !== undefined) initArgs.userAgent = ua;
      if (req.ip !== undefined) initArgs.ipAddress = req.ip;
      if (body.language !== undefined) initArgs.language = body.language;
      if (body.currentUrl !== undefined) initArgs.currentUrl = body.currentUrl;
      if (body.referrer !== undefined) initArgs.referrer = body.referrer;
      if (body.identityToken !== undefined) initArgs.identityToken = body.identityToken;

      const { session, cookieValue } = await deps.visitorSession.init(initArgs);
      res.cookie(VISITOR_COOKIE_NAME, cookieValue, visitorCookieOptions(deps.env));
      res.status(201).json({
        success: true,
        data: {
          sessionId: session.id,
          tenantId: session.tenantId,
          // The widget stores this and echoes it as X-XSRF-TOKEN on write
          // requests (#77).
          csrfToken: computeCsrfToken(cookieValue, deps.env.COOKIE_SECRET),
        },
      });
    }),
  );

  router.post(
    '/heartbeat',
    csrfProtection({ COOKIE_SECRET: deps.env.COOKIE_SECRET }),
    validate({ body: visitorHeartbeatInputSchema }),
    asyncHandler(async (req, res) => {
      const body = parsedBody(req, visitorHeartbeatInputSchema) satisfies VisitorHeartbeatInput;
      const rawCookie: unknown = req.cookies[VISITOR_COOKIE_NAME];
      const cookie = typeof rawCookie === 'string' ? rawCookie : undefined;
      if (cookie === undefined) throw ApiError.unauthorized('Visitor session required');
      const session = await deps.visitorSession.findByCookie(cookie);
      await deps.visitorSession.heartbeat(session, body.currentUrl);
      res.json({ success: true });
    }),
  );

  router.post(
    '/chats',
    csrfProtection({ COOKIE_SECRET: deps.env.COOKIE_SECRET }),
    validate({ body: visitorInitiateChatInputSchema }),
    asyncHandler(async (req, res) => {
      const body = parsedBody(
        req,
        visitorInitiateChatInputSchema,
      ) satisfies VisitorInitiateChatInput;
      const rawCookie: unknown = req.cookies[VISITOR_COOKIE_NAME];
      const cookie = typeof rawCookie === 'string' ? rawCookie : undefined;
      if (cookie === undefined) throw ApiError.unauthorized('Visitor session required');
      const visitor = await deps.visitorSession.findByCookie(cookie);

      const initArgs: Parameters<ChatService['initiateByVisitor']>[0] = {
        visitorSession: visitor,
        customerName: body.customerName,
        body: body.body,
      };
      if (body.customerEmail !== undefined) initArgs.customerEmail = body.customerEmail;
      const { chat, message } = await deps.chat.initiateByVisitor(initArgs);
      // The widget branches on availability: an active chat when support is
      // online, otherwise the offline (no_support) email-capture state.
      const supportAvailable = await deps.presence.anyStaffAvailable();
      res.status(201).json({ success: true, data: { chat, message, supportAvailable } });
    }),
  );

  router.get(
    '/chats/current',
    asyncHandler(async (req, res) => {
      const rawCookie: unknown = req.cookies[VISITOR_COOKIE_NAME];
      const cookie = typeof rawCookie === 'string' ? rawCookie : undefined;
      if (cookie === undefined) throw ApiError.unauthorized('Visitor session required');
      const visitor = await deps.visitorSession.findByCookie(cookie);
      const chat = await deps.chat.findResumableByVisitorSession(visitor.id);
      const csrfToken = computeCsrfToken(cookie, deps.env.COOKIE_SECRET);
      if (chat === null) {
        res.json({ success: true, data: { chat: null, messages: [], csrfToken } });
        return;
      }
      const messages = await deps.chat.listMessages(chat.id);
      res.json({
        success: true,
        // Returning visitors reuse an existing cookie and never call /session,
        // so hand them the CSRF token here too (#77).
        data: { chat, messages, csrfToken },
      });
    }),
  );

  // "Forget me" — the visitor revokes their own session (#79). Hard-deletes the
  // row (also serving geo-privacy deletion) and clears the cookie. Idempotent:
  // an already-forgotten/expired cookie simply reports success.
  router.post(
    '/session/forget',
    asyncHandler(async (req, res) => {
      const rawCookie: unknown = req.cookies[VISITOR_COOKIE_NAME];
      const cookie = typeof rawCookie === 'string' ? rawCookie : undefined;
      if (cookie !== undefined) {
        try {
          // Deletes regardless of expiry, so a stale session's PII is still
          // purged (geo-privacy deletion), not just its cookie cleared.
          await deps.visitorSession.forgetByCookie(cookie);
        } catch {
          // Invalid/forged cookie — nothing to forget.
        }
      }
      res.clearCookie(VISITOR_COOKIE_NAME, { path: '/' });
      res.json({ success: true });
    }),
  );

  return router;
}
