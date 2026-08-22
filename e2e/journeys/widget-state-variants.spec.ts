import { expect, test } from '@playwright/test';

import { openAgent, openVisitor } from '../support/actors.js';

/**
 * Widget conversation-state variants, each driven end to end over live
 * sockets. The states are rendered by the widget and now wired to real
 * triggers: staff availability at initiation (no_support), a console-initiated
 * chat (support_initiated), and a returning visitor's prior chat (restart).
 */

test('visitor ends the chat and sees the ended state', async ({ browser }) => {
  // Support must be online for the chat to reach the active state, from which
  // the visitor can end it. Availability is explicit since #76/#101.
  const agent = await openAgent(browser, { available: true });
  await expect(agent.page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await agent.page.waitForTimeout(1000);

  const visitor = await openVisitor(browser);
  await visitor.page.getByRole('button', { name: 'Chat with support' }).click();
  await visitor.page.getByLabel('Your name').fill('Quinn Visitor');
  await visitor.page.getByLabel('How can we help?').fill('Just a quick question.');
  await visitor.page.getByRole('button', { name: 'Start chat' }).click();

  await expect(visitor.page.getByRole('log', { name: 'Chat transcript' })).toBeVisible();

  await visitor.page.getByRole('button', { name: 'End chat' }).click();
  await expect(visitor.page.getByText(/chat ended/i)).toBeVisible();

  await visitor.close();
  await agent.close();
});

test('no-support-available shows the offline state', async ({ browser }) => {
  // Support being offline has to be *asserted*, not waited for. Availability is
  // an explicit, persisted per-user status since #76/#101: the server never
  // flips an agent away on disconnect, and the connection grace window is 120s,
  // so an earlier test's agent closing its context cannot make support offline
  // within a run — the previous 1s wait could never have achieved it. Mark the
  // agent explicitly away instead.
  const agent = await openAgent(browser, { available: false });
  const visitor = await openVisitor(browser);

  await visitor.page.getByRole('button', { name: 'Chat with support' }).click();
  await visitor.page.getByLabel('Your name').fill('Rae Visitor');
  await visitor.page.getByLabel('How can we help?').fill('Is anyone available?');
  await visitor.page.getByRole('button', { name: 'Start chat' }).click();

  // The offline surface: an explanation plus the email-capture form, not an
  // active chat transcript.
  await expect(visitor.page.getByText(/our support team isn't online right now/i)).toBeVisible();
  await expect(visitor.page.getByLabel('Email address')).toBeVisible();
  await expect(visitor.page.getByRole('log', { name: 'Chat transcript' })).toHaveCount(0);

  await visitor.close();
  await agent.close();
});

test('support-initiated chat shows the invitation state', async ({ browser }) => {
  // Agent online first so it receives the visitor's presence event.
  const agent = await openAgent(browser);
  await expect(agent.page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await agent.page.waitForTimeout(1000);

  // Visitor loads the widget — the session + socket connect on mount, so they
  // appear in the console's presence list without opening the panel.
  const visitor = await openVisitor(browser);

  const visitorRow = agent.page
    .getByRole('list', { name: 'Visitors on site' })
    .getByRole('button', { name: /start a chat with visitor/i })
    .first();
  await expect(visitorRow).toBeVisible();
  await visitorRow.click();

  // The widget surfaces the support-initiated invitation; accepting moves the
  // visitor into the active chat.
  await expect(
    visitor.page.getByRole('heading', { name: 'A support agent wants to chat' }),
  ).toBeVisible();
  await visitor.page.getByRole('button', { name: 'Accept' }).click();
  await expect(visitor.page.getByRole('log', { name: 'Chat transcript' })).toBeVisible();

  await visitor.close();
  await agent.close();
});

test('a returning visitor sees the restart state', async ({ browser }) => {
  // Agent online and explicitly available (#76/#101) so the chat reaches the
  // active state deterministically.
  const agent = await openAgent(browser, { available: true });
  await expect(agent.page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await agent.page.waitForTimeout(1000);

  const visitor = await openVisitor(browser);
  await visitor.page.getByRole('button', { name: 'Chat with support' }).click();
  await visitor.page.getByLabel('Your name').fill('Sky Visitor');
  await visitor.page.getByLabel('How can we help?').fill('One moment please.');
  await visitor.page.getByRole('button', { name: 'Start chat' }).click();
  await expect(visitor.page.getByRole('log', { name: 'Chat transcript' })).toBeVisible();

  // Return within the same session (same cookie): the widget offers to resume.
  await visitor.page.reload();
  await expect(
    visitor.page.getByText(/welcome back\. continue your conversation\?/i),
  ).toBeVisible();
  await visitor.page.getByRole('button', { name: 'Resume chat' }).click();
  await expect(visitor.page.getByRole('log', { name: 'Chat transcript' })).toBeVisible();

  await visitor.close();
  await agent.close();
});
