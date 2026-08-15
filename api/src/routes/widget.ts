import express, { Router, type RequestHandler } from 'express';

import { createCspReportLimiter } from '../middlewares/rate-limit.js';
import { Tenant } from '../models/index.js';
import { ApiError } from '../utils/api-error.js';
import { asyncHandler } from '../utils/async-handler.js';

import { cspReportSchema, toCspLogFields } from './csp-report.js';

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

/** Dependencies for the widget router. */
export interface WidgetRouterDeps {
  /** Shared Redis client, for the CSP-report rate limiter. */
  redis: Redis;
  /** Skip rate limiting (unit tests, where the Redis stub can't serve Lua). */
  skipRateLimit?: boolean;
}

const noopMiddleware: RequestHandler = (_req, _res, next) => {
  next();
};

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
  return (req, res) => {
    const parsed = cspReportSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).end();
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
 * @param deps - Redis client and rate-limit flag.
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

      const settings = tenant.settings ?? {};
      res.set('Cache-Control', 'public, max-age=60');
      res.json({
        success: true,
        data: {
          tenantId: tenant.id,
          tenantKey: tenant.slug,
          name: tenant.name,
          primaryColor: settings.primaryColor ?? null,
          supportHoursText: settings.supportHoursText ?? null,
          supportPhone: settings.supportPhone ?? null,
          allowedOrigins: tenant.allowedOrigins ?? [],
        },
      });
    }),
  );

  // Public, unauthenticated log sink. Hardened: a per-IP rate limit, a tight
  // body-size cap (its own express.json overriding the global 1mb limit), a
  // Zod schema that rejects anything not shaped like a CSP report, and logging
  // restricted to whitelisted fields.
  router.post('/csp-report', cspLimit, parseCspReportBody(), cspReportHandler());

  return router;
}
