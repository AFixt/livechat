import { VISITOR_COOKIE_NAME, visitorCookieOptions } from './visitor-cookie-options.js';

import type { Env } from '../config/env.js';
import type { VisitorSessionService } from '../services/index.js';
import type { Request, Response } from 'express';

interface SubjectDeps {
  env: Env;
  visitorSession: VisitorSessionService;
}

/**
 * Detect a universal opt-out (GPC) signal from the request. Honors both the
 * `Sec-GPC: 1` request header and an explicit client-detected flag
 * (`navigator.globalPrivacyControl`, sent by the widget).
 * @param req - The Express request.
 * @param clientFlag - The client-detected GPC flag, if any.
 * @returns Whether GPC is present.
 */
export function detectGpc(req: Request, clientFlag: boolean | undefined): boolean {
  return req.header('sec-gpc') === '1' || clientFlag === true;
}

/**
 * Resolve the visitor's durable subject key from the cookie, minting a fresh
 * cookie handle (and setting it on the response) when none is present. The
 * minted handle creates **no** `visitor_sessions` row — it is a non-tracking
 * identifier so the widget works and consent can be recorded pre-consent.
 * @param deps - Env + visitor-session service.
 * @param req - Request (for the incoming cookie).
 * @param res - Response (to set a new cookie when minted).
 * @returns The subject key.
 */
export function resolveSubject(deps: SubjectDeps, req: Request, res: Response): string {
  const raw: unknown = req.cookies[VISITOR_COOKIE_NAME];
  if (typeof raw === 'string' && raw.length > 0) {
    return deps.visitorSession.subjectKeyFromCookie(raw);
  }
  const { cookieValue, subjectKey } = deps.visitorSession.mintHandle();
  res.cookie(VISITOR_COOKIE_NAME, cookieValue, visitorCookieOptions(deps.env));
  return subjectKey;
}
