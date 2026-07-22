const API_BASE = '/api/v1';

interface JsonEnvelope<T> {
  success: boolean;
  data?: T;
  message?: string;
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
}

/**
 * GET /api/v1/visitor/chats/current — the returning visitor's resumable chat.
 * Used at bootstrap to offer the "welcome back, continue?" (restart) state.
 * @returns The resumable chat + its messages, or `{ chat: null, messages: [] }`.
 */
export async function fetchCurrentChat(): Promise<CurrentChat> {
  const body = await apiFetch<CurrentChat>('/visitor/chats/current', { method: 'GET' });
  return body.data ?? { chat: null, messages: [] };
}
