import { expect } from '@playwright/test';

import { CONSOLE_URL, STORAGE_STATE, WIDGET_URL } from './config.js';

import type { Browser, Page } from '@playwright/test';

/** A test actor: an isolated browser context plus its page. */
export interface Actor {
  page: Page;
  close: () => Promise<void>;
}

/**
 * Open an anonymous visitor on the widget dev host (a fresh context, so the
 * signed visitor cookie is unique per test). The dev host embeds
 * `<afixt-livechat data-tenant-key="acme">`, matching the seeded tenant.
 * @param browser - The Playwright browser.
 * @returns The visitor actor.
 */
export async function openVisitor(browser: Browser): Promise<Actor> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(WIDGET_URL);
  return { page, close: () => context.close() };
}

/** Options for {@link openAgent}. */
export interface AgentOptions {
  /**
   * Mark the operator explicitly available before returning to the dashboard.
   *
   * Since #76/#101 availability is an explicit per-user status rather than an
   * implication of having a socket connected: `anyStaffAvailable` only counts
   * agents who are in the `presence:staff:available` set. A journey that just
   * opens the console therefore has support *offline*, and a visitor starting a
   * chat correctly lands in the no-support state instead of the transcript.
   * Journeys that need a live conversation must opt in.
   */
  available?: boolean;
}

/**
 * Set the operator's availability switch on and wait for it to take effect.
 * @param page - The agent's authenticated console page.
 */
async function setAvailable(page: Page): Promise<void> {
  await page.goto(`${CONSOLE_URL}/settings/availability`);
  const toggle = page.getByRole('checkbox', { name: 'Available' });
  await expect(toggle).toBeVisible();
  await toggle.check();
  // The server echoes `availability:self`; this text confirms the round trip,
  // so the visitor cannot race ahead of the agent actually being available.
  await expect(page.getByText('You are available.')).toBeVisible();
  await page.goto(`${CONSOLE_URL}/`);
}

/**
 * Open a support agent on the console, already authenticated via the stored
 * agent session (tenanted to acme, so it receives that tenant's socket
 * events).
 * @param browser - The Playwright browser.
 * @param options - Agent options (see {@link AgentOptions}).
 * @returns The agent actor, landed on the dashboard.
 */
export async function openAgent(browser: Browser, options: AgentOptions = {}): Promise<Actor> {
  const context = await browser.newContext({ storageState: STORAGE_STATE.agent });
  const page = await context.newPage();
  await page.goto(`${CONSOLE_URL}/`);
  if (options.available === true) await setAvailable(page);
  return { page, close: () => context.close() };
}

/**
 * Open a super admin on the console, already authenticated via the stored
 * admin session.
 * @param browser - The Playwright browser.
 * @returns The admin actor.
 */
export async function openAdmin(browser: Browser): Promise<Actor> {
  const context = await browser.newContext({ storageState: STORAGE_STATE.admin });
  const page = await context.newPage();
  await page.goto(`${CONSOLE_URL}/`);
  return { page, close: () => context.close() };
}
