import { describe, expect, it } from 'vitest';

import { resolveGeo } from './geo-resolve.js';

import type { Env } from '../config/env.js';
import type { Request } from 'express';

/**
 * Build an Env carrying just the geo header configuration.
 * @param countryHeader - Trusted country header name, or '' for none.
 * @param regionHeader - Trusted region header name, or '' for none.
 * @returns An Env-shaped stub.
 */
function makeEnv(countryHeader: string, regionHeader = ''): Env {
  return { GEO_COUNTRY_HEADER: countryHeader, GEO_REGION_HEADER: regionHeader } as unknown as Env;
}

/**
 * Build a Request stub exposing headers case-insensitively, the way Express does.
 * @param headers - Header name/value pairs.
 * @returns A Request-shaped stub.
 */
function makeReq(headers: Record<string, string>): Request {
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { header: (name: string) => lower.get(name.toLowerCase()) } as unknown as Request;
}

const CF = makeEnv('CF-IPCountry', 'CF-Region-Code');

describe('resolveGeo — jurisdiction inputs come only from a trusted edge (#53)', () => {
  it('reads the configured country and region headers, upper-cased', () => {
    const geo = resolveGeo(CF, makeReq({ 'CF-IPCountry': 'de', 'CF-Region-Code': 'by' }));
    expect(geo).toEqual({ country: 'DE', region: 'BY' });
  });

  it('distinguishes US-CA from the US at large', () => {
    // A different regime, so the region has to survive when the country is US.
    const geo = resolveGeo(CF, makeReq({ 'CF-IPCountry': 'US', 'CF-Region-Code': 'CA' }));
    expect(geo).toEqual({ country: 'US', region: 'CA' });
  });

  it('ignores every header when none is configured', () => {
    // The fail-safe default: with no trusted edge in front of the API, nothing
    // is believed, jurisdiction resolves Unknown, and Unknown is opt-in.
    const geo = resolveGeo(makeEnv('', ''), makeReq({ 'CF-IPCountry': 'US' }));
    expect(geo).toEqual({ country: null, region: null });
  });

  it('ignores a header other than the configured one', () => {
    // A visitor sending `X-Vercel-IP-Country: US` to a Cloudflare deployment
    // must not get to pick their own jurisdiction.
    const geo = resolveGeo(CF, makeReq({ 'X-Vercel-IP-Country': 'US' }));
    expect(geo.country).toBeNull();
  });

  it.each(['USA', 'U', '', '12', 'de-DE', '<script>', 'T1'])(
    'treats a malformed country %o as unknown',
    (value) => {
      // Includes Cloudflare's `T1` (Tor exit node): two characters, but not two
      // letters, so it must not reach the ruleset as a country code.
      expect(resolveGeo(CF, makeReq({ 'CF-IPCountry': value })).country).toBeNull();
    },
  );

  it('treats the XX sentinel as unknown', () => {
    // Cloudflare's explicit "no country" value — well-formed, but not a place.
    expect(resolveGeo(CF, makeReq({ 'CF-IPCountry': 'XX' })).country).toBeNull();
  });

  it('returns a country with no region when no region header is configured', () => {
    const geo = resolveGeo(makeEnv('CF-IPCountry'), makeReq({ 'CF-IPCountry': 'US' }));
    expect(geo).toEqual({ country: 'US', region: null });
  });

  it('returns nulls when the configured header is simply absent', () => {
    expect(resolveGeo(CF, makeReq({}))).toEqual({ country: null, region: null });
  });
});
