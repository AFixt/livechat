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

/**
 * Open a support agent on the console, already authenticated via the stored
 * agent session (tenanted to acme, so it receives that tenant's socket
 * events).
 * @param browser - The Playwright browser.
 * @returns The agent actor, landed on the dashboard.
 */
export async function openAgent(browser: Browser): Promise<Actor> {
  const context = await browser.newContext({ storageState: STORAGE_STATE.agent });
  const page = await context.newPage();
  await page.goto(`${CONSOLE_URL}/`);
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
