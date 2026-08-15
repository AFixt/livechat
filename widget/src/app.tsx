import { useEffect, useReducer, useRef, useState } from 'preact/hooks';

import { LiveRegion } from './components/live-region.js';
import { ReconnectBanner } from './components/reconnect-banner.js';
import { useChatConnection } from './hooks/use-chat-connection.js';
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

interface AppProps {
  tenantKey: string;
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
  useFocusReturn(model.open);
  const panelHeaderRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!model.open || panelHeaderRef.current === null) return;
    panelHeaderRef.current.focus();
  }, [model.open]);

  useEffect(() => {
    // Object property (not a local) so its value survives the async closure
    // for the cleanup to flip without tripping no-unnecessary-condition.
    const live = { current: true };
    const onSupportInitiated = (p: { chatId: string }): void => {
      dispatch({ type: 'support_initiated', chatId: p.chatId });
      announceLiveMessage('A support agent wants to chat');
      playAlert();
    };
    void (async () => {
      // Reuse an existing session when the visitor already has one — a page
      // reload must not mint a fresh session, which would orphan a prior chat
      // and break the returning-visitor (restart) flow. Probing the resumable
      // chat doubles as the "do I have a session?" check.
      let resume: Awaited<ReturnType<typeof fetchCurrentChat>> | null = null;
      try {
        resume = await fetchCurrentChat();
      } catch {
        // No existing session (401) or unreachable — start a fresh session.
        try {
          await initVisitorSession(props.tenantKey);
        } catch {
          if (live.current) dispatch({ type: 'error', message: 'Unable to start a session.' });
          return;
        }
      }
      if (!live.current) return;
      // A session now exists — connect the socket so this visitor shows up in
      // the console's presence list and can receive proactive support events.
      getVisitorSocket().on('support:initiated', onSupportInitiated);
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
      getVisitorSocket().off('support:initiated', onSupportInitiated);
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
