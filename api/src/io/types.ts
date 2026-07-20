/**
 * Payloads for server→client events. Both staff and visitor namespaces share
 * this vocabulary, though staff receives more events (visitor presence +
 * new-chat notifications).
 */
export interface ServerToClientEvents {
  /** A new visitor connected (tenant-scoped; staff-only). */
  'visitor:joined': (payload: { tenantId: string; visitorSessionId: string }) => void;
  /** A visitor navigated to a different URL. */
  'visitor:page_changed': (payload: { visitorSessionId: string; currentUrl: string }) => void;
  /** A visitor disconnected. */
  'visitor:left': (payload: { tenantId: string; visitorSessionId: string }) => void;
  /** A customer-initiated chat was just created. */
  'chat:requested': (payload: { chatId: string; tenantId: string }) => void;
  /** A chat was assigned to a staff user. */
  'chat:assigned': (payload: { chatId: string; assignedTo: string }) => void;
  /** A new message was posted to a chat. */
  'chat:message': (payload: {
    chatId: string;
    messageId: string;
    senderKind: 'visitor' | 'user' | 'system';
    senderUserId: string | null;
    body: string;
    deliveredAt: string;
  }) => void;
  /** Typing indicator. */
  'chat:typing': (payload: {
    chatId: string;
    actor: 'visitor' | 'user';
    isTyping: boolean;
  }) => void;
  /** Chat has ended. */
  'chat:ended': (payload: { chatId: string; endedBy: 'customer' | 'support' }) => void;
  /** Staff availability flipped (visitor-facing). */
  'support:availability_changed': (payload: { available: boolean }) => void;
}

/**
 * Payloads for client→server events from the staff namespace.
 */
export interface StaffToServerEvents {
  /** Staff accepts a pending chat. */
  'chat:accept': (payload: { chatId: string }) => void;
  /** Staff sends a message. */
  'chat:message': (payload: { chatId: string; body: string }) => void;
  /** Staff typing indicator. */
  'chat:typing': (payload: { chatId: string; isTyping: boolean }) => void;
  /** Staff ends a chat. */
  'chat:end': (payload: { chatId: string }) => void;
  /** Staff-initiated chat (§5.1.5). */
  'chat:initiate': (payload: { visitorSessionId: string }) => void;
}

/**
 * Payloads for client→server events from the visitor namespace.
 */
export interface VisitorToServerEvents {
  /** Visitor joins their chat room after init. */
  'chat:join': (payload: { chatId: string }) => void;
  /** Visitor sends a message. */
  'chat:message': (payload: { chatId: string; body: string }) => void;
  /** Visitor typing indicator. */
  'chat:typing': (payload: { chatId: string; isTyping: boolean }) => void;
  /** Visitor ends a chat. */
  'chat:end': (payload: { chatId: string }) => void;
  /** Visitor navigation ping. */
  'visitor:page_changed': (payload: { currentUrl: string }) => void;
}

/**
 * Data attached to an authenticated staff socket.
 */
export interface StaffSocketData {
  userId: string;
  role: string;
  tenantId: string | null;
}

/**
 * Data attached to an authenticated visitor socket.
 */
export interface VisitorSocketData {
  visitorSessionId: string;
  tenantId: string;
}
