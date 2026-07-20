import { expect, test } from '@playwright/test';

import { openVisitor } from '../support/actors.js';

/**
 * Widget conversation-state variants. Only the visitor-initiated end is
 * cleanly reachable through the current UI; the other documented states are
 * rendered by the widget but never dispatched to (see the follow-up issue),
 * so they are recorded here as `fixme` rather than silently omitted.
 */

test('visitor ends the chat and sees the ended state', async ({ browser }) => {
  const visitor = await openVisitor(browser);

  await visitor.page.getByRole('button', { name: 'Chat with support' }).click();
  await visitor.page.getByLabel('Your name').fill('Quinn Visitor');
  await visitor.page.getByLabel('How can we help?').fill('Just a quick question.');
  await visitor.page.getByRole('button', { name: 'Start chat' }).click();

  await expect(visitor.page.getByRole('log', { name: 'Chat transcript' })).toBeVisible();

  await visitor.page.getByRole('button', { name: 'End chat' }).click();
  await expect(visitor.page.getByText(/chat ended/i)).toBeVisible();

  await visitor.close();
});

// The widget renders these states but nothing dispatches to them in the
// current code, so they cannot be driven end to end yet:
//  - no_support: the submit handler always transitions to `active`; it never
//    consults staff availability at initiation.
//  - support_initiated: there is no console affordance to start a chat with a
//    visitor (the visitor row is not wired to `chat:initiate`).
//  - restart: no bootstrap path detects a returning visitor's prior chat.
// Tracked in the follow-up issue; unskip as each is wired.
test.fixme('no-support-available shows the offline state', () => {
  // Reachable once the widget evaluates availability at initiation.
});

test.fixme('support-initiated chat shows the invitation state', () => {
  // Reachable once the console can initiate a chat with a visitor.
});

test.fixme('a returning visitor sees the restart state', () => {
  // Reachable once the widget bootstrap detects an existing chat.
});
