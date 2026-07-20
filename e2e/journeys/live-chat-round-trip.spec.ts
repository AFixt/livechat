import { expect, test } from '@playwright/test';

import { openAgent, openVisitor } from '../support/actors.js';

/**
 * The headline journey: a customer in the widget and a support agent in the
 * console hold a real conversation over live sockets, driven in two browser
 * contexts at once. Asserts propagation in both directions — the exact path
 * that was silently broken (visitor-initiated chats never reached the
 * console) before the accompanying fix.
 */
const VISITOR_NAME = 'Dana Visitor';
const FIRST_MESSAGE = 'Hi, my checkout is failing.';
const FOLLOW_UP = 'It still will not go through.';
const AGENT_REPLY = 'Thanks Dana — let me take a look at your cart.';

test('customer and agent converse end to end, both directions', async ({ browser }) => {
  // Agent comes online first, so support is available when the visitor starts.
  const agent = await openAgent(browser);
  await expect(agent.page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(agent.page.getByText('No active chats.')).toBeVisible();
  // Let the staff socket connect and mark the agent available before the
  // visitor initiates (otherwise the widget lands in the no-support state).
  await agent.page.waitForTimeout(1000);

  // Visitor opens the widget and starts a chat.
  const visitor = await openVisitor(browser);
  await visitor.page.getByRole('button', { name: 'Chat with support' }).click();
  await expect(visitor.page.getByRole('heading', { name: 'Chat with support' })).toBeVisible();
  await visitor.page.getByLabel('Your name').fill(VISITOR_NAME);
  await visitor.page.getByLabel('How can we help?').fill(FIRST_MESSAGE);
  await visitor.page.getByRole('button', { name: 'Start chat' }).click();

  // Support was available → the widget shows the active chat surface.
  const visitorTranscript = visitor.page.getByRole('log', { name: 'Chat transcript' });
  await expect(visitorTranscript).toBeVisible();

  // The chat reaches the agent's console and carries the visitor's name.
  const chatItem = agent.page
    .getByRole('list', { name: 'Your chats' })
    .getByRole('button', { name: new RegExp(VISITOR_NAME, 'i') });
  await expect(chatItem).toBeVisible();

  // Opening it loads the transcript, including the first message posted at
  // initiation (created over HTTP, before any socket broadcast).
  await chatItem.click();
  const agentTranscript = agent.page.getByRole('log', { name: 'Chat transcript' });
  await expect(agentTranscript).toContainText(FIRST_MESSAGE);

  // Visitor → agent: a live follow-up appears in the console.
  await visitor.page.getByLabel('Message').fill(FOLLOW_UP);
  await visitor.page.getByRole('button', { name: 'Send' }).click();
  await expect(agentTranscript).toContainText(FOLLOW_UP);

  // Agent → visitor: the reply appears in the widget.
  await agent.page.getByLabel('Message').fill(AGENT_REPLY);
  await agent.page.getByRole('button', { name: 'Send' }).click();
  await expect(visitorTranscript).toContainText(AGENT_REPLY);

  // Agent ends the chat; the visitor sees the ended state.
  await agent.page.getByRole('button', { name: 'End chat' }).click();
  await expect(visitor.page.getByText(/chat ended/i)).toBeVisible();

  await visitor.close();
  await agent.close();
});
