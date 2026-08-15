import { useEffect, useReducer, useRef } from 'preact/hooks';

import { LiveRegion } from './components/live-region.js';
import { useFocusReturn } from './hooks/use-focus-return.js';
import { fetchCurrentChat, initiateChat, initVisitorSession } from './services/api.js';
import { playAlert } from './services/audio.js';
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

import type { WidgetMessage } from './types.js';

interface AppProps {
  tenantKey: string;
}

interface SocketMessageEvent {
  chatId: string;
  messageId: string;
  senderKind: 'visitor' | 'user' | 'system';
  body: string;
  deliveredAt: string;
}

/**
 * Root widget component — owns the state machine and wires REST + socket
 * events into dispatched actions.
 * @param props - Widget configuration from the custom element attributes.
 * @returns The widget element tree (rendered inside Shadow DOM).
 */
export function App(props: AppProps): preact.JSX.Element {
  const [model, dispatch] = useReducer(reduce, initialModel());
  useFocusReturn(model.open);
  const panelHeaderRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!model.open || panelHeaderRef.current === null) return;
    panelHeaderRef.current.focus();
  }, [model.open]);

  useEffect(() => {
    // Object property (not a local) so its value survives the async closure
    // for the cleanup to flip. Read via `isLive()` so control-flow narrowing
    // doesn't make a later re-check look statically unreachable.
    const live = { current: true };
    const isLive = (): boolean => live.current;
    const onSupportInitiated = (p: { chatId: string }): void => {
      dispatch({ type: 'support_initiated', chatId: p.chatId });
      announceLiveMessage('A support agent wants to chat');
      playAlert();
    };
    void (async () => {
      // Run the consent gate first. This resolves the visitor's jurisdiction,
      // applies the rules, and only creates a tracked session (and returns its
      // id) when ambient presence tracking is permitted. It is idempotent: a
      // returning tracked visitor gets their existing session id back.
      let result: Awaited<ReturnType<typeof initVisitorSession>>;
      try {
        result = await initVisitorSession(props.tenantKey);
      } catch {
        if (isLive()) dispatch({ type: 'error', message: 'Unable to start a session.' });
        return;
      }
      if (!isLive()) return;
      // No tracked session means the consent gate suppressed ambient tracking
      // (e.g. opt-in / unknown jurisdiction pre-consent). The widget still
      // renders and can start a chat as a first-party interaction, but the
      // presence socket stays closed and no resumable chat is probed.
      if (result.sessionId === null) return;
      // A tracked session exists — connect the socket so this visitor shows up
      // in the console's presence list and can receive proactive support events.
      getVisitorSocket().on('support:initiated', onSupportInitiated);
      // Returning visitor with an unfinished chat? Offer to resume it.
      try {
        const resume = await fetchCurrentChat();
        if (!isLive()) return;
        if (resume.chat !== null) {
          dispatch({
            type: 'restart',
            chatId: resume.chat.id,
            customerName: resume.chat.customerName ?? '',
            messages: resume.messages,
          });
        }
      } catch {
        // No resumable chat / transient error — nothing to restore.
      }
    })();
    return () => {
      live.current = false;
      getVisitorSocket().off('support:initiated', onSupportInitiated);
    };
  }, [props.tenantKey]);

  useEffect(() => {
    if (model.chatId === null) return;
    const socket = getVisitorSocket();
    socket.emit('chat:join', { chatId: model.chatId });
    const onMessage = (msg: SocketMessageEvent): void => {
      if (msg.chatId !== model.chatId || msg.senderKind === 'visitor') return;
      const message: WidgetMessage = {
        id: msg.messageId,
        body: msg.body,
        senderKind: msg.senderKind,
        deliveredAt: msg.deliveredAt,
      };
      dispatch({ type: 'message_received', message });
      announceLiveMessage('New message from support');
      playAlert();
    };
    const onEnded = (p: { chatId: string; endedBy: 'customer' | 'support' }): void => {
      if (p.chatId !== model.chatId) return;
      dispatch({
        type: p.endedBy === 'support' ? 'chat_ended_by_support' : 'chat_ended_by_customer',
      });
    };
    socket.on('chat:message', onMessage);
    socket.on('chat:ended', onEnded);
    return () => {
      socket.off('chat:message', onMessage);
      socket.off('chat:ended', onEnded);
    };
  }, [model.chatId]);

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
                supportHoursText="Mon–Fri, 9am–5pm"
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
      ) : model.supportAvailable ? (
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
