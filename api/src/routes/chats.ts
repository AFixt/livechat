import {
  chatStatusSchema,
  endChatInputSchema,
  sendMessageInputSchema,
  type ChatStatus,
  type EndChatInput,
  type SendMessageInput,
} from '@livechat/shared';
import { Router } from 'express';

import { authenticate } from '../middlewares/authenticate.js';
import {
  assertTenantAccess,
  requireStaffOrAdmin,
  resolveTenantFilter,
} from '../middlewares/authorize.js';
import { parsedBody, validate } from '../middlewares/validate.js';
import { asyncHandler } from '../utils/async-handler.js';

import type { Env } from '../config/env.js';
import type { ChatService } from '../services/index.js';
import type { Redis } from 'ioredis';

interface ChatsRouterDeps {
  env: Env;
  redis: Redis;
  chat: ChatService;
}

/**
 * Narrow a raw query param to a valid `ChatStatus`, or undefined.
 * @param q - The raw query value.
 * @returns A valid status, or undefined if absent/invalid.
 */
function parseStatusQuery(q: unknown): ChatStatus | undefined {
  if (typeof q !== 'string') return undefined;
  const parsed = chatStatusSchema.safeParse(q);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Build the `/chats` sub-router — staff/admin-facing chat management.
 * @param deps - Env, redis, chat service.
 * @returns Express router.
 */
export function buildChatsRouter(deps: ChatsRouterDeps): Router {
  const router = Router();
  router.use(authenticate({ env: deps.env, redis: deps.redis }));
  router.use(requireStaffOrAdmin());

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const tenantId = resolveTenantFilter(req, req.query.tenantId);
      const status = parseStatusQuery(req.query.status);
      const filter: Parameters<ChatService['list']>[0] = {};
      if (tenantId !== undefined) filter.tenantId = tenantId;
      if (status !== undefined) filter.status = status;
      const chats = await deps.chat.list(filter);
      res.json({ success: true, data: chats });
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const id = req.params.id;
      if (typeof id !== 'string') return;
      const chat = await deps.chat.getById(id);
      assertTenantAccess(req, chat.tenantId);
      res.json({ success: true, data: chat });
    }),
  );

  router.get(
    '/:id/messages',
    asyncHandler(async (req, res) => {
      const id = req.params.id;
      if (typeof id !== 'string') return;
      // Resolve the chat first so its owning tenant can gate the transcript.
      const chat = await deps.chat.getById(id);
      assertTenantAccess(req, chat.tenantId);
      const messages = await deps.chat.listMessages(id);
      res.json({ success: true, data: messages });
    }),
  );

  router.post(
    '/:id/messages',
    validate({ body: sendMessageInputSchema }),
    asyncHandler(async (req, res) => {
      const id = req.params.id;
      if (typeof id !== 'string' || req.user === undefined) return;
      const target = await deps.chat.getById(id);
      assertTenantAccess(req, target.tenantId);
      const body = parsedBody(req, sendMessageInputSchema) satisfies SendMessageInput;
      const message = await deps.chat.sendMessage({
        chatId: id,
        senderKind: 'user',
        senderUserId: req.user.id,
        body: body.body,
      });
      res.status(201).json({ success: true, data: message });
    }),
  );

  router.post(
    '/:id/accept',
    asyncHandler(async (req, res) => {
      const id = req.params.id;
      if (typeof id !== 'string' || req.user === undefined) return;
      const target = await deps.chat.getById(id);
      assertTenantAccess(req, target.tenantId);
      const chat = await deps.chat.assign(id, req.user.id);
      res.json({ success: true, data: chat });
    }),
  );

  router.post(
    '/:id/end',
    validate({ body: endChatInputSchema }),
    asyncHandler(async (req, res) => {
      const id = req.params.id;
      if (typeof id !== 'string') return;
      const target = await deps.chat.getById(id);
      assertTenantAccess(req, target.tenantId);
      const body = parsedBody(req, endChatInputSchema) satisfies EndChatInput;
      const chat = await deps.chat.endChat({ chatId: id, endedBy: body.endedBy });
      res.json({ success: true, data: chat });
    }),
  );

  return router;
}
