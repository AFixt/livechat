import { expect, test } from '@playwright/test';

import { openAdmin, openVisitor } from '../support/actors.js';

/**
 * Issue #19: an AFixt super-admin with no tenant of their own must still see
 * real-time visitor presence across every tenant. Before the fix the console
 * sat silent — untenanted staff joined no `tenant:{id}` room, and every visitor
 * event targeted only that room. Now untenanted staff join the global staff
 * room those events are mirrored to.
 */
test('untenanted super-admin sees a visitor arrive in the console', async ({ browser }) => {
  // The seeded super-admin has tenant_id = null (fixtures: USERS.superAdmin).
  const admin = await openAdmin(browser);
  await expect(admin.page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(admin.page.getByText('No visitors are currently on the site.')).toBeVisible();
  // Let the staff socket connect and join the global room before the visitor.
  await admin.page.waitForTimeout(1000);

  // A visitor loads the widget in tenant "acme"; their presence must reach the
  // untenanted admin, who has no tenant room of their own.
  const visitor = await openVisitor(browser);

  const visitorRow = admin.page
    .getByRole('list', { name: 'Visitors on site' })
    .getByRole('button', { name: /start a chat with visitor/i })
    .first();
  await expect(visitorRow).toBeVisible();

  await visitor.close();
  await admin.close();
});
