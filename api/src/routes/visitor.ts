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
import {
  VISITOR_COOKIE_NAME,
  readVisitorSessionValue,
  visitorCookieOptions,
} from '../middlewares/visitor-request.js';
import { ApiError } from '../utils/api-error.js';
import { asyncHandler } from '../utils/async-handler.js';

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
      res.cookie(
        VISITOR_COOKIE_NAME,
        cookieValue,
        visitorCookieOptions(deps.env.NODE_ENV === 'production'),
      );
      res.status(201).json({
        success: true,
        data: {
          sessionId: session.id,
          tenantId: session.tenantId,
          // The widget stores this and echoes it as X-XSRF-TOKEN on write
          // requests (#77).
          csrfToken: computeCsrfToken(cookieValue, deps.env.COOKIE_SECRET),
          // The widget persists this and resends it as X-Visitor-Session when
          // the browser blocks the third-party cookie (#75, ADR-0012).
          sessionToken: cookieValue,
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
      const cookie = readVisitorSessionValue(req);
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
      const cookie = readVisitorSessionValue(req);
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
      const cookie = readVisitorSessionValue(req);
      if (cookie === undefined) throw ApiError.unauthorized('Visitor session required');
      const visitor = await deps.visitorSession.findByCookie(cookie);
      const chat = await deps.chat.findResumableByVisitorSession(visitor.id);
      const csrfToken = computeCsrfToken(cookie, deps.env.COOKIE_SECRET);
      // Also echo the session token so a cookie-authenticated returning visitor
      // can persist it for the header fallback on later loads (#75).
      if (chat === null) {
        res.json({
          success: true,
          data: { chat: null, messages: [], csrfToken, sessionToken: cookie },
        });
        return;
      }
      const messages = await deps.chat.listMessages(chat.id);
      res.json({
        success: true,
        // Returning visitors reuse an existing cookie and never call /session,
        // so hand them the CSRF token here too (#77).
        data: { chat, messages, csrfToken, sessionToken: cookie },
      });
    }),
  );

  return router;
}
