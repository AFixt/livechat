import { Op, fn, col, where as sqlWhere } from 'sequelize';

import { Tenant } from '../models/index.js';

import type { Env } from '../config/env.js';
import type { CorsOptions, CorsOptionsDelegate } from 'cors';
import type { Request } from 'express';

/** Path prefixes served to the embeddable widget from arbitrary origins. */
const WIDGET_FACING_PREFIXES = ['/api/v1/visitor', '/api/v1/widget', '/v1/visitor', '/v1/widget'];

/** How long a resolved origin decision is cached, to avoid a DB hit per request. */
const ORIGIN_CACHE_TTL_MS = 60_000;

/**
 * Hard cap on distinct cached origins. The cache key is the request `Origin`
 * header, which an attacker can vary without bound; without a cap a flood of
 * unique origins would grow the map unboundedly (each entry lingers until its
 * TTL is checked on a later read). When the cap is hit the oldest entry is
 * evicted (insertion-ordered `Map`), keeping memory bounded.
 */
const ORIGIN_CACHE_MAX_ENTRIES = 10_000;

const originCache = new Map<string, { allowed: boolean; expiresAt: number }>();

/**
 * Record an origin decision, evicting the oldest entry when the cache is full.
 * @param origin - The `Origin` header value used as the cache key.
 * @param allowed - Whether any active tenant authorizes the origin.
 * @param now - Current epoch millis (the TTL base).
 */
function cacheOriginDecision(origin: string, allowed: boolean, now: number): void {
  if (!originCache.has(origin) && originCache.size >= ORIGIN_CACHE_MAX_ENTRIES) {
    const oldest = originCache.keys().next().value;
    if (oldest !== undefined) originCache.delete(oldest);
  }
  originCache.set(origin, { allowed, expiresAt: now + ORIGIN_CACHE_TTL_MS });
}

/**
 * True when the request targets a widget-facing route that arbitrary customer
 * sites embed. Only these routes get per-tenant origin reflection; console
 * routes keep the strict single-origin policy (#74).
 * @param path - The request path.
 * @returns Whether the path is widget-facing.
 */
function isWidgetFacingPath(path: string): boolean {
  return WIDGET_FACING_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * Whether `origin` appears in some active tenant's `allowed_origins`. This is
 * the cross-origin gate for the widget: an origin no tenant has authorized is
 * never reflected, so an unconfigured tenant cannot be embedded cross-site
 * (ADR-0011). The per-tenant match (this origin belongs to *this* tenant) is
 * still enforced on the request itself by `originAllowed()`.
 *
 * Cached for {@link ORIGIN_CACHE_TTL_MS} because both the preflight and the
 * actual request ask, and the widget's hot path must not scan the tenants
 * table twice per call.
 * @param origin - The request `Origin` header value.
 * @returns True if any active tenant allows the origin.
 */
export async function isKnownWidgetOrigin(origin: string): Promise<boolean> {
  const cached = originCache.get(origin);
  const now = Date.now();
  if (cached !== undefined && cached.expiresAt > now) return cached.allowed;

  const count = await Tenant.count({
    where: {
      status: 'active',
      [Op.and]: [sqlWhere(fn('JSON_CONTAINS', col('allowed_origins'), JSON.stringify(origin)), 1)],
    },
  });
  const allowed = count > 0;
  cacheOriginDecision(origin, allowed, now);
  return allowed;
}

/** Clear the origin-decision cache. For tests, and after allowed-origins edits. */
export function clearOriginCache(): void {
  originCache.clear();
}

/**
 * Build the CORS delegate. Console routes get the strict, fixed `APP_URL`
 * policy; widget-facing routes reflect the requesting origin only when it is a
 * known widget origin, and reject it otherwise (#74). `cors` adds `Vary: Origin`
 * whenever the allowed origin is not `*`, so caches never serve one tenant's
 * headers to another.
 * @param env - Validated env (for `APP_URL`).
 * @returns A `cors` delegate suitable for `app.use(cors(delegate))`.
 */
export function buildCorsDelegate(env: Pick<Env, 'APP_URL'>): CorsOptionsDelegate<Request> {
  const base: CorsOptions = {
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-ID', 'X-XSRF-TOKEN'],
  };

  return (req, callback) => {
    const origin = req.headers.origin;
    // Console routes, or a request with no Origin (same-origin / server-to-
    // server): keep the fixed console policy.
    if (!isWidgetFacingPath(req.path) || origin === undefined) {
      callback(null, { ...base, origin: env.APP_URL });
      return;
    }
    // The console legitimately calls widget-facing routes too (dev proxy,
    // presence), so it stays allowed alongside per-tenant origins.
    if (origin === env.APP_URL) {
      callback(null, { ...base, origin });
      return;
    }
    void isKnownWidgetOrigin(origin)
      .then((allowed) => {
        callback(null, { ...base, origin: allowed ? origin : false });
      })
      .catch((err: unknown) => {
        callback(err instanceof Error ? err : new Error('CORS origin lookup failed'));
      });
  };
}
