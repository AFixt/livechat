import type { CookieOptions, Request } from 'express';

/** The visitor session cookie name. */
export const VISITOR_COOKIE_NAME = 'livechat_visitor';
/** Visitor cookie lifetime — 30 days, how long a returning visitor keeps the same session. */
export const VISITOR_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Header the widget sends the session value in when the browser blocks the
 * third-party cookie (Safari ITP, Firefox TCP, Chrome partitioning). The value
 * is the same signed cookie value; the widget holds it in its own first-party
 * storage (#75). See ADR-0021.
 */
export const VISITOR_SESSION_HEADER = 'x-visitor-session';

/**
 * Cookie options for the visitor session. In production the widget is embedded
 * cross-site, so the cookie must be `SameSite=None; Secure` (plus `Partitioned`
 * / CHIPS as progressive enhancement) to be sent at all. `Secure` is
 * unconditional whenever `SameSite=None` — browsers reject `None` without it.
 * Locally (plain HTTP, same-origin via the Vite proxy) it stays `Lax` so no
 * insecure `None` cookie is ever emitted. Browsers that block third-party
 * cookies use the `X-Visitor-Session` header fallback instead — see ADR-0021.
 * (#75)
 * @param crossSite - True in production (cross-site embedding).
 * @returns Options for `res.cookie`.
 */
export function visitorCookieOptions(crossSite: boolean): CookieOptions {
  return {
    httpOnly: true,
    sameSite: crossSite ? 'none' : 'lax',
    secure: crossSite,
    maxAge: VISITOR_COOKIE_MAX_AGE_MS,
    path: '/',
    ...(crossSite && { partitioned: true }),
  };
}

/**
 * Resolve the visitor session value from a request: the `X-Visitor-Session`
 * header first (the cross-browser fallback), then the cookie. Cross-site
 * customer sites can't rely on the third-party cookie being sent, so the header
 * is the primary path there; the cookie remains for same-site and browsers that
 * still allow it.
 * @param req - The incoming request.
 * @returns The signed visitor cookie value, or `undefined` if neither is set.
 */
export function readVisitorSessionValue(req: Request): string | undefined {
  const header = req.header(VISITOR_SESSION_HEADER);
  if (typeof header === 'string' && header.length > 0) return header;
  const fromCookie: unknown = req.cookies[VISITOR_COOKIE_NAME];
  return typeof fromCookie === 'string' && fromCookie.length > 0 ? fromCookie : undefined;
}
