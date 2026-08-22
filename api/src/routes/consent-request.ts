import {
  VISITOR_COOKIE_NAME,
  readVisitorSessionValue,
  visitorCookieOptions,
} from '../middlewares/visitor-request.js';

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

/** A resolved visitor subject: the durable key plus the raw cookie backing it. */
export interface ResolvedSubject {
  subjectKey: string;
  /**
   * The raw signed cookie value — either the one presented or the one just
   * minted. Needed to derive the per-cookie CSRF token (#77).
   */
  cookieValue: string;
}

/**
 * Resolve the visitor's durable subject key from the cookie, minting a fresh
 * cookie handle (and setting it on the response) when none is present. The
 * minted handle creates **no** `visitor_sessions` row — it is a non-tracking
 * identifier so the widget works and consent can be recorded pre-consent.
 * @param deps - Env + visitor-session service.
 * @param req - Request (for the incoming cookie).
 * @param res - Response (to set a new cookie when minted).
 * @returns The subject key and the raw cookie value backing it.
 */
export function resolveSubject(deps: SubjectDeps, req: Request, res: Response): ResolvedSubject {
  // Header first, then cookie (#75): a visitor whose browser blocks the
  // third-party cookie still has a subject, so their consent decision attaches
  // to the session they already have rather than minting a second one.
  const raw: unknown = readVisitorSessionValue(req);
  if (typeof raw === 'string' && raw.length > 0) {
    return { subjectKey: deps.visitorSession.subjectKeyFromCookie(raw), cookieValue: raw };
  }
  const { cookieValue, subjectKey } = deps.visitorSession.mintHandle();
  res.cookie(
    VISITOR_COOKIE_NAME,
    cookieValue,
    visitorCookieOptions(deps.env.NODE_ENV === 'production'),
  );
  return { subjectKey, cookieValue };
}
