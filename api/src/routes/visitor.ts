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
import { z } from 'zod';

import { computeCsrfToken, csrfProtection } from '../middlewares/csrf.js';
import { parsedBody, validate } from '../middlewares/validate.js';
import {
  VISITOR_COOKIE_NAME,
  readVisitorSessionValue,
  visitorCookieOptions,
} from '../middlewares/visitor-request.js';
import { Tenant, type VisitorSession } from '../models/index.js';
import { parseSupportHours } from '../services/support-hours.js';
import { verifyIdentityToken } from '../services/visitor-session-service.js';
import { ApiError } from '../utils/api-error.js';
import { asyncHandler } from '../utils/async-handler.js';

import { detectGpc, resolveSubject } from './consent-request.js';
import { resolveGeo } from './geo-resolve.js';

import type { Env } from '../config/env.js';
import type {
  ChatService,
  ConsentService,
  EmailService,
  PresenceService,
  VisitorSessionService,
} from '../services/index.js';

// Side-effect import: registers this router's OpenAPI paths (#119).
import './openapi/visitor.js';

/** Body schema for the email-transcript endpoint (#80). */
const emailTranscriptSchema = z.object({ email: z.email() });

interface VisitorRouterDeps {
  env: Env;
  visitorSession: VisitorSessionService;
  email: EmailService;
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
  // Header first, then cookie (#75): browsers that block the third-party cookie
  // send the signed session in `X-Visitor-Session` instead, which is the only
  // way the widget works cross-site on Safari and Firefox.
  const value = readVisitorSessionValue(req);
  if (value === undefined) throw ApiError.unauthorized('Visitor session required');
  return value;
}

/**
 * Ensure a tracked session for a `POST /session` call, honoring the consent
 * gate. The presence decision is applied **first**: when tracking is suppressed
 * (opt-in pre-consent, an opt-out, or a GPC signal) this returns null and does
 * not create, refresh, or return any row — so a universal opt-out stops ambient
 * tracking for a returning visitor too, not just a first-time one. When tracking
 * is permitted, an existing row is refreshed and a missing one is created.
 * @param deps - Router deps.
 * @param tenantId - The resolved tenant id.
 * @param ctx - Subject key, presence decision, identity sub, body, and request.
 * @returns The tracked session, or null when suppressed.
 */
async function ensureSessionForInit(
  deps: VisitorRouterDeps,
  tenantId: string,
  ctx: {
    subjectKey: string;
    presenceGranted: boolean;
    identityTokenSub: string | null;
    /** Trusted-source country for the stored row (see `geo-resolve.ts`). */
    country: string | null;
    body: InitVisitorSessionInput;
    req: Request;
  },
): Promise<VisitorSession | null> {
  if (!ctx.presenceGranted) return null;
  const existing = await deps.visitorSession.findBySubjectKey(ctx.subjectKey);
  if (existing !== null) {
    await deps.visitorSession.heartbeat(existing, ctx.body.currentUrl);
    return existing;
  }
  return deps.visitorSession.createTracked({
    tenantId,
    subjectKey: ctx.subjectKey,
    identityTokenSub: ctx.identityTokenSub,
    userAgent: ctx.req.header('user-agent') ?? null,
    ipAddress: ctx.req.ip ?? null,
    language: ctx.body.language ?? null,
    currentUrl: ctx.body.currentUrl ?? null,
    referrer: ctx.body.referrer ?? null,
    country: ctx.country,
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
  // Trusted edge header only — never the body. See `geo-resolve.ts`.
  const { country, region } = resolveGeo(deps.env, req);
  const ip = req.ip ?? null;
  const userAgent = req.header('user-agent') ?? null;
  const { subjectKey, cookieValue } = resolveSubject(deps, req, res);

  const decision = await deps.consent.resolveState({ subjectKey, country, region, gpc });
  const session = await ensureSessionForInit(deps, tenant.id, {
    subjectKey,
    presenceGranted: decision.purposes.presence === 'granted',
    identityTokenSub,
    country,
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
    // A detected universal opt-out is recorded as a GPC-sourced decision so the
    // audit trail shows the signal, not just a default page-load decision.
    source: gpc ? 'gpc' : 'default',
    ip,
    userAgent,
    // Automatic page-load decision: only persist when something actually
    // changed, so a returning visitor does not append a consent record and a
    // batch of audit rows on every page view.
    skipIfUnchanged: true,
  });

  return {
    sessionId,
    tenantId: tenant.id,
    // The widget stores this and echoes it as X-XSRF-TOKEN on write
    // requests (#77). Issued regardless of the tracking decision — a gated
    // visitor can still start a chat, which is a CSRF-protected write.
    csrfToken: computeCsrfToken(cookieValue, deps.env.COOKIE_SECRET),
    // Persisted by the widget and resent as X-Visitor-Session when the browser
    // blocks the third-party cookie (#75).
    sessionToken: cookieValue,
    jurisdiction: state.jurisdiction,
    gpc: state.gpc,
    tracking: state.purposes,
  };
}

/**
 * Compute whether support is currently available for a tenant — at least one
 * explicitly-available, reachable agent AND the tenant is within its
 * configured support hours.
 * @param presence - Presence service.
 * @param tenantId - Tenant UUID.
 * @returns Whether the widget should treat support as online.
 */
async function computeSupportAvailable(
  presence: PresenceService,
  tenantId: string,
): Promise<boolean> {
  const tenant = await Tenant.findByPk(tenantId, { attributes: ['settings'] });
  const supportHours = parseSupportHours(tenant?.settings?.supportHours);
  return presence.anyStaffAvailable(tenantId, { supportHours });
}

/**
 * Build the `/visitor` sub-router — customer-widget-facing endpoints.
 * Protected only by the signed visitor cookie; no JWT.
 * @param deps - Env + visitor/consent/chat/presence services.
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
      const data = await runSessionInit(deps, req, res);
      res.status(201).json({ success: true, data });
    }),
  );

  router.post(
    '/heartbeat',
    csrfProtection({ COOKIE_SECRET: deps.env.COOKIE_SECRET }),
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
    csrfProtection({ COOKIE_SECRET: deps.env.COOKIE_SECRET }),
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
      const supportAvailable = await computeSupportAvailable(deps.presence, visitor.tenantId);
      res.status(201).json({ success: true, data: { chat, message, supportAvailable } });
    }),
  );

  router.get(
    '/chats/current',
    asyncHandler(async (req, res) => {
      const cookie = requireVisitorCookie(req);
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

  // "Forget me" — the visitor revokes their own session (#79). Hard-deletes the
  // row (also serving geo-privacy deletion) and clears the cookie. Idempotent:
  // an already-forgotten/expired cookie simply reports success.
  router.post(
    '/session/forget',
    asyncHandler(async (req, res) => {
      // Header-first, like every other visitor route: a visitor whose browser
      // blocks the third-party cookie must still be able to forget their
      // session (#75, #79).
      const cookie = readVisitorSessionValue(req);
      if (cookie !== undefined) {
        try {
          // Deletes regardless of expiry, so a stale session's PII is still
          // purged (geo-privacy deletion), not just its cookie cleared.
          await deps.visitorSession.forgetByCookie(cookie);
        } catch {
          // Invalid/forged cookie — nothing to forget.
        }
      }
      // Clearing only works when the attributes match the ones the cookie was
      // set with — a `SameSite=None; Secure; Partitioned` cookie is not cleared
      // by a bare `path` (#75).
      res.clearCookie(
        VISITOR_COOKIE_NAME,
        visitorCookieOptions(deps.env.NODE_ENV === 'production'),
      );
      res.json({ success: true });
    }),
  );

  router.post(
    '/chats/:id/transcript',
    // Cookie-authenticated and state-changing (it sends mail), so it carries the
    // same CSRF guard as the other visitor writes (#77). Without it a
    // cross-site page could make a visitor mail their own transcript elsewhere.
    csrfProtection({ COOKIE_SECRET: deps.env.COOKIE_SECRET }),
    validate({ body: emailTranscriptSchema }),
    asyncHandler(async (req, res) => {
      const id = req.params.id;
      if (typeof id !== 'string') return;
      const visitor = await deps.visitorSession.findByCookie(requireVisitorCookie(req));
      const { email } = parsedBody(req, emailTranscriptSchema);
      // Scoped lookup (#72): the service refuses a chat belonging to another
      // visitor, so one visitor cannot email another's transcript.
      const chat = await deps.chat.getById(id, {
        kind: 'visitor',
        visitorSessionId: visitor.id,
      });
      const messages = await deps.chat.listMessages(chat.id);
      await deps.email.sendTranscriptEmail(
        email,
        messages.map((m) => ({
          senderKind: m.senderKind,
          body: m.body,
          deliveredAt: m.deliveredAt,
        })),
      );
      res.json({ success: true });
    }),
  );

  return router;
}
