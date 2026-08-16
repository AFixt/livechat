import type { WidgetMessage, WidgetState } from './types.js';

/**
 *
 */
export interface WidgetModel {
  state: WidgetState;
  open: boolean;
  chatId: string | null;
  customerName: string;
  messages: WidgetMessage[];
  errorMessage: string | null;
  supportAvailable: boolean;
}

/**
 * Initial widget state — closed, no chat, no messages.
 * @returns The initial model.
 */
export function initialModel(): WidgetModel {
  return {
    state: 'initial',
    open: false,
    chatId: null,
    customerName: '',
    messages: [],
    errorMessage: null,
    supportAvailable: false,
  };
}

/**
 * Discriminated action union for the widget state machine. Keep actions
 * flat — no object types embedded so the reducer stays below 75 lines.
 */
export type WidgetAction =
  | { type: 'open' }
  | { type: 'close' }
  | { type: 'support_available'; available: boolean }
  | {
      type: 'chat_created';
      chatId: string;
      customerName: string;
      firstMessage: WidgetMessage;
    }
  | { type: 'chat_created_no_support'; customerName: string }
  | { type: 'support_initiated'; chatId: string }
  | { type: 'support_accepted' }
  | { type: 'message_received'; message: WidgetMessage }
  | { type: 'message_sent'; message: WidgetMessage }
  | { type: 'messages_synced'; messages: WidgetMessage[] }
  | { type: 'chat_ended_by_support' }
  | { type: 'chat_ended_by_customer' }
  | {
      type: 'restart';
      chatId: string;
      customerName: string;
      messages: WidgetMessage[];
    }
  | { type: 'restart_resumed' }
  | { type: 'error'; message: string };

/**
 * Append a message unless one with the same id is already present, so a
 * duplicate delivery (e.g. a socket re-emit after reconnect) never doubles a
 * bubble (issue #69).
 * @param messages - Current messages.
 * @param message - Incoming message.
 * @returns The next message list.
 */
function appendUnique(messages: WidgetMessage[], message: WidgetMessage): WidgetMessage[] {
  if (messages.some((m) => m.id === message.id)) return messages;
  return [...messages, message];
}

/**
 * Reconcile the server's authoritative transcript with what the widget holds
 * after a reconnect (issue #69). The server list wins; any local optimistic
 * send (`local-` id) that the server has not yet persisted is preserved so an
 * in-flight message posted during the outage is not lost. Optimistic visitor
 * sends the server already recorded are dropped to avoid a duplicate bubble.
 *
 * The drop is matched by a *count* of each persisted body, not a set: if the
 * visitor sent the identical text twice but only one copy persisted before the
 * drop, exactly one optimistic copy is retired against that server row and the
 * still-in-flight one is kept. A plain `Set` of bodies would silently drop
 * both, losing the un-persisted message.
 * @param existing - Messages currently in the model.
 * @param incoming - The server transcript (real ids), oldest first.
 * @returns The reconciled, de-duplicated message list.
 */
function reconcileMessages(existing: WidgetMessage[], incoming: WidgetMessage[]): WidgetMessage[] {
  const incomingIds = new Set(incoming.map((m) => m.id));
  const persistedVisitorBodyCounts = new Map<string, number>();
  for (const m of incoming) {
    if (m.senderKind !== 'visitor') continue;
    persistedVisitorBodyCounts.set(m.body, (persistedVisitorBodyCounts.get(m.body) ?? 0) + 1);
  }
  const pending: WidgetMessage[] = [];
  for (const m of existing) {
    if (!m.id.startsWith('local-') || incomingIds.has(m.id)) continue;
    if (m.senderKind === 'visitor') {
      const remaining = persistedVisitorBodyCounts.get(m.body) ?? 0;
      if (remaining > 0) {
        // Retire one optimistic copy against this persisted server row.
        persistedVisitorBodyCounts.set(m.body, remaining - 1);
        continue;
      }
    }
    pending.push(m);
  }
  return [...incoming, ...pending];
}

const handlers: {
  [K in WidgetAction['type']]: (
    model: WidgetModel,
    action: Extract<WidgetAction, { type: K }>,
  ) => WidgetModel;
} = {
  open: (m) => ({ ...m, open: true, errorMessage: null }),
  close: (m) => ({ ...m, open: false }),
  support_available: (m, a) => ({ ...m, supportAvailable: a.available }),
  chat_created: (m, a) => ({
    ...m,
    state: 'active',
    chatId: a.chatId,
    customerName: a.customerName,
    messages: [a.firstMessage],
    errorMessage: null,
  }),
  chat_created_no_support: (m, a) => ({
    ...m,
    state: 'no_support',
    customerName: a.customerName,
  }),
  support_initiated: (m, a) => ({ ...m, state: 'support_initiated', chatId: a.chatId, open: true }),
  support_accepted: (m) => ({ ...m, state: 'active' }),
  message_received: (m, a) => ({ ...m, messages: appendUnique(m.messages, a.message) }),
  message_sent: (m, a) => ({ ...m, messages: appendUnique(m.messages, a.message) }),
  messages_synced: (m, a) => ({ ...m, messages: reconcileMessages(m.messages, a.messages) }),
  chat_ended_by_support: (m) => ({ ...m, state: 'ended' }),
  chat_ended_by_customer: (m) => ({ ...m, state: 'ended' }),
  restart: (_m, a) => ({
    ...initialModel(),
    state: 'restart',
    open: true,
    chatId: a.chatId,
    customerName: a.customerName,
    messages: a.messages,
  }),
  restart_resumed: (m) => ({ ...m, state: 'active' }),
  error: (m, a) => ({ ...m, errorMessage: a.message }),
};

/**
 * Pure state transition function. Looks up the handler for the action type
 * in a table so complexity stays flat.
 * @param model - Current model.
 * @param action - Dispatched action.
 * @returns Next model.
 */
export function reduce(model: WidgetModel, action: WidgetAction): WidgetModel {
  const handler = handlers[action.type] as (m: WidgetModel, a: WidgetAction) => WidgetModel;
  return handler(model, action);
}
