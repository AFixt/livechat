import express, { Router, type RequestHandler } from 'express';

import { createCspReportLimiter } from '../middlewares/rate-limit.js';
import { Tenant } from '../models/index.js';
import { parseSupportHours } from '../services/support-hours.js';
import { ApiError } from '../utils/api-error.js';
import { asyncHandler } from '../utils/async-handler.js';

import { cspReportSchema, toCspLogFields } from './csp-report.js';

import type { PresenceService } from '../services/index.js';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';

/**
 * Content types a browser uses to POST CSP violations: `report-uri` sends
 * `application/csp-report`, the Reporting API sends `application/reports+json`.
 * `application/json` is accepted too for manual/testing clients.
 */
const CSP_REPORT_CONTENT_TYPES = [
  'application/csp-report',
  'application/reports+json',
  'application/json',
];

/** Hard cap on a CSP-report body — reports are tiny; anything larger is abuse. */
const CSP_REPORT_BODY_LIMIT = '8kb';

/** {@link CSP_REPORT_BODY_LIMIT} in bytes, for the Content-Length pre-check. */
const CSP_REPORT_BODY_LIMIT_BYTES = 8 * 1024;

/** Dependencies for the widget router. */
export interface WidgetRouterDeps {
  /** Presence service (for the initial support-availability flag). */
  presence: PresenceService;
  /** Shared Redis client, for the CSP-report rate limiter. */
  redis: Redis;
  /** Skip rate limiting (unit tests, where the Redis stub can't serve Lua). */
  skipRateLimit?: boolean;
}

/**
 * Resolve the support-hours display string: prefer the structured schedule's
 * own `text`, then a legacy free-text `supportHoursText` setting.
 * @param settings - The tenant's settings blob.
 * @param supportHours - The parsed schedule (or null).
 * @returns The display string, or null when neither is configured.
 */
function resolveSupportHoursText(
  settings: Record<string, unknown>,
  supportHours: ReturnType<typeof parseSupportHours>,
): string | null {
  if (supportHours?.text !== undefined) return supportHours.text;
  return typeof settings.supportHoursText === 'string' ? settings.supportHoursText : null;
}

/**
 * Assemble the public widget-config payload for a tenant.
 * @param tenant - The resolved active tenant.
 * @param supportAvailable - Whether support is currently available.
 * @returns The response `data` object.
 */
function toWidgetConfig(tenant: Tenant, supportAvailable: boolean): Record<string, unknown> {
  const settings = tenant.settings ?? {};
  return {
    tenantId: tenant.id,
    tenantKey: tenant.slug,
    name: tenant.name,
    primaryColor: settings.primaryColor ?? null,
    supportHoursText: resolveSupportHoursText(settings, parseSupportHours(settings.supportHours)),
    supportPhone: settings.supportPhone ?? null,
    supportAvailable,
    allowedOrigins: tenant.allowedOrigins ?? [],
  };
}

const noopMiddleware: RequestHandler = (_req, _res, next) => {
  next();
};

/**
 * Reject an oversized CSP report by its declared `Content-Length` before any
 * body is read. The route's own `express.json` enforces the same 8 KB limit
 * while parsing the browser content types, but a client can also POST
 * `application/json`, which the app-level 1 MB parser consumes first — leaving
 * the route parser a no-op. This guard keeps the tighter cap authoritative for
 * every content type that advertises a length. (A chunked request with no
 * `Content-Length` still falls back to the global 1 MB limit, same as every
 * other JSON endpoint.)
 * @returns Express middleware; 413 when the declared body is too large.
 */
function enforceCspReportSize(): RequestHandler {
  return (req, _res, next) => {
    const header = req.headers['content-length'];
    const length = header === undefined ? 0 : Number.parseInt(header, 10);
    if (Number.isFinite(length) && length > CSP_REPORT_BODY_LIMIT_BYTES) {
      next(new ApiError(413, 'CSP report too large'));
      return;
    }
    next();
  };
}

/**
 * Parse the CSP-report body with a tight size cap, translating body-parser
 * failures into `ApiError`s so the global handler serializes them (a bare
 * body-parser error would otherwise fall through to a 500). Oversized bodies
 * become 413; unparseable ones become 400.
 * @returns Express middleware.
 */
function parseCspReportBody(): RequestHandler {
  const parser = express.json({ type: CSP_REPORT_CONTENT_TYPES, limit: CSP_REPORT_BODY_LIMIT });
  return (req, res, next) => {
    parser(req, res, (err: unknown) => {
      if (err === undefined || err === null) {
        next();
        return;
      }
      const status = (err as { status?: number }).status;
      next(
        status === 413
          ? new ApiError(413, 'CSP report too large')
          : ApiError.badRequest('Malformed CSP report'),
      );
    });
  };
}

/**
 * Build the CSP-report handler. Validates the body against {@link cspReportSchema},
 * rejects anything that doesn't match (400), and logs only the bounded,
 * whitelisted fields — never the raw body.
 * @returns Express handler.
 */
function cspReportHandler(): RequestHandler {
  return (req, res, next) => {
    const parsed = cspReportSchema.safeParse(req.body);
    if (!parsed.success) {
      next(ApiError.badRequest('Malformed CSP report'));
      return;
    }
    // pino-http attaches a request-scoped logger (carries the correlation id).
    const { log } = req as unknown as { log: Logger };
    log.info({ cspReport: toCspLogFields(parsed.data) }, 'csp violation report');
    res.status(204).end();
  };
}

/**
 * Build the `/widget` sub-router. Public, cookieless — the widget script
 * fetches this before initializing a visitor session.
 * @param deps - Presence service (initial support-availability flag), Redis
 * client, and rate-limit flag.
 * @returns Express router.
 */
export function buildWidgetRouter(deps: WidgetRouterDeps): Router {
  const router = Router();
  const cspLimit: RequestHandler =
    deps.skipRateLimit === true ? noopMiddleware : createCspReportLimiter(deps.redis);

  router.get(
    '/config',
    asyncHandler(async (req, res) => {
      const tenantKey = req.query.tenantKey;
      if (typeof tenantKey !== 'string' || tenantKey.length === 0) {
        throw ApiError.badRequest('tenantKey is required');
      }
      const tenant = await Tenant.findOne({
        where: { slug: tenantKey, status: 'active' },
        attributes: ['id', 'slug', 'name', 'settings', 'allowedOrigins'],
      });
      if (tenant === null) throw ApiError.notFound('Unknown tenant');

      const supportHours = parseSupportHours(tenant.settings?.supportHours);
      const supportAvailable = await deps.presence.anyStaffAvailable(tenant.id, { supportHours });
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, data: toWidgetConfig(tenant, supportAvailable) });
    }),
  );

  // Public, unauthenticated log sink. Hardened: a per-IP rate limit, a tight
  // body-size cap (its own express.json overriding the global 1mb limit), a
  // Zod schema that rejects anything not shaped like a CSP report, and logging
  // restricted to whitelisted fields.
  router.post(
    '/csp-report',
    cspLimit,
    enforceCspReportSize(),
    parseCspReportBody(),
    cspReportHandler(),
  );

  return router;
}
