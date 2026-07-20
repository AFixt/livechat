import { expect, test as setup } from '@playwright/test';

/**
 * Sign the seeded super-admin and staff accounts into the console once and
 * persist their storage, so the generated admin/support specs (whose
 * preconditions assume an authenticated user) start signed in. Credentials
 * match the e2e seed dataset.
 */
const ACCOUNTS = [
  { email: 'super@afixt.com', password: 'SuperSecret123!', state: 'e2e/.auth/admin.json' },
  { email: 'staff@acme.example', password: 'Staff!Password1', state: 'e2e/.auth/staff.json' },
  // A second staff session for the logout spec, so blacklisting its token on
  // logout does not invalidate the token the dashboard spec reuses.
  {
    email: 'staff@acme.example',
    password: 'Staff!Password1',
    state: 'e2e/.auth/staff-logout.json',
  },
] as const;

setup('authenticate admin + staff', async ({ browser }) => {
  for (const account of ACCOUNTS) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('/login');
    await page.getByLabel(/email address/i).fill(account.email);
    await page.getByLabel(/password/i).fill(account.password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).not.toHaveURL(/\/login/);
    await context.storageState({ path: account.state });
    await context.close();
  }
});
