import { createHmac, randomUUID } from 'node:crypto';

import { Chat, ChatMessage, ConsentRecord, VisitorSession } from '../models/index.js';

import { RULE_VERSION, decide, resolveJurisdiction } from './consent-policy.js';
import { visitorPiiNulls } from './visitor-pii.js';

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
/**
 * Outcome of a data-subject request (#121). An access request carries the
 * exported payload; an erasure request reports what was removed.
 */
export type DataRequestResult =
  | {
      requestId: string;
      type: 'export';
      status: 'completed';
      data: {
        visitorSessions: unknown[];
        chats: unknown[];
        messages: unknown[];
        consentRecords: unknown[];
      };
    }
  | {
      requestId: string;
      type: 'delete';
      status: 'completed';
      erased: { strategy: string; sessions: number; consentRecords: number };
    };

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
   *
   * Reads the persisted raw `explicitPurposes` — the choices the visitor
   * actually made — never the effective `purposes`. The effective purposes fold
   * in jurisdiction defaults (e.g. presence granted-by-default under an opt-out
   * regime); reading those back would mis-record a default as an explicit grant
   * and leak it into a later opt-in re-evaluation. See ADR-0019.
   * @param subjectKey - The visitor subject key.
   * @returns Stored explicit choices (possibly empty).
   */
  async function loadExplicitConsent(subjectKey: string): Promise<ExplicitConsent> {
    const last = await ConsentRecord.findOne({
      where: { subjectKey, source: 'banner' },
      order: [['created_at', 'DESC']],
    });
    const stored = last?.explicitPurposes;
    if (stored === null || stored === undefined) return {};
    const explicit: ExplicitConsent = {};
    if (stored.presence !== undefined) explicit.presence = stored.presence;
    if (stored.analytics !== undefined) explicit.analytics = stored.analytics;
    return explicit;
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
      // Persist the raw explicit choices separately from the effective purposes
      // so they never get re-read as consent under a different jurisdiction.
      explicitPurposes: explicit,
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
     * Fulfil a data-subject request — access (export) or erasure (#121).
     *
     * Fulfilled synchronously. The subject is a single visitor: one session
     * row, its chats, their messages, and its consent history. That is small
     * and bounded, so a queue plus a status endpoint would add moving parts and
     * a window in which the request is accepted but not yet honoured, without
     * making the answer arrive sooner.
     *
     * The subject key doubles as the lookup: it is `hashSessionId(sessionId,
     * COOKIE_SECRET)`, the same value stored as
     * `visitor_sessions.session_cookie_hash`, so a subject resolves to their
     * session without any extra join table.
     *
     * Erasure follows the tenant's configured retention strategy so the two
     * paths dispose of data the same way (#57): `anonymize` clears every PII
     * column but keeps the row, so transcripts stay referentially intact;
     * `delete` hard-deletes the session and lets the cascade take its chats and
     * messages.
     * @param params - Tenant, subject, request type, and erasure strategy.
     * @returns The request id, what was done, and the export payload for an
     *   access request.
     */
    async fulfilDataRequest(params: {
      tenantId: string;
      subjectKey: string;
      type: 'export' | 'delete';
      strategy?: 'anonymize' | 'delete';
    }): Promise<DataRequestResult> {
      const requestId = randomUUID();
      const sessions = await VisitorSession.findAll({
        where: { tenantId: params.tenantId, sessionCookieHash: params.subjectKey },
      });
      const sessionIds = sessions.map((s) => s.id);
      const chats =
        sessionIds.length === 0
          ? []
          : await Chat.findAll({ where: { visitorSessionId: sessionIds } });
      const chatIds = chats.map((c) => c.id);
      const messages =
        chatIds.length === 0 ? [] : await ChatMessage.findAll({ where: { chatId: chatIds } });
      const consents = await ConsentRecord.findAll({
        where: { tenantId: params.tenantId, subjectKey: params.subjectKey },
      });

      const result: DataRequestResult =
        params.type === 'export'
          ? {
              requestId,
              type: 'export',
              status: 'completed',
              data: {
                visitorSessions: sessions.map((s) => s.toJSON()),
                chats: chats.map((c) => c.toJSON()),
                messages: messages.map((m) => m.toJSON()),
                consentRecords: consents.map((c) => c.toJSON()),
              },
            }
          : { requestId, type: 'delete', status: 'completed', erased: await erase() };

      await deps.audit.record({
        tenantId: params.tenantId,
        action: 'privacy.data_request',
        resourceType: 'consent_record',
        resourceId: requestId,
        metadata: {
          type: params.type,
          status: 'completed',
          subjectKeyPrefix: params.subjectKey.slice(0, 12),
          sessions: sessions.length,
          chats: chats.length,
          messages: messages.length,
          consentRecords: consents.length,
          ...(params.type === 'delete' && { strategy: params.strategy ?? 'anonymize' }),
        },
      });
      return result;

      /**
       * Apply the erasure, honouring the configured strategy.
       * @returns What was erased.
       */
      async function erase(): Promise<{
        strategy: string;
        sessions: number;
        consentRecords: number;
      }> {
        const strategy = params.strategy ?? 'anonymize';
        if (sessionIds.length > 0) {
          if (strategy === 'delete') {
            await VisitorSession.destroy({ where: { id: sessionIds }, force: true });
          } else {
            await VisitorSession.update(visitorPiiNulls(), { where: { id: sessionIds } });
          }
        }
        // Consent records are erased either way. They are the audit trail of a
        // decision, but they are keyed to this subject and hold a minimized IP,
        // so an erasure request covers them; the immutable audit_logs entry
        // above is what preserves the fact that the request happened.
        const consentRecords = await ConsentRecord.destroy({
          where: { tenantId: params.tenantId, subjectKey: params.subjectKey },
          force: true,
        });
        return { strategy, sessions: sessionIds.length, consentRecords };
      }
    },
  };
}

/**
 * Shape of the consent service.
 */
export type ConsentService = ReturnType<typeof createConsentService>;
