import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as ApiModule from './api.js';

/**
 * Load a fresh copy of the api module — its bootstrap promise is module-level
 * and deliberately caches for the page's lifetime.
 * @returns The freshly imported module.
 */
async function freshApi(): Promise<typeof ApiModule> {
  vi.resetModules();
  return import('./api.js');
}

interface RouteResult {
  status: number;
  body: unknown;
  /** Milliseconds to hold the response for, simulating a slow link. */
  delayMs?: number;
}

const UNAUTHORIZED: RouteResult = {
  status: 401,
  body: { success: false, message: 'Visitor session required' },
};
const SESSION_OK: RouteResult = {
  status: 201,
  body: { success: true, data: { sessionId: 's1', tenantId: 't1', csrfToken: 'csrf' } },
};
const NO_RESUMABLE_CHAT: RouteResult = {
  status: 200,
  body: { success: true, data: { chat: null, messages: [], csrfToken: 'csrf' } },
};
const CHAT_OK: RouteResult = {
  status: 201,
  body: {
    success: true,
    data: {
      chat: { id: 'c1', status: 'active' },
      message: { id: 'm1', body: 'hello', deliveredAt: '2026-08-21T00:00:00.000Z' },
      supportAvailable: true,
    },
  },
};

interface StubOptions {
  /** Seed a returning visitor who already holds a valid session cookie. */
  hasSession?: boolean;
}

/**
 * A stand-in for the API that enforces the one rule this issue is about: the
 * signed visitor cookie exists only once `POST /visitor/session` has *responded*,
 * and every other visitor route 401s without it. A stub that always accepts the
 * chat write cannot reproduce the defect, because the defect is precisely that
 * the write arrives too early.
 * @param routes - Map of "METHOD /path" to the response to give.
 * @param options - Starting conditions.
 * @returns The ordered list of routes served.
 */
function stubApi(
  routes: Record<string, RouteResult | (() => RouteResult)>,
  options: StubOptions = {},
): { calls: string[] } {
  const calls: string[] = [];
  let hasSession = options.hasSession ?? false;
  const mock = vi.fn((path: string, init: RequestInit) => {
    const method = init.method ?? 'GET';
    const key = `${method} ${path.replace('/api/v1', '')}`;
    calls.push(key);
    const entry = routes[key];
    if (entry === undefined) throw new Error(`unrouted request: ${key}`);
    const result = typeof entry === 'function' ? entry() : entry;
    const respond = (): unknown => {
      if (key === 'POST /visitor/session' && result.status < 400) hasSession = true;
      const needsSession = key !== 'POST /visitor/session';
      const effective = needsSession && !hasSession ? UNAUTHORIZED : result;
      return {
        ok: effective.status < 400,
        status: effective.status,
        json: () => Promise.resolve(effective.body),
      };
    };
    if (result.delayMs === undefined) return Promise.resolve(respond());
    return new Promise((resolve) =>
      setTimeout(() => {
        resolve(respond());
      }, result.delayMs),
    );
  });
  vi.stubGlobal('fetch', mock);
  return { calls };
}

describe('startChat — submitting before the widget has finished starting up (#129)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts the chat even when the session POST is slow to respond', async () => {
    const api = await freshApi();
    const { calls } = stubApi({
      'GET /visitor/chats/current': NO_RESUMABLE_CHAT,
      // The condition from the issue, reproduced: the session is slow, so a
      // chat write that does not wait for it arrives with no cookie.
      'POST /visitor/session': { ...SESSION_OK, delayMs: 50 },
      'POST /visitor/chats': CHAT_OK,
    });

    // The visitor submits immediately — nothing awaits the bootstrap first.
    const result = await api.startChat('acme', 'Fast Visitor', 'hello');

    expect(result.chat.id).toBe('c1');
    expect(calls.indexOf('POST /visitor/chats')).toBeGreaterThan(
      calls.indexOf('POST /visitor/session'),
    );
  });

  it('does not mint a second session when startup is already in flight', async () => {
    const api = await freshApi();
    const { calls } = stubApi({
      'GET /visitor/chats/current': NO_RESUMABLE_CHAT,
      'POST /visitor/session': { ...SESSION_OK, delayMs: 30 },
      'POST /visitor/chats': CHAT_OK,
    });

    // The widget's own bootstrap and the visitor's submit, concurrently.
    const [, result] = await Promise.all([
      api.bootstrapVisitorSession('acme'),
      api.startChat('acme', 'Fast Visitor', 'hello'),
    ]);

    expect(result.chat.id).toBe('c1');
    expect(calls.filter((c) => c === 'POST /visitor/session')).toHaveLength(1);
  });

  it('reuses a returning visitor session instead of orphaning their chat', async () => {
    const api = await freshApi();
    const { calls } = stubApi(
      {
        'GET /visitor/chats/current': NO_RESUMABLE_CHAT,
        'POST /visitor/chats': CHAT_OK,
      },
      { hasSession: true },
    );

    await api.startChat('acme', 'Returning Visitor', 'hello again');

    // A session already existed, so no new one may be minted.
    expect(calls).not.toContain('POST /visitor/session');
  });

  it('recovers once when the held session has been revoked server-side', async () => {
    const api = await freshApi();
    let chatAttempts = 0;
    const { calls } = stubApi(
      {
        'GET /visitor/chats/current': NO_RESUMABLE_CHAT,
        'POST /visitor/session': SESSION_OK,
        'POST /visitor/chats': () => {
          chatAttempts += 1;
          return chatAttempts === 1 ? UNAUTHORIZED : CHAT_OK;
        },
      },
      { hasSession: true },
    );

    const result = await api.startChat('acme', 'Revoked Visitor', 'hello');

    expect(result.chat.id).toBe('c1');
    expect(chatAttempts).toBe(2);
    expect(calls).toContain('POST /visitor/session');
  });

  it('gives up rather than looping when the retry is also refused', async () => {
    const api = await freshApi();
    stubApi({
      'GET /visitor/chats/current': NO_RESUMABLE_CHAT,
      'POST /visitor/session': SESSION_OK,
      'POST /visitor/chats': UNAUTHORIZED,
    });

    await expect(api.startChat('acme', 'Doomed', 'hello')).rejects.toThrow(
      'Visitor session required',
    );
  });

  it('propagates a non-session failure without retrying', async () => {
    const api = await freshApi();
    let chatAttempts = 0;
    stubApi({
      'GET /visitor/chats/current': NO_RESUMABLE_CHAT,
      'POST /visitor/session': SESSION_OK,
      'POST /visitor/chats': () => {
        chatAttempts += 1;
        return { status: 400, body: { success: false, message: 'Message is required' } };
      },
    });

    await expect(api.startChat('acme', 'Bad Input', '')).rejects.toThrow('Message is required');
    expect(chatAttempts).toBe(1);
  });

  it('lets a later attempt retry after a failed bootstrap', async () => {
    const api = await freshApi();
    let sessionAttempts = 0;
    stubApi({
      'GET /visitor/chats/current': NO_RESUMABLE_CHAT,
      'POST /visitor/session': () => {
        sessionAttempts += 1;
        return sessionAttempts === 1
          ? { status: 500, body: { success: false, message: 'Server error' } }
          : SESSION_OK;
      },
      'POST /visitor/chats': CHAT_OK,
    });

    await expect(api.startChat('acme', 'Unlucky', 'hello')).rejects.toThrow('Server error');
    // The failed bootstrap must not be cached — pressing "Start chat" again works.
    const result = await api.startChat('acme', 'Unlucky', 'hello');
    expect(result.chat.id).toBe('c1');
  });
});
