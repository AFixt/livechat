import { create } from 'zustand';

interface ChatMessage {
  id: string;
  body: string;
  senderKind: 'visitor' | 'user' | 'system';
  deliveredAt: string;
}

interface ChatSummary {
  id: string;
  customerName: string | null;
  status: 'pending' | 'active' | 'ended_by_customer' | 'ended_by_support';
  messages: ChatMessage[];
}

interface Visitor {
  visitorSessionId: string;
  tenantId: string;
  currentUrl: string | null;
}

interface ChatsState {
  /** Live visitor presence map keyed by visitorSessionId. */
  visitors: Record<string, Visitor>;
  /** Chats the current user can see, keyed by chat id. */
  chats: Record<string, ChatSummary>;
  /** The chat id the operator is currently viewing. */
  activeChatId: string | null;
  /** Add or update a visitor. */
  upsertVisitor: (v: Visitor) => void;
  /** Remove a visitor. */
  removeVisitor: (visitorSessionId: string) => void;
  /** Add or update a chat summary. */
  upsertChat: (chat: ChatSummary) => void;
  /** Append a message to a chat. */
  appendMessage: (chatId: string, message: ChatMessage) => void;
  /** Mark a chat as ended. */
  markEnded: (chatId: string, endedBy: 'customer' | 'support') => void;
  /** Set which chat is in focus. */
  setActiveChat: (chatId: string | null) => void;
}

/**
 * Zustand store for live dashboard state — visitor presence + chats. This
 * is in-memory only (not persisted); socket reconnects repopulate.
 */
export const useChatsStore = create<ChatsState>()((set) => ({
  visitors: {},
  chats: {},
  activeChatId: null,
  upsertVisitor: (v) => {
    set((state) => ({ visitors: { ...state.visitors, [v.visitorSessionId]: v } }));
  },
  removeVisitor: (visitorSessionId) => {
    set((state) => {
      const next = Object.fromEntries(
        Object.entries(state.visitors).filter(([k]) => k !== visitorSessionId),
      );
      return { visitors: next };
    });
  },
  upsertChat: (chat) => {
    set((state) => ({
      chats: {
        ...state.chats,
        [chat.id]: { ...state.chats[chat.id], ...chat },
      },
    }));
  },
  appendMessage: (chatId, message) => {
    set((state) => {
      const existing = state.chats[chatId];
      if (existing === undefined) return state;
      if (existing.messages.some((m) => m.id === message.id)) return state;
      return {
        chats: {
          ...state.chats,
          [chatId]: { ...existing, messages: [...existing.messages, message] },
        },
      };
    });
  },
  markEnded: (chatId, endedBy) => {
    set((state) => {
      const existing = state.chats[chatId];
      if (existing === undefined) return state;
      return {
        chats: {
          ...state.chats,
          [chatId]: {
            ...existing,
            status: endedBy === 'customer' ? 'ended_by_customer' : 'ended_by_support',
          },
        },
      };
    });
  },
  setActiveChat: (chatId) => {
    set({ activeChatId: chatId });
  },
}));
