import { beforeEach, describe, expect, it } from 'vitest';

import { useChatsStore, type ChatMessage } from './chats.js';

/**
 * Build a transcript message quickly.
 * @param id - Message id.
 * @param body - Body text.
 * @returns A ChatMessage from the visitor.
 */
function msg(id: string, body: string): ChatMessage {
  return { id, body, senderKind: 'visitor', deliveredAt: '2026-01-01T00:00:00.000Z' };
}

describe('useChatsStore.mergeMessages (reconnect backfill, #69)', () => {
  beforeEach(() => {
    useChatsStore.setState({ visitors: {}, chats: {}, activeChatId: null });
  });

  it('adds messages the console missed during the outage without duplicating shown ones', () => {
    const { upsertChat, mergeMessages } = useChatsStore.getState();
    upsertChat({ id: 'c1', messages: [msg('m1', 'hello')] });

    // The transcript re-fetched on reconnect includes m1 (already shown) plus
    // m2 + m3 delivered while the console was disconnected.
    mergeMessages('c1', [msg('m1', 'hello'), msg('m2', 'during outage'), msg('m3', 'still here?')]);

    const chat = useChatsStore.getState().chats['c1'];
    expect(chat?.messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('keeps a locally-held message the fetched transcript does not yet contain', () => {
    const { upsertChat, mergeMessages } = useChatsStore.getState();
    // m9 arrived live between firing the fetch and its resolution.
    upsertChat({ id: 'c1', messages: [msg('m1', 'hello'), msg('m9', 'raced in live')] });

    mergeMessages('c1', [msg('m1', 'hello')]);

    const chat = useChatsStore.getState().chats['c1'];
    expect(chat?.messages.map((m) => m.id)).toEqual(['m1', 'm9']);
  });

  it('ignores a backfill for an unknown chat', () => {
    const { mergeMessages } = useChatsStore.getState();
    mergeMessages('nope', [msg('m1', 'hello')]);
    expect(useChatsStore.getState().chats['nope']).toBeUndefined();
  });
});
