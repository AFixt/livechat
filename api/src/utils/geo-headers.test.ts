import { describe, expect, it } from 'vitest';

import { resolveRequestGeo } from './geo-headers.js';

import type { Request } from 'express';

/**
 * Build a Request stub exposing the given headers case-insensitively.
 * @param headers - Header name/value pairs.
 * @returns A Request-shaped stub.
 */
function makeReq(headers: Record<string, string>): Request {
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { header: (name: string) => lower.get(name.toLowerCase()) } as unknown as Request;
}

const CF = { countryHeader: 'CF-IPCountry', regionHeader: 'CF-Region-Code' };

describe('resolveRequestGeo (#120)', () => {
  it('reads the configured country and region headers', () => {
    const req = makeReq({ 'CF-IPCountry': 'de', 'CF-Region-Code': 'by' });
    expect(resolveRequestGeo(req, CF)).toEqual({ country: 'DE', region: 'BY' });
  });

  it('ignores every header when none is configured — the fail-safe default', () => {
    // The unconfigured deployment must not start trusting a header just because
    // a client sent one; UNKNOWN maps to strict opt-in, which is the safe end.
    const req = makeReq({ 'CF-IPCountry': 'US' });
    expect(resolveRequestGeo(req, { countryHeader: '', regionHeader: '' })).toEqual({
      country: null,
      region: null,
    });
  });

  it('ignores a header other than the configured one', () => {
    // A visitor sending `X-Vercel-IP-Country: US` to a Cloudflare deployment
    // must not be able to pick their own jurisdiction.
    const req = makeReq({ 'X-Vercel-IP-Country': 'US' });
    expect(resolveRequestGeo(req, CF)).toEqual({ country: null, region: null });
  });

  it.each(['USA', 'U', '', '12', 'de-DE', '<script>'])(
    'treats a malformed country %o as unknown',
    (value) => {
      expect(resolveRequestGeo(makeReq({ 'CF-IPCountry': value }), CF).country).toBeNull();
    },
  );

  it.each(['XX', 'T1'])('treats the %s sentinel as unknown', (value) => {
    // Cloudflare's "unknown" and "Tor exit node" values are well-formed but
    // carry no country.
    expect(resolveRequestGeo(makeReq({ 'CF-IPCountry': value }), CF).country).toBeNull();
  });

  it('drops the region when the country is unknown', () => {
    // A region without a country cannot select a bucket and would only muddy
    // the audit trail.
    const req = makeReq({ 'CF-IPCountry': 'XX', 'CF-Region-Code': 'CA' });
    expect(resolveRequestGeo(req, CF)).toEqual({ country: null, region: null });
  });

  it('returns a country with no region when no region header is configured', () => {
    const req = makeReq({ 'CF-IPCountry': 'US', 'CF-Region-Code': 'CA' });
    expect(resolveRequestGeo(req, { countryHeader: 'CF-IPCountry', regionHeader: '' })).toEqual({
      country: 'US',
      region: null,
    });
  });

  it('resolves US-CA, which is a different regime from US at large', () => {
    const req = makeReq({ 'CF-IPCountry': 'US', 'CF-Region-Code': 'CA' });
    expect(resolveRequestGeo(req, CF)).toEqual({ country: 'US', region: 'CA' });
  });
});
