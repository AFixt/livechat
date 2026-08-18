import { CONSOLE_URL, STORAGE_STATE, WIDGET_URL } from './config.js';

import type { Browser, Page } from '@playwright/test';

/** A test actor: an isolated browser context plus its page. */
export interface Actor {
  page: Page;
  close: () => Promise<void>;
}

/** The seeded tenant slug the widget dev host embeds. */
const TENANT_KEY = 'acme';

/** Options for {@link openVisitor}. */
export interface VisitorOptions {
  /**
   * Grant presence consent before the widget boots, so the visitor is tracked
   * and appears in the staff console's "Visitors on site" list.
   *
   * The consent gate (#53) leaves a visitor **untracked** by default: with no
   * geo hint the jurisdiction resolves to `UNKNOWN`, which is opt-in for
   * presence, so no `visitor_sessions` row exists and no presence socket opens.
   * That is the intended fail-safe. Journeys that assert staff-side presence
   * therefore have to model an *engaged, consented* visitor explicitly — this
   * flag performs the same `POST /privacy/consent` a consent banner would.
   */
  consentToTracking?: boolean;
}

/**
 * Record presence consent for the current visitor context, then reload so the
 * widget re-runs its bootstrap and this time receives a tracked session.
 * @param page - The visitor's page (already on the widget host).
 */
async function grantPresenceConsent(page: Page): Promise<void> {
  // Same-origin via the widget dev server's `/api` proxy, so the signed
  // visitor cookie (SameSite=Lax) is sent and the subject key matches the one
  // the widget just established.
  const status = await page.evaluate(async (tenantKey: string) => {
    const res = await fetch('/api/v1/privacy/consent', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantKey,
        purposes: { presence: 'granted', analytics: 'granted' },
      }),
    });
    return res.status;
  }, TENANT_KEY);
  if (status !== 201) throw new Error(`Recording visitor consent failed: HTTP ${String(status)}`);
  await page.reload();
}

/**
 * Open an anonymous visitor on the widget dev host (a fresh context, so the
 * signed visitor cookie is unique per test). The dev host embeds
 * `<afixt-livechat data-tenant-key="acme">`, matching the seeded tenant.
 * @param browser - The Playwright browser.
 * @param options - Visitor options (see {@link VisitorOptions}).
 * @returns The visitor actor.
 */
export async function openVisitor(browser: Browser, options: VisitorOptions = {}): Promise<Actor> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(WIDGET_URL);
  if (options.consentToTracking === true) await grantPresenceConsent(page);
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
