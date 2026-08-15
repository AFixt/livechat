import { describe, expect, it } from 'vitest';

import { initialModel, reduce } from './state-machine.js';

import type { WidgetMessage } from './types.js';

/**
 * Build a message quickly.
 * @param id - Message id.
 * @param body - Body text.
 * @param senderKind - Who sent it.
 * @returns A WidgetMessage.
 */
function msg(id: string, body: string, senderKind: WidgetMessage['senderKind']): WidgetMessage {
  return { id, body, senderKind, deliveredAt: '2026-01-01T00:00:00.000Z' };
}

describe('messages_synced reconciliation (#69)', () => {
  it('replaces the local transcript with the server transcript', () => {
    const start = { ...initialModel(), messages: [msg('local-1', 'hi', 'visitor')] };
    const next = reduce(start, {
      type: 'messages_synced',
      messages: [msg('real-1', 'hi', 'visitor'), msg('real-2', 'hello', 'user')],
    });
    expect(next.messages.map((m) => m.id)).toEqual(['real-1', 'real-2']);
  });

  it('preserves an in-flight optimistic send the server has not yet recorded', () => {
    const start = {
      ...initialModel(),
      messages: [msg('real-1', 'earlier', 'visitor'), msg('local-2', 'sent during outage', 'visitor')],
    };
    const next = reduce(start, {
      type: 'messages_synced',
      messages: [msg('real-1', 'earlier', 'visitor')],
    });
    expect(next.messages.map((m) => m.body)).toEqual(['earlier', 'sent during outage']);
  });

  it('drops an optimistic send the server has since persisted (no duplicate bubble)', () => {
    const start = {
      ...initialModel(),
      messages: [msg('local-9', 'dup', 'visitor')],
    };
    const next = reduce(start, {
      type: 'messages_synced',
      messages: [msg('real-9', 'dup', 'visitor')],
    });
    expect(next.messages.map((m) => m.id)).toEqual(['real-9']);
  });

  it('message_received ignores a duplicate id after a backfill', () => {
    const start = { ...initialModel(), messages: [msg('real-1', 'hi', 'user')] };
    const next = reduce(start, { type: 'message_received', message: msg('real-1', 'hi', 'user') });
    expect(next.messages).toHaveLength(1);
  });
});
