import { describe, expect, it } from 'vitest';

import {
  VISITOR_SESSION_HEADER,
  readVisitorSessionValue,
  visitorCookieOptions,
} from '../../src/middlewares/visitor-request.js';

import type { Request } from 'express';

/**
 * Build a minimal Request stub carrying an optional header and cookies.
 * @param header - The `X-Visitor-Session` header value, if any.
 * @param cookies - The parsed cookies bag.
 * @returns A Request-shaped stub.
 */
function makeReq(header: string | undefined, cookies: Record<string, unknown>): Request {
  return {
    header: (name: string) => (name.toLowerCase() === VISITOR_SESSION_HEADER ? header : undefined),
    cookies,
  } as unknown as Request;
}

describe('visitorCookieOptions (#75)', () => {
  it('is SameSite=None; Secure; Partitioned when cross-site (production)', () => {
    const opts = visitorCookieOptions(true);
    expect(opts.sameSite).toBe('none');
    expect(opts.secure).toBe(true);
    expect((opts as { partitioned?: boolean }).partitioned).toBe(true);
    expect(opts.httpOnly).toBe(true);
  });

  it('never emits SameSite=None without Secure — dev stays Lax', () => {
    const opts = visitorCookieOptions(false);
    expect(opts.sameSite).toBe('lax');
    expect(opts.secure).toBe(false);
    expect((opts as { partitioned?: boolean }).partitioned).toBeUndefined();
  });
});

describe('readVisitorSessionValue (#75)', () => {
  it('prefers the X-Visitor-Session header (third-party-cookie fallback)', () => {
    const req = makeReq('header-token', { livechat_visitor: 'cookie-token' });
    expect(readVisitorSessionValue(req)).toBe('header-token');
  });

  it('falls back to the cookie when the header is absent', () => {
    const req = makeReq(undefined, { livechat_visitor: 'cookie-token' });
    expect(readVisitorSessionValue(req)).toBe('cookie-token');
  });

  it('returns undefined when neither is present', () => {
    const req = makeReq(undefined, {});
    expect(readVisitorSessionValue(req)).toBeUndefined();
  });
});
