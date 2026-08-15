import {
  dataSubjectRequestInputSchema,
  readConsentQuerySchema,
  recordConsentInputSchema,
  withdrawConsentInputSchema,
  type PurposeDecision,
} from '@livechat/shared';
import { Router } from 'express';

import { parsedBody, validate } from '../middlewares/validate.js';
import { asyncHandler } from '../utils/async-handler.js';

import { detectGpc, resolveSubject } from './consent-request.js';
import { resolveActiveTenantId } from './tenant-resolve.js';

import type { Env } from '../config/env.js';
import type { ConsentService, VisitorSessionService } from '../services/index.js';

interface PrivacyRouterDeps {
  env: Env;
  consent: ConsentService;
  visitorSession: VisitorSessionService;
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
      const tenantId = await resolveActiveTenantId(body.tenantKey);
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
      const tenantId = await resolveActiveTenantId(body.tenantKey);
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
      const tenantId = await resolveActiveTenantId(body.tenantKey);
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
