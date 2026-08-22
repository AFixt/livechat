import { useEffect, useReducer, useRef, useState } from 'preact/hooks';

import { LiveRegion } from './components/live-region.js';
import { ReconnectBanner } from './components/reconnect-banner.js';
import { useChatConnection } from './hooks/use-chat-connection.js';
import { useDelayedFlag } from './hooks/use-delayed-flag.js';
import { useFocusReturn } from './hooks/use-focus-return.js';
import {
  fetchCurrentChat,
  fetchWidgetConfig,
  initiateChat,
  initVisitorSession,
} from './services/api.js';
import { playAlert } from './services/audio.js';
import { consentStore } from './services/consent.js';
import { announceLiveMessage } from './services/live-region.js';
import { disconnectVisitorSocket, getVisitorSocket } from './services/socket.js';
import { initialModel, reduce } from './state-machine.js';
import { ActiveState } from './states/active.js';
import { CustomerInitiatedState } from './states/customer-initiated.js';
import { EndedState } from './states/ended.js';
import { InitialState } from './states/initial.js';
import { InvitationState } from './states/invitation.js';
import { NoSupportState } from './states/no-support.js';
import { RestartState } from './states/restart.js';
import { SupportInitiatedState } from './states/support-initiated.js';

interface AppProps {
  tenantKey: string;
}

/**
 * How long support must stay available before the proactive invitation
 * surfaces. §5.1.2 calls for the CTA "after a short period" — the widget shows
 * its plain trigger first and only escalates to the invitation once support has
 * been online continuously for this long.
 */
const INVITATION_DELAY_MS = 5000;

/**
 * Optional support-hours props for the no-support state. Returns an empty
 * object when unset so it is safe to spread under `exactOptionalPropertyTypes`.
 * @param text - Configured support-hours display text, or undefined.
 * @returns Props to spread onto `<NoSupportState>`.
 */
function noSupportProps(text: string | undefined): { supportHoursText?: string } {
  return text === undefined ? {} : { supportHoursText: text };
}

/**
 * Root widget component — owns the state machine and wires REST + socket
 * events into dispatched actions.
 * @param props - Widget configuration from the custom element attributes.
 * @returns The widget element tree (rendered inside Shadow DOM).
 */
export function App(props: AppProps): preact.JSX.Element {
  const [model, dispatch] = useReducer(reduce, initialModel());
  // Transient connection state — surfaced as an aria-live banner while the
  // socket is reconnecting (issue #69). Kept out of the state machine so it
  // never perturbs the documented widget states.
  const [reconnecting, setReconnecting] = useState(false);
  const [supportHoursText, setSupportHoursText] = useState<string | undefined>(undefined);
  // §5.1.2: the invitation appears "after a short period", not the instant
  // support comes online. `supportAvailable` still drives the offline/online
  // logic everywhere else; only the proactive flourish waits out this delay.
  const showInvitation = useDelayedFlag(model.supportAvailable, INVITATION_DELAY_MS);
  useFocusReturn(model.open);
  const panelHeaderRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!model.open || panelHeaderRef.current === null) return;
    panelHeaderRef.current.focus();
  }, [model.open]);

  useEffect(() => {
    // Object property (not a local) so its value survives the async closure
    // for the cleanup to flip. Read through `isLive()` so control-flow
    // narrowing does not make a later re-check look statically unreachable.
    const live = { current: true };
    const isLive = (): boolean => live.current;
    // `getVisitorSocket()` *lazily connects*, so calling it is not free: for a
    // gated visitor it would open the very presence socket the gate exists to
    // keep closed. Track whether we actually attached, so the cleanup below
    // only touches a socket that already exists.
    const presenceAttached = { current: false };
    const onSupportInitiated = (p: { chatId: string }): void => {
      dispatch({ type: 'support_initiated', chatId: p.chatId });
      announceLiveMessage('A support agent wants to chat');
      playAlert();
    };
    // The /visitor namespace bridges staff availability to the widget, making
    // the proactive invitation (§5.1.2) and no-support (§5.1.4) states
    // reachable. Both true and false are dispatched.
    const onAvailabilityChanged = (p: { available: boolean }): void => {
      dispatch({ type: 'support_available', available: p.available });
      if (p.available) announceLiveMessage('Support is now online');
    };
    // Public tenant config — support-hours text plus the current availability
    // flag, so the invitation/no-support states are correct on first paint
    // before any live socket event arrives. Best-effort: the widget still
    // works if this fails.
    const loadInitialConfig = async (): Promise<void> => {
      try {
        const config = await fetchWidgetConfig(props.tenantKey);
        if (!isLive()) return;
        setSupportHoursText(config.supportHoursText ?? undefined);
        dispatch({ type: 'support_available', available: config.supportAvailable });
      } catch {
        // ignore — config is optional
      }
    };
    void (async () => {
      // CMP consent gate (#54): hold presence/analytics capture until the host
      // CMP grants it; resolves immediately when consent isn't required.
      await consentStore.whenCaptureAllowed();
      // `loadInitialConfig` self-guards on `live.current` after its fetch, and
      // the resume/socket path below is guarded too, so an unmount during the
      // consent wait is handled without an extra early return here.
      await loadInitialConfig();
      // Server-side consent gate (#53). This resolves the visitor's
      // jurisdiction, applies the rules, and only creates a tracked session
      // (returning its id) when ambient presence tracking is permitted. Since
      // #55 the decision is applied first, so a suppressed visitor gets
      // `sessionId: null` even when a row already exists — the id is a
      // statement about *ambient tracking*, not about whether this visitor has
      // a chat.
      let gate: Awaited<ReturnType<typeof initVisitorSession>>;
      try {
        gate = await initVisitorSession(props.tenantKey);
      } catch {
        if (isLive()) dispatch({ type: 'error', message: 'Unable to start a session.' });
        return;
      }
      if (!isLive()) return;
      // Probe for a resumable chat regardless of the tracking decision.
      // Resuming a conversation the visitor themselves started is the same
      // first-party, strictly-necessary interaction as starting one (#53), so
      // gating it would strand a chat the gate expressly allowed them to open —
      // and with no geo hint every visitor resolves to UNKNOWN, so that would
      // be every visitor. This only *reads* an existing row; it starts no
      // tracking. A 401 simply means there is no session to resume.
      let resume: Awaited<ReturnType<typeof fetchCurrentChat>> | null = null;
      try {
        resume = await fetchCurrentChat();
      } catch {
        // No resumable chat, or a transient error — nothing to restore.
      }
      if (!isLive()) return;
      // Ambient presence tracking, on the other hand, is exactly what the gate
      // suppresses: open the presence socket only when it permitted tracking.
      // Everything below this point is the ambient path.
      if (gate.sessionId !== null) {
        presenceAttached.current = true;
        getVisitorSocket().on('support:initiated', onSupportInitiated);
        getVisitorSocket().on('support:availability_changed', onAvailabilityChanged);
      }
      // Returning visitor with an unfinished chat? Offer to resume it.
      if (resume !== null && resume.chat !== null) {
        dispatch({
          type: 'restart',
          chatId: resume.chat.id,
          customerName: resume.chat.customerName ?? '',
          messages: resume.messages,
        });
      }
    })();
    return () => {
      live.current = false;
      // Only if we attached: an unconditional `getVisitorSocket()` here would
      // *create and connect* a socket purely to detach listeners from it,
      // opening a presence connection for a visitor the gate kept untracked.
      if (!presenceAttached.current) return;
      getVisitorSocket().off('support:initiated', onSupportInitiated);
      getVisitorSocket().off('support:availability_changed', onAvailabilityChanged);
    };
  }, [props.tenantKey]);

  // Owns the active chat's socket subscription, including reconnect re-join +
  // transcript backfill (issue #69). Extracted so its branching stays out of
  // this component's complexity budget.
  useChatConnection(model.chatId, dispatch, setReconnecting);

  useEffect(
    () => () => {
      disconnectVisitorSocket();
    },
    [],
  );

  const handleCustomerInit = async (name: string, body: string): Promise<void> => {
    try {
      const { chat, message, supportAvailable } = await initiateChat(name, body);
      if (!supportAvailable) {
        dispatch({ type: 'chat_created_no_support', customerName: name });
        return;
      }
      dispatch({
        type: 'chat_created',
        chatId: chat.id,
        customerName: name,
        firstMessage: {
          id: message.id,
          body: message.body,
          senderKind: 'visitor',
          deliveredAt: message.deliveredAt,
        },
      });
    } catch (err) {
      dispatch({
        type: 'error',
        message: err instanceof Error ? err.message : 'Unable to start chat',
      });
    }
  };

  const handleSend = (body: string): void => {
    if (model.chatId === null) return;
    const socket = getVisitorSocket();
    socket.emit('chat:message', { chatId: model.chatId, body });
    dispatch({
      type: 'message_sent',
      message: {
        id: `local-${Date.now().toString()}`,
        body,
        senderKind: 'visitor',
        deliveredAt: new Date().toISOString(),
      },
    });
  };

  const handleEnd = (): void => {
    if (model.chatId === null) return;
    const socket = getVisitorSocket();
    socket.emit('chat:end', { chatId: model.chatId });
    dispatch({ type: 'chat_ended_by_customer' });
  };

  return (
    <>
      <LiveRegion />
      {model.open ? (
        <section class="panel" aria-labelledby="afixt-panel-title">
          <header class="panel-header">
            <h2 id="afixt-panel-title" tabIndex={-1} ref={panelHeaderRef}>
              Chat with support
            </h2>
            <button
              type="button"
              onClick={() => {
                dispatch({ type: 'close' });
              }}
              aria-label="Close chat widget"
            >
              ×
            </button>
          </header>
          <ReconnectBanner active={reconnecting} />
          <div class="panel-body">
            {model.state === 'initial' && (
              <CustomerInitiatedState
                onSubmit={handleCustomerInit}
                errorMessage={model.errorMessage}
              />
            )}
            {model.state === 'customer_initiated' && (
              <CustomerInitiatedState
                onSubmit={handleCustomerInit}
                errorMessage={model.errorMessage}
              />
            )}
            {model.state === 'no_support' && (
              <NoSupportState
                onSubmit={() => Promise.resolve()}
                {...noSupportProps(supportHoursText)}
              />
            )}
            {model.state === 'support_initiated' && (
              <SupportInitiatedState
                onAccept={() => {
                  dispatch({ type: 'support_accepted' });
                }}
                onDismiss={() => {
                  dispatch({ type: 'close' });
                }}
              />
            )}
            {model.state === 'active' && (
              <ActiveState messages={model.messages} onSend={handleSend} onEnd={handleEnd} />
            )}
            {model.state === 'ended' && (
              <EndedState
                onEmailTranscript={() => Promise.resolve()}
                onDone={() => {
                  dispatch({ type: 'close' });
                }}
              />
            )}
            {model.state === 'restart' && (
              <RestartState
                onRestart={() => {
                  dispatch({ type: 'restart_resumed' });
                }}
              />
            )}
          </div>
        </section>
      ) : showInvitation ? (
        <InvitationState
          onOpen={() => {
            dispatch({ type: 'open' });
          }}
          onDismiss={() => {
            dispatch({ type: 'support_available', available: false });
          }}
        />
      ) : (
        <InitialState
          onOpen={() => {
            dispatch({ type: 'open' });
          }}
        />
      )}
    </>
  );
}
