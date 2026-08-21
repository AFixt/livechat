import {
  dataSubjectRequestInputSchema,
  readConsentQuerySchema,
  recordConsentInputSchema,
  withdrawConsentInputSchema,
  type EffectiveConsentState,
  type LegalBasis,
  type PurposeDecision,
} from '@livechat/shared';
import { Router, type Request, type Response } from 'express';

import { parsedBody, validate } from '../middlewares/validate.js';
import { Tenant } from '../models/index.js';
import { ApiError } from '../utils/api-error.js';
import { asyncHandler } from '../utils/async-handler.js';
import { resolveRequestGeo } from '../utils/geo-headers.js';

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
 * Resolve the jurisdiction inputs for a request, preferring the edge-supplied
 * location over the widget's own hint (#120).
 *
 * Order matters and is not arbitrary. The client hint is a convenience for
 * deployments with no geo header configured; where the edge does supply one it
 * must win, because a visitor who can choose their own country can choose the
 * laxest regime — sending `US` from the EU turns opt-in into opt-out. Trusting
 * the client only where nothing better exists keeps that from being a downgrade
 * path wherever geo is actually wired.
 * @param deps - Router deps (for the configured header names).
 * @param req - The incoming request.
 * @param hint - Client-supplied country/region, if any.
 * @returns The country and region to hand the policy engine.
 */
function resolveJurisdictionInputs(
  deps: PrivacyRouterDeps,
  req: Request,
  hint: { country?: string | undefined; region?: string | undefined },
): { country: string | null; region: string | null } {
  const edge = resolveRequestGeo(req, {
    countryHeader: deps.env.GEO_COUNTRY_HEADER,
    regionHeader: deps.env.GEO_REGION_HEADER,
  });
  if (edge.country !== null) return edge;
  return { country: hint.country ?? null, region: hint.region ?? null };
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

/** Explicit per-purpose choices a banner action expresses. */
type ExplicitConsent = Partial<Record<'presence' | 'analytics', PurposeDecision>>;

/** The common validated fields carried by every banner request. */
interface BannerBody {
  tenantKey: string;
  country?: string | undefined;
  region?: string | undefined;
  gpc?: boolean | undefined;
}

/** Arguments for {@link recordBannerDecision}. */
interface BannerDecisionArgs {
  deps: PrivacyRouterDeps;
  req: Request;
  res: Response;
  body: BannerBody;
  explicitConsent: ExplicitConsent;
  /** Forces the recorded legal basis (e.g. `withdrawn`). */
  legalBasisOverride?: LegalBasis;
}

/**
 * Resolve tenant + subject and record a banner consent decision. Shared by the
 * grant and withdraw handlers, which differ only in the explicit choices and
 * legal basis they impose. A fresh subject cookie is minted on `res` when the
 * request carries none.
 * @param args - Router deps, request/response, validated body, and choices.
 * @returns The effective consent state.
 */
async function recordBannerDecision(args: BannerDecisionArgs): Promise<EffectiveConsentState> {
  const { deps, req, res, body, explicitConsent, legalBasisOverride } = args;
  const tenantId = await resolveTenantId(body.tenantKey);
  const subjectKey = resolveSubject(deps, req, res);
  const geo = resolveJurisdictionInputs(deps, req, body);
  const { state } = await deps.consent.decideAndRecord({
    tenantId,
    subjectKey,
    country: geo.country,
    region: geo.region,
    gpc: detectGpc(req, body.gpc),
    source: 'banner',
    ip: req.ip ?? null,
    userAgent: req.header('user-agent') ?? null,
    explicitConsent,
    ...(legalBasisOverride === undefined ? {} : { legalBasisOverride }),
  });
  return state;
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
      // Audit-side-effect-free: this GET writes no audit row and persists no
      // consent record. It may still set a fresh subject cookie when the request
      // carries none — session establishment, not tracking. See ADR-0019.
      const subjectKey = resolveSubject(deps, req, res);
      const geo = resolveJurisdictionInputs(deps, req, q);
      const state = await deps.consent.resolveState({
        subjectKey,
        country: geo.country,
        region: geo.region,
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
      const explicitConsent: ExplicitConsent = {};
      if (body.purposes.presence !== undefined) explicitConsent.presence = body.purposes.presence;
      if (body.purposes.analytics !== undefined)
        explicitConsent.analytics = body.purposes.analytics;
      const state = await recordBannerDecision({ deps, req, res, body, explicitConsent });
      res.status(201).json({ success: true, data: state });
    }),
  );

  router.post(
    '/consent/withdraw',
    validate({ body: withdrawConsentInputSchema }),
    asyncHandler(async (req, res) => {
      const body = parsedBody(req, withdrawConsentInputSchema);
      const state = await recordBannerDecision({
        deps,
        req,
        res,
        body,
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
