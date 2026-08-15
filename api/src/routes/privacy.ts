import {
  dataSubjectRequestInputSchema,
  readConsentQuerySchema,
  recordConsentInputSchema,
  withdrawConsentInputSchema,
  type PurposeDecision,
} from '@livechat/shared';
import { Router, type Request, type Response } from 'express';

import { parsedBody, validate } from '../middlewares/validate.js';
import { Tenant } from '../models/index.js';
import { ApiError } from '../utils/api-error.js';
import { asyncHandler } from '../utils/async-handler.js';

import { VISITOR_COOKIE_NAME, visitorCookieOptions } from './visitor-cookie-options.js';

import type { Env } from '../config/env.js';
import type { ConsentService, VisitorSessionService } from '../services/index.js';

interface PrivacyRouterDeps {
  env: Env;
  consent: ConsentService;
  visitorSession: VisitorSessionService;
}

/**
 * Resolve an active tenant's id from its slug (the widget `data-tenant-key`).
 * @param tenantKey - Tenant slug.
 * @returns The tenant id.
 * @throws 400 if unknown.
 */
async function resolveTenantId(tenantKey: string): Promise<string> {
  const tenant = await Tenant.findOne({
    where: { slug: tenantKey, status: 'active' },
    attributes: ['id'],
  });
  if (tenant === null) throw ApiError.badRequest('Unknown tenant');
  return tenant.id;
}

/**
 * Detect a universal opt-out (GPC) signal from the request. Honors both the
 * `Sec-GPC: 1` request header and an explicit client-detected flag.
 * @param req - The Express request.
 * @param clientFlag - `navigator.globalPrivacyControl` value sent by the widget.
 * @returns Whether GPC is present.
 */
function detectGpc(req: Request, clientFlag: boolean | undefined): boolean {
  return req.header('sec-gpc') === '1' || clientFlag === true;
}

/**
 * Resolve the visitor's durable subject key from the cookie, minting a fresh
 * cookie handle (and setting it on the response) when none is present.
 * @param deps - Router deps.
 * @param req - Request (for the incoming cookie).
 * @param res - Response (to set a new cookie when minted).
 * @returns The subject key.
 */
function resolveSubject(deps: PrivacyRouterDeps, req: Request, res: Response): string {
  const raw: unknown = req.cookies[VISITOR_COOKIE_NAME];
  if (typeof raw === 'string' && raw.length > 0) {
    return deps.visitorSession.subjectKeyFromCookie(raw);
  }
  const { cookieValue, subjectKey } = deps.visitorSession.mintHandle();
  res.cookie(VISITOR_COOKIE_NAME, cookieValue, visitorCookieOptions(deps.env));
  return subjectKey;
}

/**
 * Build the `/privacy` sub-router — visitor-facing consent + data-subject APIs.
 * Cookie-scoped (no JWT), like `/visitor`.
 * @param deps - Env + consent + visitor-session services.
 * @returns Express router.
 */
export function buildPrivacyRouter(deps: PrivacyRouterDeps): Router {
  const router = Router();

  router.get(
    '/consent',
    validate({ query: readConsentQuerySchema }),
    asyncHandler(async (req, res) => {
      const q = readConsentQuerySchema.parse(req.query);
      const subjectKey = resolveSubject(deps, req, res);
      const state = await deps.consent.resolveState({
        subjectKey,
        country: q.country ?? null,
        region: q.region ?? null,
        gpc: detectGpc(req, q.gpc),
      });
      res.json({ success: true, data: state });
    }),
  );

  router.post(
    '/consent',
    validate({ body: recordConsentInputSchema }),
    asyncHandler(async (req, res) => {
      const body = parsedBody(req, recordConsentInputSchema);
      const tenantId = await resolveTenantId(body.tenantKey);
      const subjectKey = resolveSubject(deps, req, res);
      const explicitConsent: Partial<Record<'presence' | 'analytics', PurposeDecision>> = {};
      if (body.purposes.presence !== undefined) explicitConsent.presence = body.purposes.presence;
      if (body.purposes.analytics !== undefined) explicitConsent.analytics = body.purposes.analytics;
      const { state } = await deps.consent.decideAndRecord({
        tenantId,
        subjectKey,
        country: body.country ?? null,
        region: body.region ?? null,
        gpc: detectGpc(req, body.gpc),
        source: 'banner',
        ip: req.ip ?? null,
        userAgent: req.header('user-agent') ?? null,
        explicitConsent,
      });
      res.status(201).json({ success: true, data: state });
    }),
  );

  router.post(
    '/consent/withdraw',
    validate({ body: withdrawConsentInputSchema }),
    asyncHandler(async (req, res) => {
      const body = parsedBody(req, withdrawConsentInputSchema);
      const tenantId = await resolveTenantId(body.tenantKey);
      const subjectKey = resolveSubject(deps, req, res);
      const { state } = await deps.consent.decideAndRecord({
        tenantId,
        subjectKey,
        country: body.country ?? null,
        region: body.region ?? null,
        gpc: detectGpc(req, body.gpc),
        source: 'banner',
        ip: req.ip ?? null,
        userAgent: req.header('user-agent') ?? null,
        explicitConsent: { presence: 'denied', analytics: 'denied' },
        legalBasisOverride: 'withdrawn',
      });
      res.json({ success: true, data: state });
    }),
  );

  router.post(
    '/data-request',
    validate({ body: dataSubjectRequestInputSchema }),
    asyncHandler(async (req, res) => {
      const body = parsedBody(req, dataSubjectRequestInputSchema);
      const tenantId = await resolveTenantId(body.tenantKey);
      const subjectKey = resolveSubject(deps, req, res);
      const result = await deps.consent.queueDataRequest({
        tenantId,
        subjectKey,
        type: body.type,
      });
      res.status(202).json({ success: true, data: result });
    }),
  );

  return router;
}
