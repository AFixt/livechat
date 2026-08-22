const API_BASE = '/api/v1';

interface JsonEnvelope<T> {
  success: boolean;
  data?: T;
  message?: string;
}

/**
 * A non-2xx API response. Carries the status so callers can tell a recoverable
 * "no session yet" (401) apart from a real failure, rather than string-matching
 * the message (#129).
 */
export class ApiRequestError extends Error {
  /** HTTP status of the failed response. */
  readonly status: number;

  /**
   * Build a request error for a non-2xx response.
   * @param status - HTTP status of the failed response.
   * @param message - Server-supplied message, or a generated fallback.
   */
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
  }
}

/**
 * CSRF token for cookie-authenticated writes (#77). Held in memory only —
 * never a cookie — so a cross-site attacker carrying the ambient visitor
 * cookie cannot read or forge it. Seeded from the bootstrap responses.
 */
let csrfToken: string | null = null;

/**
 * Record the CSRF token returned by a bootstrap endpoint.
 * @param token - The token to send on subsequent write requests.
 */
export function setCsrfToken(token: string): void {
  csrfToken = token;
}

/** First-party storage key for the visitor session token (#75). */
const SESSION_STORAGE_KEY = 'afixt.livechat.session';

/**
 * Read the persisted session token from first-party storage, tolerating
 * environments where storage is unavailable (private mode, blocked storage).
 * @returns The stored token, or null.
 */
function readStoredSession(): string | null {
  try {
    return window.localStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Visitor session token for the third-party-cookie fallback (#75). When the
 * browser blocks the cross-site cookie (Safari ITP, Firefox TCP), the widget
 * resends this value — first-party storage of the visitor's own session — as
 * `X-Visitor-Session`. See ADR-0021.
 */
let sessionToken: string | null = readStoredSession();

/**
 * Record the visitor session token, persisting it for later page loads.
 * @param token - The signed session value from a bootstrap response.
 */
export function setSessionToken(token: string): void {
  sessionToken = token;
  try {
    window.localStorage.setItem(SESSION_STORAGE_KEY, token);
  } catch {
    // Storage blocked/full — the in-memory copy still serves this page load.
  }
}

/**
 * The current visitor session token, for the socket handshake `auth` payload.
 * @returns The token, or null if no session yet.
 */
export function getSessionToken(): string | null {
  return sessionToken;
}

/**
 * Minimal fetch wrapper — cookie-authed, credentials: 'include' so the
 * signed visitor cookie is sent on every request. No axios dependency
 * keeps the widget bundle small.
 * @param path - Path relative to /api/v1.
 * @param init - Standard `fetch` init.
 * @returns Parsed JSON envelope.
 * @throws On network errors or non-2xx responses.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<JsonEnvelope<T>> {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  // Echo the CSRF token on cookie-authenticated writes (#77). Harmless on
  // reads; the server only checks it on state-changing routes.
  if (csrfToken !== null && !headers.has('X-XSRF-TOKEN')) {
    headers.set('X-XSRF-TOKEN', csrfToken);
  }
  // Send the session token when the browser blocks the third-party cookie
  // (#75). The server prefers this header over the cookie when both arrive.
  if (sessionToken !== null && !headers.has('X-Visitor-Session')) {
    headers.set('X-Visitor-Session', sessionToken);
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers,
  });
  const body = (await res.json().catch(() => ({}))) as JsonEnvelope<T>;
  if (!res.ok) {
    throw new ApiRequestError(
      res.status,
      body.message ?? `Request failed: ${res.status.toString()}`,
    );
  }
  return body;
}

interface WidgetConfigResponse {
  tenantId: string;
  tenantKey: string;
  name: string;
  primaryColor: string | null;
  supportHoursText: string | null;
  supportPhone: string | null;
  /** Whether support is available *right now* (agents online + within hours). */
  supportAvailable: boolean;
}

/**
 * GET /api/v1/widget/config — public tenant configuration. Fetched at
 * bootstrap for the tenant's support-hours text and the current
 * support-availability flag (which seeds the invitation / no-support states
 * before any live socket event arrives).
 * @param tenantKey - Tenant slug from `data-tenant-key`.
 * @returns The public tenant config.
 */
export async function fetchWidgetConfig(tenantKey: string): Promise<WidgetConfigResponse> {
  const body = await apiFetch<WidgetConfigResponse>(
    `/widget/config?tenantKey=${encodeURIComponent(tenantKey)}`,
    { method: 'GET' },
  );
  if (body.data === undefined) throw new Error('No config returned');
  return body.data;
}

/** Effective per-purpose tracking decision returned by the consent gate. */
interface TrackingState {
  functional: 'granted' | 'denied';
  presence: 'granted' | 'denied';
  analytics: 'granted' | 'denied';
}

interface InitSessionResponse {
  /**
   * The tracked-session id, or `null` when the consent gate suppressed ambient
   * presence tracking. `null` means: render and allow chat (functional), but do
   * not open the presence socket.
   */
  sessionId: string | null;
  tenantId: string;
  csrfToken: string;
  jurisdiction: string;
  gpc: boolean;
  tracking: TrackingState;
  /** Persisted and resent as X-Visitor-Session when the cookie is blocked (#75). */
  sessionToken: string;
}

/**
 * Read the browser's Global Privacy Control signal, if the runtime exposes it.
 * `navigator.globalPrivacyControl` is `true` when the visitor has enabled a
 * universal opt-out. Returns `true` only when explicitly set, never a guess.
 * @returns Whether GPC is enabled.
 */
function detectGpc(): boolean {
  return (
    (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true
  );
}

/**
 * POST /api/v1/visitor/session — run the consent gate and, when ambient
 * presence tracking is permitted, boot a tracked visitor session. Sends the
 * browser's GPC signal so a universal opt-out suppresses tracking before it
 * starts.
 *
 * The raw call. Use {@link initVisitorSession}, which shares one in-flight
 * request across callers.
 * @param tenantKey - Tenant slug from `data-tenant-key`.
 * @returns The gate decision plus the session summary.
 */
async function requestVisitorSession(tenantKey: string): Promise<InitSessionResponse> {
  const gpc = detectGpc();
  const body = await apiFetch<InitSessionResponse>('/visitor/session', {
    method: 'POST',
    body: JSON.stringify({
      tenantKey,
      currentUrl: window.location.href,
      referrer: document.referrer.length > 0 ? document.referrer : undefined,
      language: navigator.language,
      ...(gpc && { gpc: true }),
    }),
  });
  if (body.data === undefined) throw new Error('No session returned');
  setCsrfToken(body.data.csrfToken);
  setSessionToken(body.data.sessionToken);
  return body.data;
}

interface InitiatedChat {
  chat: { id: string; status: string };
  message: { id: string; body: string; deliveredAt: string };
  /** Whether any support agent was online when the chat was created. */
  supportAvailable: boolean;
}

/**
 * POST /api/v1/visitor/chats — start a new chat.
 * @param customerName - Name entered by the visitor.
 * @param firstMessage - Initial message text.
 * @param customerEmail - Optional email for transcript / fallback.
 * @returns The new chat + first message + support availability.
 */
export async function initiateChat(
  customerName: string,
  firstMessage: string,
  customerEmail?: string,
): Promise<InitiatedChat> {
  const body = await apiFetch<InitiatedChat>('/visitor/chats', {
    method: 'POST',
    body: JSON.stringify({
      customerName,
      body: firstMessage,
      ...(customerEmail !== undefined && { customerEmail }),
    }),
  });
  if (body.data === undefined) throw new Error('No chat returned');
  return body.data;
}

/**
 * Start a chat, establishing the visitor session first if the widget's own
 * bootstrap has not finished yet (#129).
 *
 * The widget renders its start-chat form immediately, but a session only exists
 * after several sequential round-trips. A visitor on a slow link — or one whose
 * stored session has been expired or revoked server-side (#79) — could
 * otherwise submit into a `401` and land on an error with their typed message
 * still in the form and no explanation. So: make sure a session exists, and if
 * the write is still rejected for want of one, mint a fresh session and retry
 * exactly once. A second `401` is a real failure and propagates.
 * @param tenantKey - Tenant slug from `data-tenant-key`.
 * @param customerName - Name entered by the visitor.
 * @param firstMessage - Initial message text.
 * @param customerEmail - Optional email for transcript / fallback.
 * @returns The new chat + first message + support availability.
 */
export async function startChat(
  tenantKey: string,
  customerName: string,
  firstMessage: string,
  customerEmail?: string,
): Promise<InitiatedChat> {
  await initVisitorSession(tenantKey);
  try {
    return await initiateChat(customerName, firstMessage, customerEmail);
  } catch (err) {
    if (!(err instanceof ApiRequestError) || err.status !== 401) throw err;
    // The session we thought we had is gone (expired, revoked, or never
    // finished being set). Establish a fresh one and retry — the visitor's
    // typed input is still in hand, so this is invisible to them. Bypasses the
    // shared promise deliberately: the cached one resolved to the session that
    // just failed.
    await requestVisitorSession(tenantKey);
    return initiateChat(customerName, firstMessage, customerEmail);
  }
}

interface CurrentChatMessage {
  id: string;
  body: string;
  senderKind: 'visitor' | 'user' | 'system';
  deliveredAt: string;
}

interface CurrentChat {
  chat: { id: string; status: string; customerName: string | null } | null;
  messages: CurrentChatMessage[];
  /** Present for a returning visitor who never re-calls /session (#77). */
  csrfToken?: string;
  /** Echoed session token so it can be persisted for the header fallback (#75). */
  sessionToken?: string;
}

/**
 * GET /api/v1/visitor/chats/current — the returning visitor's resumable chat.
 * Used at bootstrap to offer the "welcome back, continue?" (restart) state.
 * @returns The resumable chat + its messages, or `{ chat: null, messages: [] }`.
 */
export async function fetchCurrentChat(): Promise<CurrentChat> {
  const body = await apiFetch<CurrentChat>('/visitor/chats/current', { method: 'GET' });
  if (body.data?.csrfToken !== undefined) setCsrfToken(body.data.csrfToken);
  if (body.data?.sessionToken !== undefined) setSessionToken(body.data.sessionToken);
  return body.data ?? { chat: null, messages: [] };
}

/**
 * The one in-flight (or completed) consent-gate call for this page load.
 *
 * Shared so the widget's own startup and a visitor who submits the start-chat
 * form mid-startup converge on the same session instead of racing (#129). It
 * also stops a second `POST /visitor/session` being issued, which would ask the
 * consent gate to decide twice for one page view.
 */
let sessionPromise: Promise<InitSessionResponse> | null = null;

/**
 * Run the consent gate and establish the visitor session, exactly once per page
 * load. Every caller shares one request, so a visitor who submits the start-chat
 * form before startup finishes waits for the *same* session rather than sending
 * a chat write with no cookie and getting a 401 (#129).
 *
 * A rejected call is not cached, so a later attempt retries rather than
 * inheriting the failure.
 * @param tenantKey - Tenant slug from `data-tenant-key`.
 * @returns The gate decision plus the session summary.
 */
export async function initVisitorSession(tenantKey: string): Promise<InitSessionResponse> {
  sessionPromise ??= requestVisitorSession(tenantKey);
  try {
    return await sessionPromise;
  } catch (err) {
    sessionPromise = null;
    throw err;
  }
}
