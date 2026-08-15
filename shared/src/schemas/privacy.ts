import { z } from 'zod';

/**
 * Tracking purposes the consent framework governs.
 *
 * - `functional` — strictly necessary for the widget to work (session cookie
 *   at chat start, delivering messages). Never gated; always granted.
 * - `presence` — ambient visitor tracking (IP, current URL, referrer) shown in
 *   the support console before the visitor engages. Non-essential.
 * - `analytics` — reserved for any future aggregate measurement. Non-essential.
 */
export const consentPurposeSchema = z.enum(['functional', 'presence', 'analytics']);
/**
 * A single tracking purpose.
 */
export type ConsentPurpose = z.infer<typeof consentPurposeSchema>;

/**
 * The list of every purpose, in a stable order.
 */
export const CONSENT_PURPOSES = ['functional', 'presence', 'analytics'] as const;

/**
 * Whether a purpose is permitted (`granted`) or suppressed (`denied`).
 */
export const purposeDecisionSchema = z.enum(['granted', 'denied']);
/**
 * A per-purpose grant/deny value.
 */
export type PurposeDecision = z.infer<typeof purposeDecisionSchema>;

/**
 * The effective state of every purpose after applying jurisdiction rules,
 * stored consent, and universal opt-out signals.
 */
export const purposeStateSchema = z.object({
  functional: purposeDecisionSchema,
  presence: purposeDecisionSchema,
  analytics: purposeDecisionSchema,
});
/**
 * Effective per-purpose state.
 */
export type PurposeState = z.infer<typeof purposeStateSchema>;

/**
 * Jurisdiction buckets the policy engine understands. Coarser than legal
 * reality by design — see ADR-0011. `UNKNOWN` triggers the strictest policy.
 */
export const jurisdictionSchema = z.enum(['EU', 'UK', 'US_CA', 'US', 'UNKNOWN']);
/**
 * A resolved jurisdiction bucket.
 */
export type Jurisdiction = z.infer<typeof jurisdictionSchema>;

/**
 * The legal basis recorded for a tracking decision.
 */
export const legalBasisSchema = z.enum([
  'consent',
  'legitimate_interest',
  'opt_out',
  'withdrawn',
  'none',
]);
/**
 * A recorded legal basis.
 */
export type LegalBasis = z.infer<typeof legalBasisSchema>;

/**
 * How a consent record came to be.
 */
export const consentSourceSchema = z.enum(['gpc', 'banner', 'default']);
/**
 * Source of a consent record.
 */
export type ConsentSource = z.infer<typeof consentSourceSchema>;

/**
 * The effective tracking state the widget reads to gate itself.
 */
export const effectiveConsentStateSchema = z.object({
  jurisdiction: jurisdictionSchema,
  gpc: z.boolean(),
  ruleVersion: z.string(),
  legalBasis: legalBasisSchema,
  purposes: purposeStateSchema,
  requiresOptIn: z.array(consentPurposeSchema),
});
/**
 * Effective consent/tracking state for a visitor.
 */
export type EffectiveConsentState = z.infer<typeof effectiveConsentStateSchema>;

/**
 * Fields common to every privacy request: the tenant the visitor belongs to,
 * optional geo hints (ISO 3166-1 alpha-2 country + region), and an optional
 * client-detected GPC flag (`navigator.globalPrivacyControl`). GPC is also
 * detected server-side from the `Sec-GPC` header; either source counts.
 */
const privacyCommonShape = {
  tenantKey: z.string().min(1).max(255),
  country: z
    .string()
    .length(2)
    .regex(/^[A-Za-z]{2}$/)
    .optional(),
  region: z.string().max(8).optional(),
  gpc: z.boolean().optional(),
};

/**
 * Input for `POST /privacy/consent` — a visitor granting/denying non-essential
 * purposes via a banner. `functional` is never listed; it cannot be withdrawn.
 */
export const recordConsentInputSchema = z.object({
  purposes: z
    .object({
      presence: purposeDecisionSchema.optional(),
      analytics: purposeDecisionSchema.optional(),
    })
    .refine((p) => p.presence !== undefined || p.analytics !== undefined, {
      message: 'At least one purpose decision is required',
    }),
  ...privacyCommonShape,
});
/**
 * Input for recording banner consent.
 */
export type RecordConsentInput = z.infer<typeof recordConsentInputSchema>;

/**
 * Query schema for `GET /privacy/consent` — read effective state without
 * writing. `gpc` arrives as the string `"true"`/`"false"` on a query string.
 */
export const readConsentQuerySchema = z.object({
  ...privacyCommonShape,
  gpc: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
/**
 * Query for reading effective consent state.
 */
export type ReadConsentQuery = z.infer<typeof readConsentQuerySchema>;

/**
 * Input for `POST /privacy/consent/withdraw`.
 */
export const withdrawConsentInputSchema = z.object(privacyCommonShape);
/**
 * Input for withdrawing consent.
 */
export type WithdrawConsentInput = z.infer<typeof withdrawConsentInputSchema>;

/**
 * Input for `POST /privacy/data-request` — a data-subject access/erasure
 * request. Handled as an audited stub (see ADR-0011).
 */
export const dataSubjectRequestInputSchema = z.object({
  type: z.enum(['export', 'delete']),
  tenantKey: z.string().min(1).max(255),
});
/**
 * Input for a data-subject request.
 */
export type DataSubjectRequestInput = z.infer<typeof dataSubjectRequestInputSchema>;
