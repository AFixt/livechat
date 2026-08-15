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
  jurisdiction: string;
  gpc: boolean;
  tracking: TrackingState;
}

/**
 * Read the browser's Global Privacy Control signal, if the runtime exposes it.
 * `navigator.globalPrivacyControl` is `true` when the visitor has enabled a
 * universal opt-out. Returns `true` only when explicitly set, never a guess.
 * @returns Whether GPC is enabled.
 */
function detectGpc(): boolean {
  return (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
}

/**
 * POST /api/v1/visitor/session — run the consent gate and (when permitted)
 * boot a tracked visitor session. Sends the browser's GPC signal so a universal
 * opt-out suppresses tracking before it starts.
 * @param tenantKey - Tenant slug from `data-tenant-key`.
 * @returns The gate decision + session summary.
 */
export async function initVisitorSession(tenantKey: string): Promise<InitSessionResponse> {
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
