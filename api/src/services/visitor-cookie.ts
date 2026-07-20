import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { ApiError } from '../utils/api-error.js';

const SEPARATOR = '.';

interface SignedSessionCookie {
  /** Random session id, stored on the VisitorSession row as a hash. */
  sessionId: string;
  /** HMAC-signed cookie value to ship to the widget. */
  cookieValue: string;
}

/**
 * Generate a new signed visitor session cookie.
 * @param cookieSecret - Shared cookie-signing secret from env.
 * @returns Both the raw session id (to hash + store in DB) and the cookie value.
 */
export function mintVisitorCookie(cookieSecret: string): SignedSessionCookie {
  const sessionId = randomBytes(32).toString('hex');
  const sig = hmac(sessionId, cookieSecret);
  return { sessionId, cookieValue: `${sessionId}${SEPARATOR}${sig}` };
}

/**
 * Verify an incoming visitor cookie and return the session id if valid.
 * @param cookieValue - Value from the `livechat_visitor` cookie.
 * @param cookieSecret - Shared cookie-signing secret from env.
 * @returns The raw session id.
 * @throws 401 ApiError if the cookie is missing, malformed, or tampered with.
 */
export function verifyVisitorCookie(cookieValue: string, cookieSecret: string): string {
  const [sessionId, sig] = cookieValue.split(SEPARATOR);
  if (sessionId === undefined || sig === undefined) {
    throw ApiError.unauthorized('Invalid visitor cookie');
  }
  const expected = hmac(sessionId, cookieSecret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw ApiError.unauthorized('Visitor cookie signature mismatch');
  }
  return sessionId;
}

/**
 * Stable, deterministic hash of a session id — stored in `session_cookie_hash`
 * so lookups don't require decrypting or trusting the raw id.
 * @param sessionId - Raw session id.
 * @param cookieSecret - Shared cookie-signing secret.
 * @returns Hex digest.
 */
export function hashSessionId(sessionId: string, cookieSecret: string): string {
  return hmac(sessionId, cookieSecret);
}

/**
 * Compute an HMAC-SHA256 hex digest. Private helper.
 * @param value - Input string.
 * @param secret - HMAC key.
 * @returns Hex digest of the HMAC.
 */
function hmac(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}
