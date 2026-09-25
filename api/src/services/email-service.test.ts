import { createServer, type AddressInfo, type Server } from 'node:net';

import nodemailer from 'nodemailer';
import { afterEach, describe, expect, it } from 'vitest';

import { createLogger } from '../config/logger.js';

import { createEmailService } from './email-service.js';

import type { User } from '../models/index.js';

const RECIPIENT = 'jane.doe@example.org';
// Any email-address-shaped string. The assertion is on the absence of every
// address, not only RECIPIENT, so a reworded SMTP reply can't slip one past.
const ADDRESS = /[\w.+-]+@[\w-]+\.[\w.-]+/;

/**
 * A minimal SMTP server that accepts the session but refuses every recipient
 * with a reply that quotes the address, the way Postfix does. That is the case
 * where nodemailer's error carries the address in `rejected`, `response` and
 * `message` (#184) — a connection error would not exercise it.
 * @returns The listening server.
 */
async function startRejectingSmtpServer(): Promise<Server> {
  const server = createServer((socket) => {
    socket.write('220 test ESMTP\r\n');
    socket.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split('\r\n').filter(Boolean)) {
        const rcpt = /^RCPT TO:<([^>]*)>/i.exec(line);
        if (rcpt !== null) {
          socket.write(`550 5.1.1 <${rcpt[1] ?? ''}>: Recipient address rejected\r\n`);
        } else if (/^QUIT/i.test(line)) {
          socket.end('221 bye\r\n');
        } else {
          socket.write('250 ok\r\n');
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

/**
 * Find a port nothing is listening on, for the connection-refused case.
 * @returns A closed local port.
 */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) =>
    server.close(() => {
      resolve();
    }),
  );
  return port;
}

/**
 * Build the service against `port` with the production logger config writing
 * into `lines`, so assertions see exactly what an operator would.
 * @param port - SMTP port.
 * @param lines - Receives every serialized log line.
 * @returns The email service.
 */
function serviceOn(port: number, lines: string[]) {
  const logger = createLogger(
    { NODE_ENV: 'test', LOG_LEVEL: 'info' },
    { write: (line: string) => lines.push(line) },
  );
  return createEmailService({
    env: {
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: port,
      SMTP_FROM: 'no-reply@livechat.test',
      APP_URL: 'http://localhost:5173',
    },
    logger,
  });
}

const user = { id: 'user-1', email: RECIPIENT } as User;

let server: Server | undefined;

afterEach(async () => {
  if (server === undefined) return;
  const closing = server;
  server = undefined;
  await new Promise<void>((resolve) =>
    closing.close(() => {
      resolve();
    }),
  );
});

describe('email-service send failures (#184)', () => {
  it('a rejected recipient is logged by reference, with no address anywhere', async () => {
    server = await startRejectingSmtpServer();
    const lines: string[] = [];
    const email = serviceOn((server.address() as AddressInfo).port, lines);

    await email.sendPasswordResetEmail(user, 'reset-token');

    expect(lines).toHaveLength(1);
    const output = lines.join('');
    expect(output).not.toMatch(ADDRESS);
    expect(JSON.parse(output)).toMatchObject({
      msg: 'email send failed',
      ref: 'user:user-1',
      err: { code: 'EENVELOPE', responseCode: 550 },
    });
  });

  it('the raw nodemailer rejection does carry the address — the route being closed', async () => {
    server = await startRejectingSmtpServer();
    const transporter = nodemailer.createTransport({
      host: '127.0.0.1',
      port: (server.address() as AddressInfo).port,
      ignoreTLS: true,
    });

    const err: unknown = await transporter
      .sendMail({ from: 'no-reply@livechat.test', to: RECIPIENT, subject: 's', text: 't' })
      .then(
        () => null,
        (e: unknown) => e,
      );

    expect(err).toMatchObject({ code: 'EENVELOPE', rejected: [RECIPIENT] });
    expect(JSON.stringify(err)).toContain(RECIPIENT);
  });

  it('a connection failure is logged by reference, with no address anywhere', async () => {
    const lines: string[] = [];
    const email = serviceOn(await closedPort(), lines);

    await email.sendInvitationEmail({
      id: 'inv-1',
      email: RECIPIENT,
      name: 'Jane',
      token: 'invite-token',
    });
    await email.sendTranscriptEmail(RECIPIENT, 'chat-1', []);
    await email.sendVerificationEmail(user, 'verify-token');

    expect(lines).toHaveLength(3);
    expect(lines.join('')).not.toMatch(ADDRESS);
    expect(lines.map((l) => (JSON.parse(l) as { ref: string }).ref)).toEqual([
      'invitation:inv-1',
      'chat:chat-1',
      'user:user-1',
    ]);
  });
});

describe('logger PII backstop (#184)', () => {
  it('removes address-bearing fields a call site logs by mistake', () => {
    const lines: string[] = [];
    const logger = createLogger(
      { NODE_ENV: 'test', LOG_LEVEL: 'info' },
      { write: (line: string) => lines.push(line) },
    );

    logger.error(
      {
        to: RECIPIENT,
        email: RECIPIENT,
        user: { id: 'user-1', email: RECIPIENT },
        err: {
          code: 'EENVELOPE',
          rejected: [RECIPIENT],
          rejectedErrors: [{ recipient: RECIPIENT }],
          response: `550 5.1.1 <${RECIPIENT}>: Recipient address rejected`,
        },
      },
      'oops',
    );

    const output = lines.join('');
    expect(output).not.toMatch(ADDRESS);
    expect(JSON.parse(output)).toMatchObject({
      user: { id: 'user-1' },
      err: { code: 'EENVELOPE' },
    });
  });
});
