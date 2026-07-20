import { useCallback, useEffect } from 'react';

import { listChatMessages, listChats } from '../services/chats-api.js';
import { clearBadge } from '../services/favicon-badge.js';
import { getStaffSocket } from '../services/socket.js';
import { useChatsStore } from '../store/chats.js';

interface ChatInbox {
  /** Accept a chat, focus it, and load its transcript. */
  selectChat: (chatId: string) => void;
}

/**
 * Loads the operator's already-open chats on mount and returns a
 * {@link ChatInbox.selectChat} that accepts a chat (assigning it and joining
 * its socket room), focuses it, and loads its full transcript — so history,
 * including the first message created at initiation, is shown. Live updates
 * continue to arrive via {@link useStaffSocket}.
 * @returns The chat inbox controls.
 */
export function useChatInbox(): ChatInbox {
  const upsertChat = useChatsStore((s) => s.upsertChat);
  const setActiveChat = useChatsStore((s) => s.setActiveChat);

  useEffect(() => {
    let cancelled = false;
    void listChats().then((chats) => {
      if (cancelled) return;
      for (const chat of chats) {
        upsertChat({ id: chat.id, customerName: chat.customerName, status: chat.status });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [upsertChat]);

  const selectChat = useCallback(
    (chatId: string): void => {
      getStaffSocket().emit('chat:accept', { chatId });
      setActiveChat(chatId);
      clearBadge();
      void listChatMessages(chatId).then((messages) => {
        upsertChat({ id: chatId, messages });
      });
    },
    [setActiveChat, upsertChat],
  );

  return { selectChat };
}
