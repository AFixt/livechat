import { expect, test as setup } from '@playwright/test';

import { CONSOLE_URL, STORAGE_STATE } from './support/config.js';
import { USERS } from './support/fixtures.js';

/**
 * Log the agent and super-admin accounts into the console once and persist
 * their authenticated storage, so journey contexts start signed in without
 * repeating the login per test (and without exercising the auth path 1× per
 * test). Each account gets its own context so their sessions never mix.
 */
setup('authenticate agent + admin', async ({ browser }) => {
  for (const [user, statePath] of [
    [USERS.agent, STORAGE_STATE.agent],
    [USERS.superAdmin, STORAGE_STATE.admin],
  ] as const) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${CONSOLE_URL}/login`);
    await page.getByLabel(/email address/i).fill(user.email);
    await page.getByLabel(/password/i).fill(user.password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).not.toHaveURL(/\/login/);
    await context.storageState({ path: statePath });
    await context.close();
  }
});
