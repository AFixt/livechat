import { expect } from '@playwright/test';

import { API_URL, CONSOLE_URL, STORAGE_STATE, WIDGET_URL } from './config.js';

import type { Browser, Page } from '@playwright/test';

/**
 * The seeded tenant both the widget dev host and the support agent belong to.
 * Used to ask the api whether support currently reads as available.
 */
const AGENT_TENANT_KEY = 'acme';

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
   * Set the operator's explicit availability before returning to the dashboard.
   *
   * Since #76/#101 availability is an explicit per-user status rather than an
   * implication of having a socket connected: `anyStaffAvailable` only counts
   * agents in the `presence:staff:available:<tenantId>` set. A journey that just
   * opens the console therefore has support *offline*, and a visitor starting a
   * chat correctly lands in the no-support state instead of the transcript.
   *
   * The status is *persisted* server-side and deliberately survives disconnect
   * (the connection grace window is 120s), so it also leaks forward to every
   * later test in the run. Both directions therefore have to be stated, not
   * assumed: pass `true` for journeys that need a live conversation and `false`
   * for journeys that need support offline. Omit it only when the journey does
   * not depend on availability at all.
   */
  available?: boolean;
}

/**
 * Set the operator's availability and wait until the *server* agrees.
 *
 * Driving this control is racy in a way that `check()` / `setChecked()` cannot
 * survive, so neither is used here:
 *
 * - The store starts at `unknown`, which renders identically to `away`, so the
 *   switch's initial visual state is not the server's state.
 * - `handleToggle` updates the store optimistically, then the server's
 *   `availability:self` echo (sent on connect by `restoreOnConnect`) arrives and
 *   overwrites it. When that echo lands just after the click, the switch snaps
 *   back and `check()`/`setChecked()` throw "Clicking the checkbox did not
 *   change its state".
 *
 * So: click only when the rendered state differs from the target, then confirm
 * against the *server*, retrying the whole cycle until it agrees. That converges
 * from any starting state (a later pass reads a settled, echo-populated switch)
 * and needs no wall-clock guesses.
 *
 * The confirmation deliberately does not read the console's own status text.
 * `unknown` renders identically to `away`, so that text cannot distinguish "the
 * server says away" from "the echo has not arrived yet" — asserting on it passes
 * vacuously in the `away` direction, on the pre-echo render. `/widget/config`
 * reports `supportAvailable` from the same `anyStaffAvailable` predicate the
 * journeys actually depend on, so it both discriminates and is exactly on point.
 * It is public and unauthenticated, and `originAllowed` passes a request that
 * sends no `Origin`.
 * @param page - The agent's authenticated console page.
 * @param available - Target availability.
 */
async function setAvailability(page: Page, available: boolean): Promise<void> {
  await page.goto(`${CONSOLE_URL}/settings/availability`);
  await expect(async () => {
    const toggle = page.getByRole('checkbox', { name: 'Available' });
    await expect(toggle).toBeVisible();
    if ((await toggle.isChecked()) !== available) await toggle.click();
    const res = await page.request.get(
      `${API_URL}/api/v1/widget/config?tenantKey=${AGENT_TENANT_KEY}`,
    );
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as { data?: { supportAvailable?: boolean } };
    expect(body.data?.supportAvailable).toBe(available);
  }).toPass({ timeout: 30_000 });
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
  if (options.available !== undefined) await setAvailability(page, options.available);
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
