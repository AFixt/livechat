import { Chat, ChatMessage, VisitorSession } from '../models/index.js';
import { ApiError } from '../utils/api-error.js';

import type { ChatStatus, MessageSenderKind } from '@livechat/shared';

const ERR_CHAT_NOT_FOUND = 'Chat not found';

interface VisitorInitiateParams {
  visitorSession: VisitorSession;
  customerName: string;
  body: string;
  customerEmail?: string;
}

interface SupportInitiateParams {
  tenantId: string;
  visitorSessionId: string;
  supportUserId: string;
}

interface SendMessageParams {
  chatId: string;
  senderKind: MessageSenderKind;
  senderUserId?: string;
  body: string;
}

interface EndChatParams {
  chatId: string;
  endedBy: 'customer' | 'support';
}

/**
 * Build the chat service.
 * @returns Chat methods (create visitor/support-initiated chats, send
 *   messages, end chats, list, get by id).
 */
export function createChatService() {
  return {
    /**
     * Create a new chat from the customer side (widget initiate).
     * @param params - Init params.
     * @returns The new Chat plus its first ChatMessage.
     */
    async initiateByVisitor(
      params: VisitorInitiateParams,
    ): Promise<{ chat: Chat; message: ChatMessage }> {
      const now = new Date();
      const chat = await Chat.create({
        tenantId: params.visitorSession.tenantId,
        visitorSessionId: params.visitorSession.id,
        assignedTo: null,
        initiatedBy: 'customer',
        status: 'pending',
        customerName: params.customerName,
        customerEmail: params.customerEmail ?? null,
        startedAt: now,
        endedAt: null,
      });
      const message = await ChatMessage.create({
        chatId: chat.id,
        senderKind: 'visitor',
        senderUserId: null,
        body: params.body,
        deliveredAt: now,
        readAt: null,
      });
      return { chat, message };
    },

    /**
     * Create a new chat from the support side (§5.1.5).
     * @param params - Support-init params.
     * @returns The newly-created Chat.
     */
    async initiateBySupport(params: SupportInitiateParams): Promise<Chat> {
      const visitor = await VisitorSession.findByPk(params.visitorSessionId);
      if (visitor === null) throw ApiError.badRequest('Visitor not found');
      if (visitor.tenantId !== params.tenantId) {
        throw ApiError.forbidden('Visitor belongs to a different tenant');
      }
      return Chat.create({
        tenantId: params.tenantId,
        visitorSessionId: visitor.id,
        assignedTo: params.supportUserId,
        initiatedBy: 'support',
        status: 'pending',
        customerName: null,
        customerEmail: null,
        startedAt: new Date(),
        endedAt: null,
      });
    },

    /**
     * Append a message to an active chat. Also activates a pending chat when
     * the first reply arrives.
     * @param params - Send-message params.
     * @returns The new message.
     */
    async sendMessage(params: SendMessageParams): Promise<ChatMessage> {
      const chat = await Chat.findByPk(params.chatId);
      if (chat === null) throw ApiError.notFound(ERR_CHAT_NOT_FOUND);
      if (chat.endedAt !== null) throw ApiError.badRequest('Chat has ended');

      const now = new Date();
      const message = await ChatMessage.create({
        chatId: chat.id,
        senderKind: params.senderKind,
        senderUserId: params.senderUserId ?? null,
        body: params.body,
        deliveredAt: now,
        readAt: null,
      });

      if (chat.status === 'pending') {
        chat.status = 'active';
        if (params.senderKind === 'user' && chat.assignedTo === null && params.senderUserId) {
          chat.assignedTo = params.senderUserId;
        }
        await chat.save();
      }
      return message;
    },

    /**
     * End a chat. Sets status + ended_at.
     * @param params - End-chat params.
     * @returns The updated chat.
     */
    async endChat(params: EndChatParams): Promise<Chat> {
      const chat = await Chat.findByPk(params.chatId);
      if (chat === null) throw ApiError.notFound(ERR_CHAT_NOT_FOUND);
      if (chat.endedAt !== null) return chat;
      const nextStatus: ChatStatus =
        params.endedBy === 'customer' ? 'ended_by_customer' : 'ended_by_support';
      chat.status = nextStatus;
      chat.endedAt = new Date();
      await chat.save();
      return chat;
    },

    /**
     * Assign a chat to a support user (accept).
     * @param chatId - Chat id.
     * @param userId - Support user id.
     * @returns The updated chat.
     */
    async assign(chatId: string, userId: string): Promise<Chat> {
      const chat = await Chat.findByPk(chatId);
      if (chat === null) throw ApiError.notFound(ERR_CHAT_NOT_FOUND);
      chat.assignedTo = userId;
      if (chat.status === 'pending') chat.status = 'active';
      await chat.save();
      return chat;
    },

    /**
     * Load the message history for a chat, ordered by delivered_at.
     * @param chatId - Chat id.
     * @returns Messages in chronological order.
     */
    async listMessages(chatId: string): Promise<ChatMessage[]> {
      return ChatMessage.findAll({
        where: { chatId },
        order: [['deliveredAt', 'ASC']],
      });
    },

    /**
     * List chats, optionally scoped by tenant and status.
     * @param filter - Optional tenant and status filter.
     * @returns Matching chats (most recent first).
     */
    async list(filter?: { tenantId?: string; status?: ChatStatus }): Promise<Chat[]> {
      const where: Record<string, unknown> = {};
      if (filter?.tenantId !== undefined) where.tenantId = filter.tenantId;
      if (filter?.status !== undefined) where.status = filter.status;
      return Chat.findAll({ where, order: [['createdAt', 'DESC']] });
    },

    /**
     * Fetch a chat by id.
     * @param id - Chat id.
     * @returns The chat.
     */
    async getById(id: string): Promise<Chat> {
      const chat = await Chat.findByPk(id);
      if (chat === null) throw ApiError.notFound(ERR_CHAT_NOT_FOUND);
      return chat;
    },

    /**
     * Find a returning visitor's most recent resumable chat — a
     * customer-initiated conversation that has not ended. Drives the widget's
     * "welcome back, continue?" (restart) state on bootstrap.
     * @param visitorSessionId - Visitor session id (from the signed cookie).
     * @returns The resumable chat, or null if none.
     */
    async findResumableByVisitorSession(visitorSessionId: string): Promise<Chat | null> {
      return Chat.findOne({
        where: {
          visitorSessionId,
          initiatedBy: 'customer',
          status: ['pending', 'active', 'waiting'],
        },
        order: [['createdAt', 'DESC']],
      });
    },
  };
}

/**
 * Shape of the chat service.
 */
export type ChatService = ReturnType<typeof createChatService>;
