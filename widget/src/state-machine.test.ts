import { describe, expect, it } from 'vitest';

import { initialModel, reduce } from './state-machine.js';

describe('widget state machine', () => {
  it('open + close toggle the panel without losing chat state', () => {
    const start = initialModel();
    const opened = reduce(start, { type: 'open' });
    expect(opened.open).toBe(true);
    const closed = reduce(opened, { type: 'close' });
    expect(closed.open).toBe(false);
    expect(closed.state).toBe('initial');
  });

  it('chat_created transitions to active state and stores the first message', () => {
    const opened = reduce(initialModel(), { type: 'open' });
    const active = reduce(opened, {
      type: 'chat_created',
      chatId: 'chat-1',
      customerName: 'Jane',
      firstMessage: {
        id: 'msg-1',
        body: 'hi',
        senderKind: 'visitor',
        deliveredAt: new Date().toISOString(),
      },
    });
    expect(active.state).toBe('active');
    expect(active.chatId).toBe('chat-1');
    expect(active.messages).toHaveLength(1);
  });

  it('chat_ended_by_support transitions to ended', () => {
    const opened = reduce(initialModel(), { type: 'open' });
    const ended = reduce(opened, { type: 'chat_ended_by_support' });
    expect(ended.state).toBe('ended');
  });

  it('restart returns to the restart state with an empty transcript', () => {
    const loaded = {
      ...initialModel(),
      state: 'ended' as const,
      messages: [
        {
          id: 'x',
          body: 'prior',
          senderKind: 'user' as const,
          deliveredAt: new Date().toISOString(),
        },
      ],
    };
    const restarted = reduce(loaded, { type: 'restart' });
    expect(restarted.state).toBe('restart');
    expect(restarted.messages).toHaveLength(0);
    expect(restarted.open).toBe(true);
  });
});
