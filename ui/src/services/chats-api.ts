import { getApi } from './api.js';

interface Envelope<T> {
  success: boolean;
  data: T;
  message?: string;
}

/** A chat as returned by the api, narrowed to what the console lists. */
export interface ChatDto {
  id: string;
  customerName: string | null;
  status: 'pending' | 'active' | 'ended_by_customer' | 'ended_by_support';
}

/** A message as returned by the api. */
export interface ChatMessageDto {
  id: string;
  body: string;
  senderKind: 'visitor' | 'user' | 'system';
  deliveredAt: string;
}

/**
 * List the chats visible to the current operator, so the dashboard shows
 * already-open chats on load (not only ones that arrive live afterwards).
 * @returns The visible chats.
 */
export async function listChats(): Promise<ChatDto[]> {
  const res = await getApi().get<Envelope<ChatDto[]>>('/chats');
  return res.data.data;
}

/**
 * Load a chat's full transcript, so selecting a chat shows history including
 * the first message (created over HTTP at initiation, before any socket
 * message was broadcast).
 * @param chatId - The chat to load.
 * @returns The chat's messages, oldest first.
 */
export async function listChatMessages(chatId: string): Promise<ChatMessageDto[]> {
  const res = await getApi().get<Envelope<ChatMessageDto[]>>(`/chats/${chatId}/messages`);
  return res.data.data;
}
