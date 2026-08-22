import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { type Socket } from 'socket.io-client';

import { playAlertSound } from '../services/alert-sound.js';
import { listChatMessages } from '../services/chats-api.js';
import { incrementBadge } from '../services/favicon-badge.js';
import { announceLiveMessage } from '../services/live-region-bus.js';
import { getStaffSocket } from '../services/socket.js';
import { useChatsStore, type ChatMessage } from '../store/chats.js';
import { useConnectionStore } from '../store/connection.js';

interface MessageEvent {
  chatId: string;
  messageId: string;
  senderKind: 'visitor' | 'user' | 'system';
  senderUserId: string | null;
  body: string;
  deliveredAt: string;
}

interface VisitorEvent {
  tenantId: string;
  visitorSessionId: string;
}

interface ChatRequestedEvent {
  chatId: string;
  tenantId: string;
  customerName: string | null;
  status: string;
}

/**
 * Re-enter every open chat room on a (re)connect and, when this is an actual
 * reconnect, backfill each transcript. A reconnected socket is a brand-new
 * connection in no rooms, so any `chat:message` delivered to an open chat while
 * the console was disconnected never reached it — re-fetch each open chat's
 * transcript and merge it by id so those messages appear without duplicating
 * ones already shown (issue #69, AC5). On the very first connect there is
 * nothing to backfill (the inbox already loaded transcripts), so only re-join.
 * @param socket - The staff socket.
 * @param backfill - Whether this is a reconnect (true) or the first connect.
 * @param merge - The chats store's transcript-merge action.
 */
function rejoinOpenChats(
  socket: Socket,
  backfill: boolean,
  merge: (chatId: string, messages: ChatMessage[]) => void,
): void {
  const { chats } = useChatsStore.getState();
  for (const c of Object.values(chats)) {
    if (c.status.startsWith('ended_')) continue;
    socket.emit('chat:join', { chatId: c.id });
    if (!backfill) continue;
    void listChatMessages(c.id)
      .then((messages) => {
        merge(c.id, messages);
      })
      .catch(() => undefined);
  }
}

/**
 * Subscribe to the staff Socket.IO namespace for the lifetime of the
 * dashboard. Pipes visitor/chat events into the Zustand store and fires
 * alerts (programmatic + visible + audible) on inbound visitor messages.
 * Also surfaces connection state: a drop flips the reconnect banner to
 * "reconnecting" and the restore re-joins rooms, backfills transcripts, and
 * flips the banner to "reconnected" (issue #69).
 */
export function useStaffSocket(): void {
  const { t } = useTranslation();
  const upsertVisitor = useChatsStore((s) => s.upsertVisitor);
  const removeVisitor = useChatsStore((s) => s.removeVisitor);
  const upsertChat = useChatsStore((s) => s.upsertChat);
  const appendMessage = useChatsStore((s) => s.appendMessage);
  const setTyping = useChatsStore((s) => s.setTyping);
  const mergeMessages = useChatsStore((s) => s.mergeMessages);
  const markEnded = useChatsStore((s) => s.markEnded);
  const setConnectionStatus = useConnectionStore((s) => s.setStatus);

  useEffect(() => {
    const socket = getStaffSocket();

    const onVisitorJoined = (v: VisitorEvent): void => {
      upsertVisitor({
        visitorSessionId: v.visitorSessionId,
        tenantId: v.tenantId,
        currentUrl: null,
      });
    };
    const onVisitorLeft = (v: VisitorEvent): void => {
      removeVisitor(v.visitorSessionId);
    };
    const onChatRequested = (c: ChatRequestedEvent): void => {
      upsertChat({
        id: c.chatId,
        customerName: c.customerName,
        status: c.status as 'pending' | 'active' | 'ended_by_customer' | 'ended_by_support',
        messages: [],
      });
    };
    const onMessage = (msg: MessageEvent): void => {
      appendMessage(msg.chatId, {
        id: msg.messageId,
        body: msg.body,
        senderKind: msg.senderKind,
        deliveredAt: msg.deliveredAt,
      });
      if (msg.senderKind === 'visitor') {
        announceLiveMessage(t('alerts.newMessage', { name: 'visitor' }));
        playAlertSound();
        if (document.hidden) incrementBadge();
      }
    };
    const onEnded = (p: { chatId: string; endedBy: 'customer' | 'support' }): void => {
      markEnded(p.chatId, p.endedBy);
      setTyping(p.chatId, false);
    };
    const onTyping = (p: {
      chatId: string;
      actor: 'visitor' | 'user';
      isTyping: boolean;
    }): void => {
      // Only the visitor's typing is shown in the console; the operator's own
      // echo is ignored (#80).
      if (p.actor !== 'visitor') return;
      setTyping(p.chatId, p.isTyping);
    };
    // A reconnected socket is a fresh connection in no chat rooms, so messages
    // stop arriving until we re-enter them — and any delivered mid-outage were
    // missed. On every (re)connect, re-join every live chat and, on an actual
    // reconnect, backfill the transcripts + flip the banner to "reconnected"
    // (issue #69). The banner element carries the announcement (§3), so this
    // must not also push it through the global live region — that double-speaks.
    let connectedBefore = false;
    const onConnect = (): void => {
      rejoinOpenChats(socket, connectedBefore, mergeMessages);
      if (connectedBefore) setConnectionStatus('reconnected');
      connectedBefore = true;
    };
    const onDisconnect = (): void => {
      setConnectionStatus('reconnecting');
    };

    socket.on('visitor:joined', onVisitorJoined);
    socket.on('visitor:left', onVisitorLeft);
    socket.on('chat:requested', onChatRequested);
    socket.on('chat:message', onMessage);
    socket.on('chat:ended', onEnded);
    socket.on('chat:typing', onTyping);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    return () => {
      socket.off('visitor:joined', onVisitorJoined);
      socket.off('visitor:left', onVisitorLeft);
      socket.off('chat:requested', onChatRequested);
      socket.off('chat:message', onMessage);
      socket.off('chat:ended', onEnded);
      socket.off('chat:typing', onTyping);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, [
    appendMessage,
    markEnded,
    mergeMessages,
    removeVisitor,
    setConnectionStatus,
    setTyping,
    t,
    upsertChat,
    upsertVisitor,
  ]);
}
