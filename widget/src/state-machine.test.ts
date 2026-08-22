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

  it('restart opens to the restart state preloaded with the prior transcript', () => {
    const priorMessage = {
      id: 'x',
      body: 'prior',
      senderKind: 'user' as const,
      deliveredAt: new Date().toISOString(),
    };
    const restarted = reduce(initialModel(), {
      type: 'restart',
      chatId: 'chat-9',
      customerName: 'Jamie',
      messages: [priorMessage],
    });
    expect(restarted.state).toBe('restart');
    expect(restarted.open).toBe(true);
    expect(restarted.chatId).toBe('chat-9');
    expect(restarted.customerName).toBe('Jamie');
    expect(restarted.messages).toEqual([priorMessage]);
  });

  it('restart_resumed moves a resumable chat into the active state, keeping messages', () => {
    const restarted = reduce(initialModel(), {
      type: 'restart',
      chatId: 'chat-9',
      customerName: 'Jamie',
      messages: [
        { id: 'x', body: 'prior', senderKind: 'user', deliveredAt: new Date().toISOString() },
      ],
    });
    const resumed = reduce(restarted, { type: 'restart_resumed' });
    expect(resumed.state).toBe('active');
    expect(resumed.chatId).toBe('chat-9');
    expect(resumed.messages).toHaveLength(1);
  });

  it('chat_created_no_support shows the offline state without a chat id', () => {
    const opened = reduce(initialModel(), { type: 'open' });
    const offline = reduce(opened, { type: 'chat_created_no_support', customerName: 'Sam' });
    expect(offline.state).toBe('no_support');
    expect(offline.customerName).toBe('Sam');
    expect(offline.chatId).toBeNull();
  });

  it('support_available toggles the flag that gates the proactive invitation (§5.1.2)', () => {
    // Regression guard: before #76 the only dispatch of this action set
    // `available: false`, so the invitation surface was unreachable. Both
    // directions must now be honoured.
    const start = initialModel();
    expect(start.supportAvailable).toBe(false);
    const online = reduce(start, { type: 'support_available', available: true });
    expect(online.supportAvailable).toBe(true);
    const offline = reduce(online, { type: 'support_available', available: false });
    expect(offline.supportAvailable).toBe(false);
  });

  it('support_initiated opens the panel and support_accepted goes active', () => {
    const initiated = reduce(initialModel(), { type: 'support_initiated', chatId: 'chat-5' });
    expect(initiated.state).toBe('support_initiated');
    expect(initiated.open).toBe(true);
    expect(initiated.chatId).toBe('chat-5');
    const accepted = reduce(initiated, { type: 'support_accepted' });
    expect(accepted.state).toBe('active');
    expect(accepted.chatId).toBe('chat-5');
  });
});
