/**
 * Consent hook for host-site Consent Management Platforms (CMPs).
 *
 * The widget can be embedded on sites that must gate all analytics/presence
 * capture behind the visitor's consent. This module gives host pages a small,
 * dependency-free contract to grant or deny that consent — exposed globally as
 * `window.AfixtLiveChat.setConsent(...)` and as a DOM event — and a gate the
 * widget bootstrap awaits before it captures anything.
 *
 * When the AFixt consent foundation (#56/#53) lands it consumes this same hook;
 * until then the hook stores the host's decision and exposes it. See
 * `docs/privacy/cmp-integration.md` and
 * `docs/adr/0014-widget-consent-hook.md`.
 *
 * @module
 */

/** DOM event dispatched whenever the consent decision changes. */
export const CONSENT_EVENT = 'afixt-livechat:consent';

/**
 * The two consent categories the widget recognizes.
 * - `functional` — the chat itself (message transport, session cookie). Needed
 *   for the widget to work at all; granted by default.
 * - `analytics` — visitor presence/telemetry capture (session init sends URL,
 *   referrer, language, user-agent; live presence in the console). Denied by
 *   default and gated when consent is required.
 */
export interface ConsentState {
  /** Whether functional (chat-operation) processing is permitted. */
  functional: boolean;
  /** Whether analytics/presence capture is permitted. */
  analytics: boolean;
}

/** A partial consent decision passed by the host CMP. */
export type ConsentDecision = Partial<ConsentState>;

/** Subscriber invoked with a fresh snapshot on every consent change. */
export type ConsentListener = (state: ConsentState) => void;

/** The consent store contract. */
export interface ConsentStore {
  /** Current decision, as an immutable snapshot. */
  getConsent: () => ConsentState;
  /** Merge a host CMP decision, notify subscribers, emit the DOM event. */
  setConsent: (decision: ConsentDecision) => ConsentState;
  /** Subscribe to changes; returns an unsubscribe function. */
  onConsentChange: (listener: ConsentListener) => () => void;
  /** Turn consent gating on/off (driven by the `data-require-consent` attr). */
  requireConsent: (required: boolean) => void;
  /** Whether analytics/presence capture may proceed right now. */
  isCaptureAllowed: () => boolean;
  /** Resolves once capture is allowed (immediately if it already is). */
  whenCaptureAllowed: () => Promise<void>;
}

interface ConsentStoreOptions {
  /** Target the DOM event is dispatched on. Defaults to `globalThis`. */
  eventTarget?: EventTarget;
  /** Seed state, mainly for tests. */
  initial?: ConsentDecision;
}

/**
 * Create an isolated consent store. The widget uses the shared
 * {@link consentStore} singleton; tests construct fresh instances.
 * @param options - Optional event target and seed state.
 * @returns A new {@link ConsentStore}.
 */
export function createConsentStore(options: ConsentStoreOptions = {}): ConsentStore {
  const eventTarget = options.eventTarget ?? globalThis;
  const state: ConsentState = {
    functional: options.initial?.functional ?? true,
    analytics: options.initial?.analytics ?? false,
  };
  let required = false;
  const listeners = new Set<ConsentListener>();
  const waiters = new Set<() => void>();

  const snapshot = (): ConsentState => ({ ...state });
  const captureAllowed = (): boolean => !required || state.analytics;

  const emit = (): void => {
    const detail = snapshot();
    for (const listener of [...listeners]) listener(detail);
    if (typeof eventTarget.dispatchEvent === 'function') {
      eventTarget.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail }));
    }
    if (captureAllowed()) {
      for (const resolve of [...waiters]) resolve();
      waiters.clear();
    }
  };

  return {
    getConsent: snapshot,
    setConsent: (decision) => {
      if (typeof decision.functional === 'boolean') state.functional = decision.functional;
      if (typeof decision.analytics === 'boolean') state.analytics = decision.analytics;
      emit();
      return snapshot();
    },
    onConsentChange: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    requireConsent: (value) => {
      required = value;
    },
    isCaptureAllowed: captureAllowed,
    whenCaptureAllowed: () => {
      if (captureAllowed()) return Promise.resolve();
      return new Promise<void>((resolve) => {
        waiters.add(resolve);
      });
    },
  };
}

/** Shared consent store used by the widget bootstrap and the global API. */
export const consentStore: ConsentStore = createConsentStore();

/**
 * The public surface exposed to host pages as `window.AfixtLiveChat`.
 */
export interface AfixtLiveChatGlobal {
  /** Grant/deny consent categories from the host CMP. */
  setConsent: (decision: ConsentDecision) => ConsentState;
  /** Read the current consent decision. */
  getConsent: () => ConsentState;
  /** Subscribe to consent changes. */
  onConsentChange: (listener: ConsentListener) => () => void;
}

/**
 * Install (or extend) the `window.AfixtLiveChat` global so a host page's CMP
 * can grant/deny consent before the widget captures anything. Idempotent — it
 * merges onto any existing global rather than replacing it.
 * @param store - Store to back the API. Defaults to the shared singleton.
 * @returns The installed global object.
 */
export function installConsentApi(store: ConsentStore = consentStore): AfixtLiveChatGlobal {
  const api: AfixtLiveChatGlobal = {
    setConsent: (decision) => store.setConsent(decision),
    getConsent: () => store.getConsent(),
    onConsentChange: (listener) => store.onConsentChange(listener),
  };
  const holder = globalThis as typeof globalThis & {
    // eslint-disable-next-line @typescript-eslint/naming-convention -- global brand namespace on the host window
    AfixtLiveChat?: AfixtLiveChatGlobal;
  };
  holder.AfixtLiveChat = { ...holder.AfixtLiveChat, ...api };
  return holder.AfixtLiveChat;
}
