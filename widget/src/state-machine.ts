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
  | { type: 'message_received'; message: WidgetMessage }
  | { type: 'message_sent'; message: WidgetMessage }
  | { type: 'chat_ended_by_support' }
  | { type: 'chat_ended_by_customer' }
  | { type: 'restart' }
  | { type: 'error'; message: string };

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
  support_initiated: (m, a) => ({ ...m, state: 'support_initiated', chatId: a.chatId }),
  message_received: (m, a) => ({ ...m, messages: [...m.messages, a.message] }),
  message_sent: (m, a) => ({ ...m, messages: [...m.messages, a.message] }),
  chat_ended_by_support: (m) => ({ ...m, state: 'ended' }),
  chat_ended_by_customer: (m) => ({ ...m, state: 'ended' }),
  restart: () => ({ ...initialModel(), state: 'restart', open: true }),
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
