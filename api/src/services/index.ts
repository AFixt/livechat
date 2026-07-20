import { createAuditService } from './audit-service.js';
import { createAuthService } from './auth-service.js';
import { createChatService } from './chat-service.js';
import { createEmailService } from './email-service.js';
import { createInvitationService } from './invitation-service.js';
import { createPresenceService } from './presence-service.js';
import { createTenantService } from './tenant-service.js';
import { createUserService } from './user-service.js';
import { createVisitorSessionService } from './visitor-session-service.js';

import type { AuditService } from './audit-service.js';
import type { AuthService } from './auth-service.js';
import type { ChatService } from './chat-service.js';
import type { EmailService } from './email-service.js';
import type { InvitationService } from './invitation-service.js';
import type { PresenceService } from './presence-service.js';
import type { TenantService } from './tenant-service.js';
import type { UserService } from './user-service.js';
import type { VisitorSessionService } from './visitor-session-service.js';
import type { Env } from '../config/env.js';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';

export type {
  AuditService,
  AuthService,
  ChatService,
  EmailService,
  InvitationService,
  PresenceService,
  TenantService,
  UserService,
  VisitorSessionService,
};

/**
 * Aggregate of every service the API exposes — injected into route factories.
 */
export interface Services {
  /** Auth (register/login/logout/refresh/verify/forgot/reset/change/getMe). */
  auth: AuthService;
  /** Tenant CRUD. */
  tenant: TenantService;
  /** User admin. */
  user: UserService;
  /** Invitation management. */
  invitation: InvitationService;
  /** Audit trail. */
  audit: AuditService;
  /** Outgoing email. */
  email: EmailService;
  /** Visitor session lifecycle + signed cookie. */
  visitorSession: VisitorSessionService;
  /** Chats + messages. */
  chat: ChatService;
  /** Staff availability + visitor presence (Redis-backed). */
  presence: PresenceService;
}

interface ServicesDeps {
  env: Env;
  logger: Logger;
  redis: Redis;
}

/**
 * Construct every service with shared dependencies.
 * @param deps - Env + logger + redis.
 * @returns A {@link Services} bag.
 */
export function createServices(deps: ServicesDeps): Services {
  const email = createEmailService({ env: deps.env, logger: deps.logger });
  const audit = createAuditService(deps.logger);
  const auth = createAuthService({ env: deps.env, redis: deps.redis, email });
  const tenant = createTenantService();
  const user = createUserService();
  const invitation = createInvitationService({ email });
  const visitorSession = createVisitorSessionService({ env: deps.env });
  const chat = createChatService();
  const presence = createPresenceService({ redis: deps.redis });
  return {
    auth,
    tenant,
    user,
    invitation,
    audit,
    email,
    visitorSession,
    chat,
    presence,
  };
}
