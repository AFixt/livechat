import type { Env } from '../config/env.js';
import type { CookieOptions } from 'express';

/** Name of the signed cookie that carries the visitor's session/subject id. */
export const VISITOR_COOKIE_NAME = 'livechat_visitor';

/** 30 days — how long a returning visitor keeps the same session/subject. */
export const VISITOR_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Build the `res.cookie` options for the visitor cookie. Centralized so the
 * visitor and privacy routers set an identical cookie.
 * @param env - Env (used to gate `secure` to production).
 * @returns Express cookie options.
 */
export function visitorCookieOptions(env: Pick<Env, 'NODE_ENV'>): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    maxAge: VISITOR_COOKIE_MAX_AGE_MS,
    path: '/',
  };
}
