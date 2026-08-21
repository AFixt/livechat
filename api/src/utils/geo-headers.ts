import type { Request } from 'express';

/**
 * A coarse, country-level location for a request. Deliberately no finer than
 * this: the jurisdiction engine only buckets by country (and US state), and
 * #57's minimization rules forbid persisting anything more precise.
 */
export interface RequestGeo {
  /** ISO 3166-1 alpha-2, upper-cased, or null when unknown. */
  country: string | null;
  /** Subdivision code (e.g. `CA`), upper-cased, or null when unknown. */
  region: string | null;
}

/** Nothing known — the caller falls back to the strict `UNKNOWN` bucket. */
const NO_GEO: RequestGeo = { country: null, region: null };

/**
 * Accept only a plausible ISO 3166-1 alpha-2 code. Anything else is treated as
 * unknown rather than passed through, so a malformed or injected header cannot
 * reach the ruleset as a bogus bucket.
 * @param raw - Raw header value.
 * @returns The normalized code, or null.
 */
function normalizeCode(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const value = raw.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(value)) return null;
  // Cloudflare sends `XX` for "unknown" and `T1` for Tor exit nodes. Both mean
  // "no usable country", and both would otherwise fall through to UNKNOWN
  // anyway — but naming them documents that they are expected, not malformed.
  if (value === 'XX' || value === 'T1') return null;
  return value;
}

/**
 * Resolve the visitor's coarse location from edge-supplied request headers.
 *
 * **Only the headers named in `GEO_COUNTRY_HEADER` / `GEO_REGION_HEADER` are
 * read, and by default neither is set.** A request header is attacker-supplied
 * unless a trusted proxy overwrites it, and the failure mode here is not
 * theoretical: a visitor in the EU could send `CF-IPCountry: US` and downgrade
 * themselves from an opt-in regime to opt-out — spoofing their way *out* of
 * the protection the engine exists to apply. Naming the header is therefore an
 * explicit statement that the edge sets it and strips any client-supplied copy.
 *
 * With nothing configured this returns no geo, jurisdiction resolves to
 * `UNKNOWN`, and `UNKNOWN` is strict opt-in — so the unconfigured default stays
 * fail-safe (#120, #56).
 * @param req - The incoming request.
 * @param config - The header names to trust; empty means trust none.
 * @returns The coarse location, or nulls when unknown or untrusted.
 */
export function resolveRequestGeo(
  req: Request,
  config: { countryHeader?: string | undefined; regionHeader?: string | undefined },
): RequestGeo {
  // Absent and empty mean the same thing — not configured. Treating them
  // identically keeps a caller that never set the vars on the safe path rather
  // than throwing on `req.header(undefined)`.
  const countryHeader = config.countryHeader ?? '';
  const regionHeader = config.regionHeader ?? '';
  if (countryHeader === '') return NO_GEO;
  const country = normalizeCode(req.header(countryHeader));
  if (country === null) return NO_GEO;
  const region = regionHeader === '' ? null : normalizeCode(req.header(regionHeader));
  return { country, region };
}
