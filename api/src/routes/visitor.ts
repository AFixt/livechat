import {
  initVisitorSessionInputSchema,
  visitorHeartbeatInputSchema,
  visitorInitiateChatInputSchema,
  type InitVisitorSessionInput,
  type VisitorHeartbeatInput,
  type VisitorInitiateChatInput,
} from '@livechat/shared';
import { Router } from 'express';

import { parsedBody, validate } from '../middlewares/validate.js';
import { ApiError } from '../utils/api-error.js';
import { asyncHandler } from '../utils/async-handler.js';

import type { Env } from '../config/env.js';
import type { ChatService, PresenceService, VisitorSessionService } from '../services/index.js';

const VISITOR_COOKIE_NAME = 'livechat_visitor';
const VISITOR_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

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
      res.cookie(VISITOR_COOKIE_NAME, cookieValue, {
        httpOnly: true,
        sameSite: 'lax',
        secure: deps.env.NODE_ENV === 'production',
        maxAge: VISITOR_COOKIE_MAX_AGE_MS,
        path: '/',
      });
      res.status(201).json({
        success: true,
        data: { sessionId: session.id, tenantId: session.tenantId },
      });
    }),
  );

  router.post(
    '/heartbeat',
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
      if (chat === null) {
        res.json({ success: true, data: { chat: null, messages: [] } });
        return;
      }
      const messages = await deps.chat.listMessages(chat.id);
      res.json({ success: true, data: { chat, messages } });
    }),
  );

  return router;
}
