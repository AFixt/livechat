import { describe, expect, test } from 'vitest';

import { RULE_VERSION, decide, resolveJurisdiction } from './consent-policy.js';

describe('resolveJurisdiction', () => {
  test('unknown country falls back to the strict UNKNOWN bucket', () => {
    expect(resolveJurisdiction(null)).toBe('UNKNOWN');
    expect(resolveJurisdiction(undefined)).toBe('UNKNOWN');
    expect(resolveJurisdiction('')).toBe('UNKNOWN');
  });

  test('EU/EEA countries resolve to EU', () => {
    expect(resolveJurisdiction('DE')).toBe('EU');
    expect(resolveJurisdiction('fr')).toBe('EU');
    expect(resolveJurisdiction('NO')).toBe('EU'); // EEA
  });

  test('the UK resolves to UK regardless of the code used', () => {
    expect(resolveJurisdiction('GB')).toBe('UK');
    expect(resolveJurisdiction('uk')).toBe('UK');
  });

  test('US resolves to US, and California to US_CA', () => {
    expect(resolveJurisdiction('US')).toBe('US');
    expect(resolveJurisdiction('US', 'CA')).toBe('US_CA');
    expect(resolveJurisdiction('US', 'ny')).toBe('US');
  });

  test('an unmodeled country is treated as strict UNKNOWN, not opt-out', () => {
    expect(resolveJurisdiction('BR')).toBe('UNKNOWN');
  });
});

describe('decide — EU opt-in', () => {
  test('presence and analytics are denied pre-consent', () => {
    const state = decide({ jurisdiction: 'EU', gpc: false });
    expect(state.purposes.functional).toBe('granted');
    expect(state.purposes.presence).toBe('denied');
    expect(state.purposes.analytics).toBe('denied');
    expect(state.requiresOptIn).toEqual(['presence', 'analytics']);
    expect(state.legalBasis).toBe('none');
    expect(state.ruleVersion).toBe(RULE_VERSION);
  });

  test('explicit grant flips presence on with a consent basis', () => {
    const state = decide({ jurisdiction: 'EU', gpc: false, consent: { presence: 'granted' } });
    expect(state.purposes.presence).toBe('granted');
    expect(state.purposes.analytics).toBe('denied');
    expect(state.requiresOptIn).toEqual(['analytics']);
    expect(state.legalBasis).toBe('consent');
  });
});

describe('decide — US opt-out', () => {
  test('presence and analytics default on with a legitimate-interest basis', () => {
    const state = decide({ jurisdiction: 'US', gpc: false });
    expect(state.purposes.presence).toBe('granted');
    expect(state.purposes.analytics).toBe('granted');
    expect(state.requiresOptIn).toEqual([]);
    expect(state.legalBasis).toBe('legitimate_interest');
  });

  test('an explicit opt-out suppresses the purpose', () => {
    const state = decide({ jurisdiction: 'US_CA', gpc: false, consent: { presence: 'denied' } });
    expect(state.purposes.presence).toBe('denied');
    expect(state.purposes.analytics).toBe('granted');
    expect(state.legalBasis).toBe('legitimate_interest');
  });
});

describe('decide — GPC universal opt-out', () => {
  test('GPC suppresses non-essential tracking in an opt-out jurisdiction', () => {
    const state = decide({ jurisdiction: 'US', gpc: true });
    expect(state.purposes.functional).toBe('granted');
    expect(state.purposes.presence).toBe('denied');
    expect(state.purposes.analytics).toBe('denied');
    expect(state.gpc).toBe(true);
    expect(state.legalBasis).toBe('opt_out');
  });

  test('GPC keeps opt-in tracking off too', () => {
    const state = decide({ jurisdiction: 'EU', gpc: true });
    expect(state.purposes.presence).toBe('denied');
    expect(state.legalBasis).toBe('opt_out');
  });

  test('an explicit re-grant overrides GPC for that purpose', () => {
    const state = decide({ jurisdiction: 'US', gpc: true, consent: { presence: 'granted' } });
    expect(state.purposes.presence).toBe('granted');
    expect(state.purposes.analytics).toBe('denied');
  });
});

describe('decide — UNKNOWN is strict', () => {
  test('unknown location behaves like opt-in, not US-max', () => {
    const state = decide({ jurisdiction: 'UNKNOWN', gpc: false });
    expect(state.purposes.presence).toBe('denied');
    expect(state.purposes.analytics).toBe('denied');
    expect(state.requiresOptIn).toEqual(['presence', 'analytics']);
  });
});
