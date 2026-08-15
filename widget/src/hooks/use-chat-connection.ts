import { useEffect } from 'preact/hooks';

import { fetchCurrentChat } from '../services/api.js';
import { playAlert } from '../services/audio.js';
import { announceLiveMessage } from '../services/live-region.js';
import { getVisitorSocket } from '../services/socket.js';

import type { WidgetAction } from '../state-machine.js';
import type { WidgetMessage } from '../types.js';

/** A `chat:message` socket payload. */
interface SocketMessageEvent {
  chatId: string;
  messageId: string;
  senderKind: 'visitor' | 'user' | 'system';
  body: string;
  deliveredAt: string;
}

/**
 * Backfill the transcript after a reconnect: the server list is authoritative,
 * and `messages_synced` reconciles it against any optimistic local sends.
 * @param chatId - The chat to reconcile.
 * @param dispatch - The widget reducer dispatch.
 */
async function syncTranscript(chatId: string, dispatch: (action: WidgetAction) => void): Promise<void> {
  try {
    const current = await fetchCurrentChat();
    if (current.chat !== null && current.chat.id === chatId) {
      dispatch({ type: 'messages_synced', messages: current.messages });
    }
  } catch {
    // Transient; the next live message re-syncs the transcript.
  }
}

/**
 * Own the visitor socket subscription for the active chat: join the room,
 * stream inbound messages/ends, and — critically — re-join and backfill on
 * every reconnect so the chat is not silently dead after a socket drop (#69).
 * Kept out of the root component so its branching does not inflate that
 * component's complexity.
 * @param chatId - The active chat id, or null when there is no chat.
 * @param dispatch - The widget reducer dispatch.
 * @param setReconnecting - Setter for the reconnecting banner flag.
 */
export function useChatConnection(
  chatId: string | null,
  dispatch: (action: WidgetAction) => void,
  setReconnecting: (value: boolean) => void,
): void {
  useEffect(() => {
    if (chatId === null) return;
    const socket = getVisitorSocket();
    // Whether we have dropped since joining, so the first connect (initial
    // join) does not trigger a redundant backfill.
    let droppedSinceJoin = false;
    socket.emit('chat:join', { chatId });

    const onMessage = (msg: SocketMessageEvent): void => {
      if (msg.chatId !== chatId || msg.senderKind === 'visitor') return;
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
      if (p.chatId !== chatId) return;
      dispatch({
        type: p.endedBy === 'support' ? 'chat_ended_by_support' : 'chat_ended_by_customer',
      });
    };
    const onDisconnect = (): void => {
      droppedSinceJoin = true;
      setReconnecting(true);
      announceLiveMessage('Connection lost. Reconnecting…');
    };
    const onConnect = (): void => {
      // Room membership does not survive a new socket, so re-enter on every
      // (re)connect; backfill only when we had actually dropped.
      socket.emit('chat:join', { chatId });
      if (!droppedSinceJoin) return;
      droppedSinceJoin = false;
      setReconnecting(false);
      announceLiveMessage('Reconnected.');
      void syncTranscript(chatId, dispatch);
    };

    socket.on('chat:message', onMessage);
    socket.on('chat:ended', onEnded);
    socket.on('disconnect', onDisconnect);
    socket.on('connect', onConnect);
    return () => {
      socket.off('chat:message', onMessage);
      socket.off('chat:ended', onEnded);
      socket.off('disconnect', onDisconnect);
      socket.off('connect', onConnect);
    };
  }, [chatId, dispatch, setReconnecting]);
}
