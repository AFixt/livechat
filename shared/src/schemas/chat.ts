import { z } from 'zod';

/**
 * Chat status covering the eight visitor-widget states (requirements.md §5.1).
 */
export const chatStatusSchema = z.enum([
  'pending',
  'active',
  'waiting',
  'ended_by_customer',
  'ended_by_support',
  'abandoned',
]);
/**
 * Chat status value.
 */
export type ChatStatus = z.infer<typeof chatStatusSchema>;

/**
 * Who initiated the chat.
 */
export const chatInitiatedBySchema = z.enum(['customer', 'support']);
/**
 * Who-initiated value.
 */
export type ChatInitiatedBy = z.infer<typeof chatInitiatedBySchema>;

/**
 * Sender kind for a single chat message.
 */
export const messageSenderKindSchema = z.enum(['visitor', 'user', 'system']);
/**
 * Message sender kind value.
 */
export type MessageSenderKind = z.infer<typeof messageSenderKindSchema>;

/**
 * Public, safe representation of a chat.
 */
export const chatSafeSchema = z.object({
  id: z.uuid(),
  inc: z.number().int().positive(),
  tenantId: z.uuid(),
  visitorSessionId: z.uuid(),
  assignedTo: z.uuid().nullable(),
  initiatedBy: chatInitiatedBySchema,
  status: chatStatusSchema,
  customerName: z.string().max(200).nullable(),
  customerEmail: z.string().max(255).nullable(),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
/**
 * Safe chat object.
 */
export type ChatSafe = z.infer<typeof chatSafeSchema>;

/**
 * Safe representation of a single chat message.
 */
export const chatMessageSafeSchema = z.object({
  id: z.uuid(),
  chatId: z.uuid(),
  senderKind: messageSenderKindSchema,
  senderUserId: z.uuid().nullable(),
  body: z.string(),
  deliveredAt: z.iso.datetime(),
  readAt: z.iso.datetime().nullable(),
});
/**
 * Safe chat-message object.
 */
export type ChatMessageSafe = z.infer<typeof chatMessageSafeSchema>;

/**
 * Input for a visitor initiating a chat from the widget (§5.1.3).
 */
export const visitorInitiateChatInputSchema = z.object({
  customerName: z.string().min(1).max(200),
  body: z.string().min(1).max(10_000),
  customerEmail: z.email().optional(),
});
/**
 * Input for visitor-initiated chat creation.
 */
export type VisitorInitiateChatInput = z.infer<typeof visitorInitiateChatInputSchema>;

/**
 * Input for sending a message on an existing chat (either side).
 */
export const sendMessageInputSchema = z.object({
  body: z.string().min(1).max(10_000),
});
/**
 * Input for send-message.
 */
export type SendMessageInput = z.infer<typeof sendMessageInputSchema>;

/**
 * Input for ending a chat (§5.1.7).
 */
export const endChatInputSchema = z.object({
  endedBy: z.enum(['customer', 'support']),
});
/**
 * Input for end-chat.
 */
export type EndChatInput = z.infer<typeof endChatInputSchema>;

/**
 * Input for requesting an email transcript (§5.1.7).
 */
export const emailTranscriptInputSchema = z.object({
  email: z.email(),
});
/**
 * Input for email-transcript.
 */
export type EmailTranscriptInput = z.infer<typeof emailTranscriptInputSchema>;
