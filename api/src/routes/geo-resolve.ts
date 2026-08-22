import type { Env } from '../config/env.js';
import type { Request } from 'express';

/** The visitor's geo inputs, as resolved from trusted sources only. */
export interface ResolvedGeo {
  /** ISO 3166-1 alpha-2 country, or null when no trusted source supplied one. */
  country: string | null;
  /** Subdivision code (e.g. a US state), or null. */
  region: string | null;
}

/**
 * Resolve the visitor's jurisdiction inputs from **trusted** request headers.
 *
 * Jurisdiction decides whether tracking is opt-in or opt-out, so it is a
 * security boundary: it must not come from anything the embedding page can
 * set. The widget runs on the client's own site, so a request body value could
 * be forged — or simply misconfigured — into `US` for an EU visitor, turning an
 * opt-in jurisdiction into an opt-out one. So the body is not consulted at all;
 * only a header named by `GEO_COUNTRY_HEADER` / `GEO_REGION_HEADER`, which is
 * expected to be injected by the CDN or load balancer in front of the API and
 * stripped from client-supplied input there.
 *
 * Note the deliberate asymmetry with GPC, which *is* read from the body: a
 * client signal that can only ever *deny* tracking is safe to trust, because
 * the worst a forged one can do is track someone less. A signal that can
 * *grant* is not.
 *
 * With no header configured this returns nulls, so every visitor resolves to
 * Unknown Location Mode — opt-in for presence (spec §5.4: unknown is not
 * US-max). That is the fail-safe, and it is the honest default until a trusted
 * edge is actually in front of the API.
 * @param env - Validated environment.
 * @param req - The Express request.
 * @returns The trusted geo inputs, or nulls when none are configured/present.
 */
export function resolveGeo(env: Env, req: Request): ResolvedGeo {
  const countryHeader = env.GEO_COUNTRY_HEADER;
  const regionHeader = env.GEO_REGION_HEADER;
  const rawCountry = countryHeader === '' ? undefined : req.header(countryHeader);
  const rawRegion = regionHeader === '' ? undefined : req.header(regionHeader);
  // Cloudflare sends `XX` for "unknown"; treat any non 2-letter value as absent
  // rather than letting it fall through to resolveJurisdiction as a real code.
  const country = /^[A-Za-z]{2}$/.test(rawCountry ?? '') ? (rawCountry ?? '').toUpperCase() : null;
  const region = rawRegion === undefined || rawRegion === '' ? null : rawRegion.toUpperCase();
  return { country: country === 'XX' ? null : country, region };
}
