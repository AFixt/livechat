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
import { requireStaffOrAdmin, resolveTenantFilter } from '../middlewares/authorize.js';
import { parsedBody, validate } from '../middlewares/validate.js';
import { asyncHandler } from '../utils/async-handler.js';

import type { Env } from '../config/env.js';
import type { ChatCaller, ChatService } from '../services/index.js';
import type { Request } from 'express';
import type { Redis } from 'ioredis';

// Side-effect import: registers this router's OpenAPI paths (#119).
import './openapi/chats.js';

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
 * Derive the chat-access scope for the authenticated staff caller so the
 * service can confine every lookup to their tenant. An untenanted AFixt
 * operator (`tenantId === null`) spans every tenant (#72).
 * @param req - The authenticated request (guaranteed a user by `authenticate`).
 * @returns The staff caller scope.
 */
function staffCaller(req: Request): ChatCaller {
  return { kind: 'staff', tenantId: req.user?.tenantId ?? null };
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
      // The service scopes the lookup to the caller's tenant, so the HTTP and
      // socket paths share one enforcement point (#72).
      const chat = await deps.chat.getById(id, staffCaller(req));
      res.json({ success: true, data: chat });
    }),
  );

  router.get(
    '/:id/messages',
    asyncHandler(async (req, res) => {
      const id = req.params.id;
      if (typeof id !== 'string') return;
      // Resolve the chat (tenant-scoped) first so its owning tenant gates the
      // transcript before any message rows are read.
      await deps.chat.getById(id, staffCaller(req));
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
      const body = parsedBody(req, sendMessageInputSchema) satisfies SendMessageInput;
      const message = await deps.chat.sendMessage(
        {
          chatId: id,
          senderKind: 'user',
          senderUserId: req.user.id,
          body: body.body,
        },
        staffCaller(req),
      );
      res.status(201).json({ success: true, data: message });
    }),
  );

  router.post(
    '/:id/accept',
    asyncHandler(async (req, res) => {
      const id = req.params.id;
      if (typeof id !== 'string' || req.user === undefined) return;
      const chat = await deps.chat.assign(id, req.user.id, staffCaller(req));
      res.json({ success: true, data: chat });
    }),
  );

  router.post(
    '/:id/end',
    validate({ body: endChatInputSchema }),
    asyncHandler(async (req, res) => {
      const id = req.params.id;
      if (typeof id !== 'string') return;
      const body = parsedBody(req, endChatInputSchema) satisfies EndChatInput;
      const chat = await deps.chat.endChat({ chatId: id, endedBy: body.endedBy }, staffCaller(req));
      res.json({ success: true, data: chat });
    }),
  );

  return router;
}
