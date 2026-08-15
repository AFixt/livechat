import { createHmac, timingSafeEqual } from 'node:crypto';

import { ApiError } from '../utils/api-error.js';

import { readVisitorSessionValue } from './visitor-request.js';

import type { Env } from '../config/env.js';
import type { RequestHandler } from 'express';

/** Header the widget echoes the CSRF token in (already in the CORS allowlist). */
const CSRF_HEADER = 'x-xsrf-token';

/**
 * Derive the CSRF token for a visitor cookie. A synchronizer token bound to the
 * signed cookie via HMAC: an attacker driving a cross-site request carries the
 * ambient cookie but cannot compute this — the token lives in the widget's JS
 * memory (returned by the bootstrap endpoints), never in a cookie the attacker
 * can read. Stateless, so it needs no storage and survives restarts (#77).
 * @param cookieValue - The raw `livechat_visitor` cookie value.
 * @param secret - The shared cookie secret.
 * @returns Hex HMAC token to hand to the widget and verify on write requests.
 */
export function computeCsrfToken(cookieValue: string, secret: string): string {
  // Namespaced input so the token can never collide with the cookie's own
  // signature (which HMACs the bare session id with the same secret).
  return createHmac('sha256', secret).update(`csrf:${cookieValue}`).digest('hex');
}

/**
 * Constant-time string compare.
 * @param a - First value.
 * @param b - Second value.
 * @returns True if equal.
 */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * CSRF protection for cookie-authenticated, state-changing visitor routes
 * (#77). Requires the `X-XSRF-TOKEN` header to match the token derived from the
 * presented visitor cookie. Bearer-token (console) routes are not covered —
 * CSRF applies only to ambient credentials, and the `Authorization` header is
 * never sent automatically by the browser.
 * @param env - Env carrying the cookie secret.
 * @returns Express middleware that 403s on a missing/invalid token.
 */
export function csrfProtection(env: Pick<Env, 'COOKIE_SECRET'>): RequestHandler {
  return (req, _res, next) => {
    const cookie = readVisitorSessionValue(req);
    // No ambient cookie credential means nothing to forge — let the route's own
    // auth check produce the 401.
    if (cookie === undefined) {
      next();
      return;
    }
    const provided = req.header(CSRF_HEADER);
    const expected = computeCsrfToken(cookie, env.COOKIE_SECRET);
    if (provided === undefined || !safeEqual(provided, expected)) {
      next(ApiError.forbidden('Invalid or missing CSRF token'));
      return;
    }
    next();
  };
}
