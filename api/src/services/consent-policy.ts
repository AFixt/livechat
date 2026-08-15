import {
  CONSENT_PURPOSES,
  type ConsentPurpose,
  type EffectiveConsentState,
  type Jurisdiction,
  type LegalBasis,
  type PurposeDecision,
  type PurposeState,
} from '@livechat/shared';

/**
 * The version stamp of the jurisdiction ruleset below. Bump whenever {@link RULES}
 * changes so audit rows and consent records pin the ruleset that governed them.
 * See ADR-0011 for why the ruleset is versioned in code rather than a DB table.
 */
export const RULE_VERSION = '2026-08-15.1';

/**
 * How a purpose is treated in a jurisdiction:
 * - `always` — strictly necessary; always granted, never gated.
 * - `opt_in` — suppressed until the visitor explicitly grants it (GDPR/EU style).
 * - `opt_out` — permitted by default until the visitor (or GPC) opts out (US style).
 */
export type PurposeMode = 'always' | 'opt_in' | 'opt_out';

/**
 * The jurisdiction rules table — the single, data-driven source of policy.
 *
 * | Jurisdiction | functional | presence | analytics |
 * | ------------ | ---------- | -------- | --------- |
 * | EU / EEA     | always     | opt_in   | opt_in    |
 * | UK           | always     | opt_in   | opt_in    |
 * | US-CA        | always     | opt_out  | opt_out   |
 * | US (other)   | always     | opt_out  | opt_out   |
 * | UNKNOWN      | always     | opt_in   | opt_in    |  (strictest — fail safe)
 *
 * GPC is honored as a universal opt-out in every jurisdiction (see {@link decide}).
 */
export const RULES: Record<Jurisdiction, Record<ConsentPurpose, PurposeMode>> = {
  EU: { functional: 'always', presence: 'opt_in', analytics: 'opt_in' },
  UK: { functional: 'always', presence: 'opt_in', analytics: 'opt_in' },
  US_CA: { functional: 'always', presence: 'opt_out', analytics: 'opt_out' },
  US: { functional: 'always', presence: 'opt_out', analytics: 'opt_out' },
  UNKNOWN: { functional: 'always', presence: 'opt_in', analytics: 'opt_in' },
};

/** ISO 3166-1 alpha-2 codes of EU/EEA member states (opt-in regime). */
const EU_EEA = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU',
  'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES',
  'SE', 'IS', 'LI', 'NO',
]);

/**
 * Resolve a coarse jurisdiction bucket from optional geo hints.
 *
 * When no country is known the result is `UNKNOWN`, which maps to the strictest
 * (opt-in) policy — an unknown visitor is never treated as US-max. See ADR-0011.
 * @param country - ISO 3166-1 alpha-2 country code, if known.
 * @param region - Subdivision code (e.g. `CA` for California), if known.
 * @returns The resolved jurisdiction bucket.
 */
export function resolveJurisdiction(
  country: string | null | undefined,
  region?: string | null,
): Jurisdiction {
  if (country === null || country === undefined || country === '') return 'UNKNOWN';
  const cc = country.toUpperCase();
  if (cc === 'GB' || cc === 'UK') return 'UK';
  if (EU_EEA.has(cc)) return 'EU';
  if (cc === 'US') {
    return (region ?? '').toUpperCase() === 'CA' ? 'US_CA' : 'US';
  }
  // Any other country: no specific regime encoded — treat as UNKNOWN (strict).
  return 'UNKNOWN';
}

interface DecideInput {
  jurisdiction: Jurisdiction;
  /** Whether a universal opt-out (GPC) signal is present. */
  gpc: boolean;
  /** The visitor's most recent explicit choices, if any. */
  consent?: Partial<Record<ConsentPurpose, PurposeDecision>> | null;
}

/**
 * Decide the effective grant/deny of a single purpose.
 * @param mode - The jurisdiction's mode for this purpose.
 * @param gpc - Whether GPC is present.
 * @param explicit - The visitor's explicit choice for this purpose, if any.
 * @returns The effective decision.
 */
function decidePurpose(
  mode: PurposeMode,
  gpc: boolean,
  explicit: PurposeDecision | undefined,
): PurposeDecision {
  if (mode === 'always') return 'granted';
  // GPC is a universal opt-out: it suppresses every non-essential purpose,
  // regardless of jurisdiction, unless the visitor later explicitly re-grants.
  if (gpc && explicit !== 'granted') return 'denied';
  if (mode === 'opt_in') return explicit === 'granted' ? 'granted' : 'denied';
  // opt_out: on by default unless explicitly denied.
  return explicit === 'denied' ? 'denied' : 'granted';
}

/**
 * Pick the representative legal basis for an overall decision.
 * @param jurisdiction - The resolved jurisdiction.
 * @param gpc - Whether GPC is present.
 * @param effective - The computed effective state.
 * @returns The legal basis to record.
 */
function pickLegalBasis(
  jurisdiction: Jurisdiction,
  gpc: boolean,
  effective: PurposeState,
): LegalBasis {
  if (gpc) return 'opt_out';
  const nonEssentialGranted =
    effective.presence === 'granted' || effective.analytics === 'granted';
  const isOptIn = RULES[jurisdiction].presence === 'opt_in';
  if (!nonEssentialGranted) return isOptIn ? 'none' : 'opt_out';
  return isOptIn ? 'consent' : 'legitimate_interest';
}

/**
 * Apply the jurisdiction ruleset + stored consent + GPC to produce the
 * effective tracking state. Pure — no I/O — so it is exhaustively unit-tested.
 * @param input - Jurisdiction, GPC flag, and any stored consent.
 * @returns The effective consent state the widget gates on.
 */
export function decide(input: DecideInput): EffectiveConsentState {
  const modes = RULES[input.jurisdiction];
  const consent = input.consent ?? {};
  const purposes = {} as PurposeState;
  const requiresOptIn: ConsentPurpose[] = [];
  for (const purpose of CONSENT_PURPOSES) {
    const mode = modes[purpose];
    const decision = decidePurpose(mode, input.gpc, consent[purpose]);
    purposes[purpose] = decision;
    if (mode === 'opt_in' && decision !== 'granted') requiresOptIn.push(purpose);
  }
  return {
    jurisdiction: input.jurisdiction,
    gpc: input.gpc,
    ruleVersion: RULE_VERSION,
    legalBasis: pickLegalBasis(input.jurisdiction, input.gpc, purposes),
    purposes,
    requiresOptIn,
  };
}
