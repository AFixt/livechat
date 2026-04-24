import nodemailer, { type Transporter } from 'nodemailer';

import type { Logger } from 'pino';
import type { Env } from '../config/env.js';
import type { User } from '../models/index.js';

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

  async function send(to: string, subject: string, text: string): Promise<void> {
    try {
      await transporter.sendMail({
        from: deps.env.SMTP_FROM,
        to,
        subject,
        text,
      });
    } catch (err) {
      deps.logger.error({ err, to, subject }, 'email send failed');
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
      await send(user.email, 'Verify your email', `Welcome! Verify your email by visiting: ${url}`);
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
      );
    },

    /**
     * Send the invitation email with a registration URL.
     * @param email - Recipient email.
     * @param name - Invitee name (optional; may be null).
     * @param token - Invitation token.
     */
    async sendInvitationEmail(email: string, name: string | null, token: string): Promise<void> {
      const url = `${deps.env.APP_URL}/accept-invitation/${token}`;
      const greeting = name === null ? 'Hello' : `Hello ${name}`;
      await send(
        email,
        "You've been invited",
        `${greeting}, you've been invited to join. Complete registration at: ${url}`,
      );
    },
  };
}

/**
 * Shape of the service returned by {@link createEmailService}.
 */
export type EmailService = ReturnType<typeof createEmailService>;
