import { expect, test } from '@playwright/test';

import { openAdmin } from '../support/actors.js';
import { API_URL, CONSOLE_URL } from '../support/config.js';
import { PROVISIONING } from '../support/fixtures.js';
import { clearInbox, extractInvitationToken, waitForEmail } from '../support/mailhog.js';

/**
 * The provisioning lifecycle: a super admin stands up a new tenant and
 * invites a staff member through the console; the invitation email is read
 * from MailHog (proving it was actually sent with the right link); the
 * invitee registers and then signs in and reaches the console.
 *
 * The invitee registers via the API rather than the UI: the
 * `/accept-invitation` page is still a stub (see the follow-up issue), while
 * `POST /auth/register` is the real, tested path. Everything on either side
 * of that step is driven through the actual UI.
 */
const {
  tenantName: TENANT_NAME,
  tenantSlug: TENANT_SLUG,
  inviteeEmail: INVITEE_EMAIL,
  inviteePassword: INVITEE_PASSWORD,
} = PROVISIONING;

test('super admin provisions a tenant, invites staff, who then signs in', async ({ browser }) => {
  await clearInbox();
  const admin = await openAdmin(browser);

  // 1. Create the tenant.
  await admin.page.goto(`${CONSOLE_URL}/admin/tenants`);
  await admin.page.getByRole('button', { name: 'Create tenant' }).click();
  const tenantDialog = admin.page.getByRole('dialog', { name: 'Create tenant' });
  await tenantDialog.getByLabel('Name').fill(TENANT_NAME);
  await tenantDialog.getByLabel('Slug').fill(TENANT_SLUG);
  await tenantDialog.getByRole('button', { name: 'Create' }).click();
  await expect(admin.page.getByRole('cell', { name: TENANT_NAME })).toBeVisible();

  // 2. Invite a staff member into that tenant.
  await admin.page.goto(`${CONSOLE_URL}/admin/invitations`);
  await admin.page.getByRole('button', { name: 'Invite user' }).click();
  const inviteDialog = admin.page.getByRole('dialog');
  await inviteDialog.getByLabel('Email').fill(INVITEE_EMAIL);
  await inviteDialog.getByRole('combobox', { name: 'Tenant' }).click();
  await admin.page.getByRole('option', { name: `${TENANT_NAME} (${TENANT_SLUG})` }).click();
  await inviteDialog.getByRole('button', { name: 'Create' }).click();
  await expect(admin.page.getByRole('cell', { name: INVITEE_EMAIL })).toBeVisible();

  // 3. The invitation email actually went out — read its token from MailHog.
  const email = await waitForEmail(INVITEE_EMAIL);
  const token = extractInvitationToken(email);

  // 4. The invitee registers against that token (UI page is still a stub).
  const registration = await fetch(`${API_URL}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: INVITEE_EMAIL,
      password: INVITEE_PASSWORD,
      firstName: 'Newbie',
      lastName: 'Staffer',
      token,
    }),
  });
  expect(registration.status).toBe(201);

  // 5. The provisioned account signs in through the console and lands on it.
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${CONSOLE_URL}/login`);
  await page.getByLabel(/email address/i).fill(INVITEE_EMAIL);
  await page.getByLabel(/password/i).fill(INVITEE_PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  await context.close();
  await admin.close();
});
