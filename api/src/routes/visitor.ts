import {
  initVisitorSessionInputSchema,
  visitorHeartbeatInputSchema,
  visitorInitiateChatInputSchema,
  type InitVisitorSessionInput,
  type InitVisitorSessionResult,
  type VisitorHeartbeatInput,
  type VisitorInitiateChatInput,
} from '@livechat/shared';
import { Router, type Request, type Response } from 'express';

import { parsedBody, validate } from '../middlewares/validate.js';
import { Tenant, type VisitorSession } from '../models/index.js';
import { verifyIdentityToken } from '../services/visitor-session-service.js';
import { ApiError } from '../utils/api-error.js';
import { asyncHandler } from '../utils/async-handler.js';

import { detectGpc, resolveSubject } from './consent-request.js';
import { VISITOR_COOKIE_NAME } from './visitor-cookie-options.js';

import type { Env } from '../config/env.js';
import type {
  ChatService,
  ConsentService,
  PresenceService,
  VisitorSessionService,
} from '../services/index.js';

interface VisitorRouterDeps {
  env: Env;
  visitorSession: VisitorSessionService;
  consent: ConsentService;
  chat: ChatService;
  presence: PresenceService;
}

/**
 * Read the signed visitor cookie off a request, or throw 401.
 * @param req - The Express request.
 * @returns The raw cookie value.
 * @throws 401 when absent.
 */
function requireVisitorCookie(req: Request): string {
  const raw: unknown = req.cookies[VISITOR_COOKIE_NAME];
  if (typeof raw !== 'string' || raw.length === 0) {
    throw ApiError.unauthorized('Visitor session required');
  }
  return raw;
}

/**
 * Ensure a tracked session exists for a `POST /session` call, honoring the
 * consent gate: an existing row is refreshed; a new row is created only when
 * presence tracking is permitted. Returns null when tracking is suppressed.
 * @param deps - Router deps.
 * @param tenant - The resolved tenant (carries the embed secret).
 * @param ctx - Subject key, presence decision, request body, and request.
 * @returns The tracked session, or null when suppressed.
 */
async function ensureSessionForInit(
  deps: VisitorRouterDeps,
  tenantId: string,
  ctx: {
    subjectKey: string;
    presenceGranted: boolean;
    identityTokenSub: string | null;
    body: InitVisitorSessionInput;
    req: Request;
  },
): Promise<VisitorSession | null> {
  const existing = await deps.visitorSession.findBySubjectKey(ctx.subjectKey);
  if (existing !== null) {
    await deps.visitorSession.heartbeat(existing, ctx.body.currentUrl);
    return existing;
  }
  if (!ctx.presenceGranted) return null;
  return deps.visitorSession.createTracked({
    tenantId,
    subjectKey: ctx.subjectKey,
    identityTokenSub: ctx.identityTokenSub,
    userAgent: ctx.req.header('user-agent') ?? null,
    ipAddress: ctx.req.ip ?? null,
    language: ctx.body.language ?? null,
    currentUrl: ctx.body.currentUrl ?? null,
    referrer: ctx.body.referrer ?? null,
    country: ctx.body.country ?? null,
  });
}

/**
 * Resolve (or lazily create) the visitor session backing a chat start. Opening
 * a chat is a first-party, strictly-necessary interaction, so a session is
 * created here even for a visitor the consent gate kept untracked on page load.
 * @param deps - Router deps.
 * @param cookie - The signed visitor cookie.
 * @param req - The request (for UA/IP).
 * @returns The visitor session.
 * @throws 401 when no prior decision exists for the subject.
 */
async function getOrCreateVisitorForChat(
  deps: VisitorRouterDeps,
  cookie: string,
  req: Request,
): Promise<VisitorSession> {
  const subjectKey = deps.visitorSession.subjectKeyFromCookie(cookie);
  const existing = await deps.visitorSession.findBySubjectKey(subjectKey);
  if (existing !== null) return existing;
  const latest = await deps.consent.latestFor(subjectKey);
  if (latest === null) throw ApiError.unauthorized('Visitor session required');
  return deps.visitorSession.createTracked({
    tenantId: latest.tenantId,
    subjectKey,
    userAgent: req.header('user-agent') ?? null,
    ipAddress: req.ip ?? null,
  });
}

/**
 * Run the consent gate for a `POST /session` call and build the response body:
 * resolve the tenant, validate any identity token, decide tracking, create the
 * session only when permitted, and record + audit the decision.
 * @param deps - Router deps.
 * @param req - The request.
 * @param res - The response (for setting the visitor cookie).
 * @returns The `data` payload for the response envelope.
 */
async function runSessionInit(
  deps: VisitorRouterDeps,
  req: Request,
  res: Response,
): Promise<InitVisitorSessionResult> {
  const body = parsedBody(req, initVisitorSessionInputSchema) satisfies InitVisitorSessionInput;
  const tenant = await Tenant.findOne({ where: { slug: body.tenantKey, status: 'active' } });
  if (tenant === null) throw ApiError.badRequest('Unknown tenant');

  // Validate any identity token unconditionally — a bad token is rejected even
  // when the consent gate suppresses tracking (input validation, not a
  // tracking decision).
  const identityTokenSub = verifyIdentityToken(body.identityToken, tenant.embedSecret);
  const gpc = detectGpc(req, body.gpc);
  const country = body.country ?? null;
  const region = body.region ?? null;
  const ip = req.ip ?? null;
  const userAgent = req.header('user-agent') ?? null;
  const subjectKey = resolveSubject(deps, req, res);

  const decision = await deps.consent.resolveState({ subjectKey, country, region, gpc });
  const session = await ensureSessionForInit(deps, tenant.id, {
    subjectKey,
    presenceGranted: decision.purposes.presence === 'granted',
    identityTokenSub,
    body,
    req,
  });
  const sessionId = session === null ? null : session.id;

  const { state } = await deps.consent.decideAndRecord({
    tenantId: tenant.id,
    subjectKey,
    visitorSessionId: sessionId,
    country,
    region,
    gpc,
    source: 'default',
    ip,
    userAgent,
  });

  return {
    sessionId,
    tenantId: tenant.id,
    jurisdiction: state.jurisdiction,
    gpc: state.gpc,
    tracking: state.purposes,
  };
}

/**
 * Build the `/visitor` sub-router — customer-widget-facing endpoints.
 * Protected only by the signed visitor cookie; no JWT.
 * @param deps - Env + visitor/consent/chat/presence services.
 * @returns Express router.
 */
export function buildVisitorRouter(deps: VisitorRouterDeps): Router {
  const router = Router();

  router.post(
    '/session',
    validate({ body: initVisitorSessionInputSchema }),
    asyncHandler(async (req, res) => {
      const data = await runSessionInit(deps, req, res);
      res.status(201).json({ success: true, data });
    }),
  );

  router.post(
    '/heartbeat',
    validate({ body: visitorHeartbeatInputSchema }),
    asyncHandler(async (req, res) => {
      const body = parsedBody(req, visitorHeartbeatInputSchema) satisfies VisitorHeartbeatInput;
      const session = await deps.visitorSession.findByCookie(requireVisitorCookie(req));
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
      const visitor = await getOrCreateVisitorForChat(deps, requireVisitorCookie(req), req);

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
      const visitor = await deps.visitorSession.findByCookie(requireVisitorCookie(req));
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
