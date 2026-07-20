import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { playAlertSound } from '../services/alert-sound.js';
import { incrementBadge } from '../services/favicon-badge.js';
import { announceLiveMessage } from '../services/live-region-bus.js';
import { getStaffSocket } from '../services/socket.js';
import { useChatsStore } from '../store/chats.js';

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
 * Subscribe to the staff Socket.IO namespace for the lifetime of the
 * dashboard. Pipes visitor/chat events into the Zustand store and fires
 * alerts (programmatic + visible + audible) on inbound visitor messages.
 */
export function useStaffSocket(): void {
  const { t } = useTranslation();
  const upsertVisitor = useChatsStore((s) => s.upsertVisitor);
  const removeVisitor = useChatsStore((s) => s.removeVisitor);
  const upsertChat = useChatsStore((s) => s.upsertChat);
  const appendMessage = useChatsStore((s) => s.appendMessage);
  const markEnded = useChatsStore((s) => s.markEnded);

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
    };

    socket.on('visitor:joined', onVisitorJoined);
    socket.on('visitor:left', onVisitorLeft);
    socket.on('chat:requested', onChatRequested);
    socket.on('chat:message', onMessage);
    socket.on('chat:ended', onEnded);

    return () => {
      socket.off('visitor:joined', onVisitorJoined);
      socket.off('visitor:left', onVisitorLeft);
      socket.off('chat:requested', onChatRequested);
      socket.off('chat:message', onMessage);
      socket.off('chat:ended', onEnded);
    };
  }, [appendMessage, markEnded, removeVisitor, t, upsertChat, upsertVisitor]);
}
