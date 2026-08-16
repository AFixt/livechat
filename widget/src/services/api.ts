const API_BASE = '/api/v1';

interface JsonEnvelope<T> {
  success: boolean;
  data?: T;
  message?: string;
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
 * Visitor session token for the third-party-cookie fallback (#75). When the
 * browser blocks the cross-site cookie (Safari ITP, Firefox TCP), the widget
 * resends this value — first-party storage of the visitor's own session — as
 * `X-Visitor-Session`. See ADR-0012.
 */
let sessionToken: string | null = readStoredSession();

/**
 * Read the persisted session token from first-party storage, tolerating
 * environments where storage is unavailable.
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
    throw new Error(body.message ?? `Request failed: ${res.status.toString()}`);
  }
  return body;
}

interface InitSessionResponse {
  sessionId: string;
  tenantId: string;
  csrfToken: string;
  sessionToken: string;
}

/**
 * POST /api/v1/visitor/session — boot a visitor session.
 * @param tenantKey - Tenant slug from `data-tenant-key`.
 * @returns The visitor session summary.
 */
export async function initVisitorSession(tenantKey: string): Promise<InitSessionResponse> {
  const body = await apiFetch<InitSessionResponse>('/visitor/session', {
    method: 'POST',
    body: JSON.stringify({
      tenantKey,
      currentUrl: window.location.href,
      referrer: document.referrer.length > 0 ? document.referrer : undefined,
      language: navigator.language,
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
