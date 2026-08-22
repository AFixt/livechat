import {
  chatMessageSafeSchema,
  chatSafeSchema,
  endChatInputSchema,
  sendMessageInputSchema,
} from '@livechat/shared';
import { z } from 'zod';

import { openApiRegistry } from '../../config/swagger.js';

import { bearerSecurity, body, envelope, errors, json } from './support.js';

const chatId = z.object({ id: z.uuid() });

/**
 * Every operation on this router runs behind `authenticate` +
 * `requireStaffOrAdmin`, and each lookup is tenant-scoped — a staff caller
 * cannot reach another tenant's chat by id (#72, #43).
 */
const tenantScopedNote =
  'Tenant-scoped: a chat belonging to another tenant is refused with 403. An ' +
  'untenanted AFixt operator spans every tenant (#19).';

openApiRegistry.registerPath({
  method: 'get',
  path: '/chats',
  summary: 'List chats visible to the caller',
  description: tenantScopedNote,
  tags: ['chats'],
  security: bearerSecurity(),
  request: {
    query: z.object({
      status: z.enum(['pending', 'active', 'ended']).optional(),
      tenantId: z.uuid().optional(),
    }),
  },
  responses: {
    200: json('Chats in the caller’s scope.', envelope(z.array(chatSafeSchema))),
    ...errors(401, 403),
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/chats/{id}',
  summary: 'One chat',
  description: tenantScopedNote,
  tags: ['chats'],
  security: bearerSecurity(),
  request: { params: chatId },
  responses: { 200: json('The chat.', envelope(chatSafeSchema)), ...errors(401, 403, 404) },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/chats/{id}/messages',
  summary: 'A chat’s transcript',
  description: tenantScopedNote,
  tags: ['chats'],
  security: bearerSecurity(),
  request: { params: chatId },
  responses: {
    200: json('The messages, oldest first.', envelope(z.array(chatMessageSafeSchema))),
    ...errors(401, 403, 404),
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/chats/{id}/messages',
  summary: 'Send a message as the operator',
  description: tenantScopedNote,
  tags: ['chats'],
  security: bearerSecurity(),
  request: { params: chatId, body: body(sendMessageInputSchema) },
  responses: {
    201: json('Message delivered.', envelope(chatMessageSafeSchema)),
    ...errors(400, 401, 403, 404),
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/chats/{id}/accept',
  summary: 'Claim a pending chat',
  description: tenantScopedNote,
  tags: ['chats'],
  security: bearerSecurity(),
  request: { params: chatId },
  responses: {
    200: json('Chat claimed by the caller.', envelope(chatSafeSchema)),
    ...errors(401, 403, 404, 409),
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/chats/{id}/end',
  summary: 'End a chat',
  description: tenantScopedNote,
  tags: ['chats'],
  security: bearerSecurity(),
  request: { params: chatId, body: body(endChatInputSchema) },
  responses: {
    200: json('Chat ended.', envelope(chatSafeSchema)),
    ...errors(400, 401, 403, 404, 409),
  },
});
