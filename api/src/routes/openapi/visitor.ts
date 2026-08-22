import {
  chatMessageSafeSchema,
  chatSafeSchema,
  initVisitorSessionInputSchema,
  visitorHeartbeatInputSchema,
  visitorInitiateChatInputSchema,
} from '@livechat/shared';
import { z } from 'zod';

import { openApiRegistry } from '../../config/swagger.js';

import { ackEnvelope, body, envelope, errors, json, visitorSecurity } from './support.js';

openApiRegistry.registerPath({
  method: 'post',
  path: '/visitor/session',
  summary: 'Start (or re-start) an anonymous visitor session',
  description:
    'Mints the signed `livechat_visitor` cookie, so it is the one visitor route ' +
    'that needs no session. Deliberately not CSRF-protected: the token is derived ' +
    'from a cookie that does not exist yet (#77).',
  tags: ['visitor'],
  request: { body: body(initVisitorSessionInputSchema) },
  responses: {
    201: json(
      'Session created; the cookie is set and the CSRF token returned.',
      envelope(z.object({ sessionId: z.string(), tenantId: z.string(), csrfToken: z.string() })),
    ),
    ...errors(400, 429),
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/visitor/heartbeat',
  summary: 'Report the visitor’s current page and keep presence alive',
  tags: ['visitor'],
  security: visitorSecurity(),
  request: { body: body(visitorHeartbeatInputSchema) },
  responses: { 200: json('Recorded.', ackEnvelope()), ...errors(400, 401, 403) },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/visitor/chats',
  summary: 'Start a chat as the visitor',
  tags: ['visitor'],
  security: visitorSecurity(),
  request: { body: body(visitorInitiateChatInputSchema) },
  responses: {
    201: json(
      'Chat created. `supportAvailable` is false when no agent was online, which ' +
        'puts the widget in its offline state rather than an active transcript.',
      envelope(
        z.object({
          chat: chatSafeSchema,
          message: chatMessageSafeSchema,
          supportAvailable: z.boolean(),
        }),
      ),
    ),
    ...errors(400, 401, 403),
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/visitor/chats/current',
  summary: 'The visitor’s resumable chat, if any',
  description:
    'Also hands back a CSRF token, because a returning visitor reuses an existing ' +
    'cookie and never calls `/visitor/session` again (#77).',
  tags: ['visitor'],
  security: visitorSecurity(),
  responses: {
    200: json(
      'The resumable chat and its transcript, or nulls for a fresh visitor.',
      envelope(
        z.object({
          chat: chatSafeSchema.nullable(),
          messages: z.array(chatMessageSafeSchema),
          csrfToken: z.string().optional(),
        }),
      ),
    ),
    ...errors(401),
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/visitor/chats/{id}/transcript',
  summary: 'Email the visitor a copy of their conversation',
  description:
    'Scoped to the requesting visitor’s own chat (#72), so one visitor cannot ' +
    'transcribe another’s. CSRF-protected like every cookie-authenticated ' +
    'write (#77) — it sends mail off an ambient credential (#80).',
  tags: ['visitor'],
  security: visitorSecurity(),
  request: {
    params: z.object({ id: z.uuid() }),
    body: body(z.object({ email: z.email() })),
  },
  responses: { 200: json('Transcript sent.', ackEnvelope()), ...errors(400, 401, 403, 404) },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/visitor/session/forget',
  summary: 'Visitor revokes their own session ("forget me")',
  description:
    'Hard-deletes the session row — serving geo-privacy deletion as well as ' +
    'logout — and clears the cookie. Idempotent: an already-forgotten or ' +
    'expired cookie still reports success (#79).',
  tags: ['visitor'],
  security: visitorSecurity(),
  responses: { 200: json('Forgotten.', ackEnvelope()) },
});
