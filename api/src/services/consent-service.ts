import { createHmac, randomUUID } from 'node:crypto';

import { ConsentRecord } from '../models/index.js';

import { RULE_VERSION, decide, resolveJurisdiction } from './consent-policy.js';

import type { AuditService } from './audit-service.js';
import type { Env } from '../config/env.js';
import type {
  ConsentPurpose,
  ConsentSource,
  EffectiveConsentState,
  LegalBasis,
  PurposeDecision,
} from '@livechat/shared';

interface ConsentServiceDeps {
  env: Pick<Env, 'COOKIE_SECRET'>;
  audit: AuditService;
}

/** Explicit per-purpose choices a visitor has expressed (presence/analytics). */
type ExplicitConsent = Partial<Record<ConsentPurpose, PurposeDecision>>;

interface DecideAndRecordParams {
  tenantId: string;
  subjectKey: string;
  visitorSessionId?: string | null;
  country?: string | null;
  region?: string | null;
  gpc: boolean;
  source: ConsentSource;
  ip?: string | null;
  userAgent?: string | null;
  /** New explicit choices from a banner action, merged over stored ones. */
  explicitConsent?: ExplicitConsent | null;
  /** Force the recorded legal basis (e.g. `withdrawn`). */
  legalBasisOverride?: LegalBasis;
}

interface ResolveParams {
  subjectKey: string;
  country?: string | null;
  region?: string | null;
  gpc: boolean;
}

/**
 * Build a consent service over `consent_records` + the audit trail.
 * @param deps - Env (cookie secret for IP minimization) + audit service.
 * @returns The consent service.
 */
export function createConsentService(deps: ConsentServiceDeps) {
  /**
   * Minimize an IP to an unlinkable HMAC. The raw address is never persisted.
   * @param ip - Raw IP, or null/undefined.
   * @returns Hex HMAC, or null.
   */
  function hashIp(ip: string | null | undefined): string | null {
    if (ip === null || ip === undefined || ip === '') return null;
    return createHmac('sha256', deps.env.COOKIE_SECRET).update(ip).digest('hex');
  }

  /**
   * Read the visitor's latest explicit (banner) choices for non-essential
   * purposes, used as the baseline for the next decision.
   * @param subjectKey - The visitor subject key.
   * @returns Stored explicit choices (possibly empty).
   */
  async function loadExplicitConsent(subjectKey: string): Promise<ExplicitConsent> {
    const last = await ConsentRecord.findOne({
      where: { subjectKey, source: 'banner' },
      order: [['created_at', 'DESC']],
    });
    if (last === null) return {};
    return { presence: last.purposes.presence, analytics: last.purposes.analytics };
  }

  /**
   * Compute the effective tracking state without persisting anything — used by
   * the read API so a poll never writes an audit row.
   * @param params - Subject key + detection signals.
   * @returns The effective consent state.
   */
  async function resolveState(params: ResolveParams): Promise<EffectiveConsentState> {
    const jurisdiction = resolveJurisdiction(params.country, params.region);
    const explicit = await loadExplicitConsent(params.subjectKey);
    return decide({ jurisdiction, gpc: params.gpc, consent: explicit });
  }

  /**
   * Decide the effective state, persist a consent record, and emit the §19
   * privacy decision events to the audit trail.
   * @param params - Full decision context.
   * @returns The persisted record and the effective state.
   */
  async function decideAndRecord(
    params: DecideAndRecordParams,
  ): Promise<{ record: ConsentRecord; state: EffectiveConsentState }> {
    const jurisdiction = resolveJurisdiction(params.country, params.region);
    const stored = await loadExplicitConsent(params.subjectKey);
    const explicit = { ...stored, ...(params.explicitConsent ?? {}) };
    const state = decide({ jurisdiction, gpc: params.gpc, consent: explicit });
    const legalBasis = params.legalBasisOverride ?? state.legalBasis;

    const record = await ConsentRecord.create({
      tenantId: params.tenantId,
      visitorSessionId: params.visitorSessionId ?? null,
      subjectKey: params.subjectKey,
      jurisdiction,
      legalBasis,
      source: params.source,
      gpc: params.gpc,
      ruleVersion: RULE_VERSION,
      purposes: state.purposes,
      ipHash: hashIp(params.ip),
      userAgent: params.userAgent ?? null,
    });

    await emitDecisionEvents({ params, record, jurisdiction });
    return { record, state: { ...state, legalBasis } };
  }

  /**
   * Emit the applicable §19 audit events for a decision.
   * @param ctx - The decision params, persisted record, and jurisdiction.
   */
  async function emitDecisionEvents(ctx: {
    params: DecideAndRecordParams;
    record: ConsentRecord;
    jurisdiction: string;
  }): Promise<void> {
    const { params, record, jurisdiction } = ctx;
    const base = {
      tenantId: params.tenantId,
      resourceType: 'consent_record',
      resourceId: record.id,
      userAgent: params.userAgent ?? null,
      metadata: {
        jurisdiction,
        source: params.source,
        gpc: params.gpc,
        ruleVersion: RULE_VERSION,
        purposes: record.purposes,
        subjectKeyPrefix: params.subjectKey.slice(0, 12),
      },
    };
    const locationKnown = (params.country ?? '') !== '';
    const actions: string[] = locationKnown
      ? ['privacy.location_resolved']
      : ['privacy.location_unknown', 'privacy.geolocation_default_applied'];
    actions.push('privacy.rule_applied');
    if (params.gpc) actions.push('privacy.gpc_detected', 'privacy.gpc_applied');
    if (params.source === 'banner') {
      actions.push(
        params.legalBasisOverride === 'withdrawn'
          ? 'privacy.consent_withdrawn'
          : 'privacy.consent_recorded',
      );
    }
    for (const action of actions) {
      await deps.audit.record({ ...base, action });
    }
  }

  return {
    resolveState,
    decideAndRecord,

    /**
     * The visitor's most recent consent record, or null.
     * @param subjectKey - The visitor subject key.
     * @returns The latest record or null.
     */
    async latestFor(subjectKey: string): Promise<ConsentRecord | null> {
      return ConsentRecord.findOne({
        where: { subjectKey },
        order: [['created_at', 'DESC']],
      });
    },

    /**
     * Record a data-subject request (export/delete) as an audited stub. The
     * request is queued for out-of-band handling — see ADR-0011.
     * @param params - Tenant, subject, and request type.
     * @returns A queued acknowledgement with a request id.
     */
    async queueDataRequest(params: {
      tenantId: string;
      subjectKey: string;
      type: 'export' | 'delete';
    }): Promise<{ requestId: string; status: 'queued' }> {
      const requestId = randomUUID();
      await deps.audit.record({
        tenantId: params.tenantId,
        action: 'privacy.data_request',
        resourceType: 'consent_record',
        resourceId: requestId,
        metadata: {
          type: params.type,
          subjectKeyPrefix: params.subjectKey.slice(0, 12),
        },
      });
      return { requestId, status: 'queued' };
    },
  };
}

/**
 * Shape of the consent service.
 */
export type ConsentService = ReturnType<typeof createConsentService>;
