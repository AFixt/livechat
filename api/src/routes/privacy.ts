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
import { asyncHandler } from '../utils/async-handler.js';

import { detectGpc, resolveSubject } from './consent-request.js';
import { resolveGeo } from './geo-resolve.js';
import { resolveActiveTenantId } from './tenant-resolve.js';

import type { Env } from '../config/env.js';
import type { ConsentService, VisitorSessionService } from '../services/index.js';

// Side-effect import: registers this router's OpenAPI paths (#119).
import './openapi/privacy.js';

interface PrivacyRouterDeps {
  env: Env;
  consent: ConsentService;
  visitorSession: VisitorSessionService;
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
  const tenantId = await resolveActiveTenantId(body.tenantKey);
  const { subjectKey } = resolveSubject(deps, req, res);
  const { state } = await deps.consent.decideAndRecord({
    tenantId,
    subjectKey,
    ...resolveGeo(deps.env, req),
    gpc: detectGpc(req, body.gpc),
    source: 'banner',
    ip: req.ip ?? null,
    userAgent: req.header('user-agent') ?? null,
    explicitConsent,
    ...(legalBasisOverride === undefined ? {} : { legalBasisOverride }),
  });
  // Enforcing the decision, not just recording it (#53): once presence is no
  // longer permitted — withdrawal, an explicit deny, or GPC — the tracked row
  // is hard-deleted. Otherwise the visitor's behavioral data (IP, UA, current
  // URL) would keep being retained and heartbeated after opting out, which is
  // the exact harm the gate exists to prevent. Idempotent when untracked.
  if (state.purposes.presence !== 'granted') {
    await deps.visitorSession.forgetBySubjectKey(subjectKey);
  }
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
      const { subjectKey } = resolveSubject(deps, req, res);
      const state = await deps.consent.resolveState({
        subjectKey,
        ...resolveGeo(deps.env, req),
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
      const tenantId = await resolveActiveTenantId(body.tenantKey);
      const { subjectKey } = resolveSubject(deps, req, res);
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
