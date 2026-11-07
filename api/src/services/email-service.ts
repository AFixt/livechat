import nodemailer, { type Transporter } from 'nodemailer';

import type { Env } from '../config/env.js';
import type { Invitation, User } from '../models/index.js';
import type { Logger } from 'pino';

/**
 * The parts of a nodemailer failure that are safe to log. The whole error is
 * not: a recipient rejection carries the refused addresses (`rejected`) and an
 * SMTP reply and message that quote them (#184).
 */
interface SendFailure {
  code: string | null;
  responseCode: number | null;
}

/**
 * Narrow a send error to its loggable parts.
 * @param err - Whatever `sendMail` rejected with.
 * @returns The SMTP error code and reply code, or null where absent.
 */
function describeSendFailure(err: unknown): SendFailure {
  if (typeof err !== 'object' || err === null) return { code: null, responseCode: null };
  const { code, responseCode } = err as { code?: unknown; responseCode?: unknown };
  return {
    code: typeof code === 'string' ? code : null,
    responseCode: typeof responseCode === 'number' ? responseCode : null,
  };
}

interface EmailDeps {
  env: Pick<Env, 'SMTP_HOST' | 'SMTP_PORT' | 'SMTP_FROM' | 'APP_URL'>;
  logger: Logger;
}

/**
 * Build an email service bound to the given SMTP config.
 * @param deps - Env + logger.
 * @returns An object with `sendVerificationEmail`, `sendPasswordResetEmail`,
 *   and `sendInvitationEmail` methods.
 */
export function createEmailService(deps: EmailDeps) {
  const transporter: Transporter = nodemailer.createTransport({
    host: deps.env.SMTP_HOST,
    port: deps.env.SMTP_PORT,
    secure: deps.env.SMTP_PORT === 465,
    ignoreTLS: true,
  });

  /**
   * Send one plain-text email; a failure is logged, never thrown.
   * @param to - Recipient address.
   * @param subject - Subject line.
   * @param text - Plain-text body.
   * @param ref - Non-identifying reference logged in place of the recipient
   *   on failure, e.g. `user:<id>`. Never the address itself (#184).
   */
  async function send(to: string, subject: string, text: string, ref: string): Promise<void> {
    try {
      await transporter.sendMail({
        from: deps.env.SMTP_FROM,
        to,
        subject,
        text,
      });
    } catch (err) {
      deps.logger.error({ err: describeSendFailure(err), ref, subject }, 'email send failed');
    }
  }

  return {
    /**
     * Send the address-verification email with a signed URL.
     * @param user - Recipient.
     * @param token - Verification token.
     */
    async sendVerificationEmail(user: User, token: string): Promise<void> {
      const url = `${deps.env.APP_URL}/verify-email/${token}`;
      await send(
        user.email,
        'Verify your email',
        `Welcome! Verify your email by visiting: ${url}`,
        `user:${user.id}`,
      );
    },

    /**
     * Send the password-reset email. Always called from a generic caller so
     * the email existence is never leaked.
     * @param user - Recipient.
     * @param token - Reset token.
     */
    async sendPasswordResetEmail(user: User, token: string): Promise<void> {
      const url = `${deps.env.APP_URL}/reset-password/${token}`;
      await send(
        user.email,
        'Reset your password',
        `A password reset was requested. Visit: ${url}\nIf you didn't request this, ignore this email.`,
        `user:${user.id}`,
      );
    },

    /**
     * Email a plain-text copy of a chat transcript to a visitor (#80).
     * @param to - Recipient email address (visitor-supplied).
     * @param chatId - The chat being sent; logged in place of `to` on failure.
     * @param lines - Transcript lines in chronological order.
     */
    async sendTranscriptEmail(
      to: string,
      chatId: string,
      lines: { senderKind: 'visitor' | 'user' | 'system'; body: string; deliveredAt: Date }[],
    ): Promise<void> {
      const speaker: Record<'visitor' | 'user' | 'system', string> = {
        visitor: 'You',
        user: 'Support',
        system: 'System',
      };
      const body =
        lines.length === 0
          ? 'This conversation had no messages.'
          : lines
              .map((l) => `[${l.deliveredAt.toISOString()}] ${speaker[l.senderKind]}: ${l.body}`)
              .join('\n');
      await send(
        to,
        'Your chat transcript',
        `Here is a copy of your conversation:\n\n${body}`,
        `chat:${chatId}`,
      );
    },

    /**
     * Send the invitation email with a registration URL.
     * @param invitation - The invitation: recipient, invitee name, token, and
     *   the id logged in place of the recipient on failure.
     */
    async sendInvitationEmail(
      invitation: Pick<Invitation, 'id' | 'email' | 'name' | 'token'>,
    ): Promise<void> {
      const url = `${deps.env.APP_URL}/accept-invitation/${invitation.token}`;
      const greeting = invitation.name === null ? 'Hello' : `Hello ${invitation.name}`;
      await send(
        invitation.email,
        "You've been invited",
        `${greeting}, you've been invited to join. Complete registration at: ${url}`,
        `invitation:${invitation.id}`,
      );
    },
  };
}

/**
 * Shape of the service returned by {@link createEmailService}.
 */
export type EmailService = ReturnType<typeof createEmailService>;
