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

interface InitSessionResponse {
  sessionId: string;
  tenantId: string;
  csrfToken: string;
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
  await bootstrapVisitorSession(tenantKey);
  try {
    return await initiateChat(customerName, firstMessage, customerEmail);
  } catch (err) {
    if (!(err instanceof ApiRequestError) || err.status !== 401) throw err;
    // The session we thought we had is gone (expired, revoked, or never
    // finished being set). Mint a new one and retry — the visitor's typed
    // input is still in hand, so this is invisible to them.
    await initVisitorSession(tenantKey);
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
}

/**
 * GET /api/v1/visitor/chats/current — the returning visitor's resumable chat.
 * Used at bootstrap to offer the "welcome back, continue?" (restart) state.
 * @returns The resumable chat + its messages, or `{ chat: null, messages: [] }`.
 */
export async function fetchCurrentChat(): Promise<CurrentChat> {
  const body = await apiFetch<CurrentChat>('/visitor/chats/current', { method: 'GET' });
  if (body.data?.csrfToken !== undefined) setCsrfToken(body.data.csrfToken);
  return body.data ?? { chat: null, messages: [] };
}

/**
 * The one in-flight (or completed) session bootstrap for this page load.
 * Shared so the widget's own startup and a visitor who submits the start-chat
 * form mid-startup converge on the same session instead of racing (#129).
 */
let bootstrapPromise: Promise<CurrentChat | null> | null = null;

/**
 * Establish the visitor session, exactly once per page load.
 *
 * Probing the resumable chat doubles as the "do I have a session?" check: it
 * succeeds only when the signed cookie is already present, so a page reload
 * reuses the existing session rather than minting a fresh one — which would
 * orphan a prior chat and break the returning-visitor (restart) flow.
 *
 * Every caller shares one promise, so a visitor who submits the form before
 * startup finishes waits for the *same* session rather than triggering a second
 * one. A rejected bootstrap is not cached, so a later attempt can retry.
 * @param tenantKey - Tenant slug from `data-tenant-key`.
 * @returns The resumable chat for a returning visitor, or null for a new one.
 */
export async function bootstrapVisitorSession(tenantKey: string): Promise<CurrentChat | null> {
  bootstrapPromise ??= (async () => {
    try {
      return await fetchCurrentChat();
    } catch {
      // No existing session (401) or unreachable — start a fresh one.
      await initVisitorSession(tenantKey);
      return null;
    }
  })();
  try {
    return await bootstrapPromise;
  } catch (err) {
    bootstrapPromise = null;
    throw err;
  }
}
