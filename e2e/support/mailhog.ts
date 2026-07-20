import { MAILHOG_API } from './config.js';

interface MailhogMessage {
  // MailHog's HTTP API returns PascalCase fields; mirror them verbatim.
  /* eslint-disable @typescript-eslint/naming-convention */
  Content: { Body: string; Headers: Record<string, string[]> };
  /* eslint-enable @typescript-eslint/naming-convention */
}

interface MailhogSearch {
  total: number;
  items: MailhogMessage[];
}

/**
 * Delete every message MailHog is holding, so a journey's inbox assertions
 * only see mail that journey caused.
 */
export async function clearInbox(): Promise<void> {
  await fetch(`${MAILHOG_API}/api/v1/messages`, { method: 'DELETE' });
}

/**
 * Poll MailHog for a message addressed to `recipient` and return its decoded
 * body. Proves the app actually sent the mail rather than assuming it did.
 * @param recipient - The `to` address to search for.
 * @param timeoutMs - How long to wait before giving up.
 * @returns The most recent matching message body.
 */
export async function waitForEmail(recipient: string, timeoutMs = 10_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await fetch(
      `${MAILHOG_API}/api/v2/search?kind=to&query=${encodeURIComponent(recipient)}`,
    );
    if (res.ok) {
      const data = (await res.json()) as MailhogSearch;
      const body = data.items[0]?.Content.Body;
      if (body !== undefined) return decodeQuotedPrintable(body);
    }
    if (Date.now() > deadline) {
      throw new Error(`No email to ${recipient} arrived within ${String(timeoutMs)}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/**
 * Pull the invitation token out of an email body containing an
 * `/accept-invitation/:token` link (see api email-service).
 * @param body - The decoded email body.
 * @returns The invitation token.
 */
export function extractInvitationToken(body: string): string {
  const match = /\/accept-invitation\/([A-Za-z0-9._-]+)/.exec(body);
  if (match?.[1] === undefined) {
    throw new Error(`No /accept-invitation/:token link found in email body:\n${body}`);
  }
  return match[1];
}

/**
 * Minimal quoted-printable decode — MailHog stores bodies encoded, and the
 * invitation URL can be soft-wrapped (`=\n`) or escaped (`=3D`).
 * @param input - The raw body.
 * @returns The decoded text.
 */
function decodeQuotedPrintable(input: string): string {
  return input
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}
