import { createAuditService } from './audit-service.js';
import { createAuthService } from './auth-service.js';
import { createEmailService } from './email-service.js';
import { createInvitationService } from './invitation-service.js';
import { createTenantService } from './tenant-service.js';
import { createUserService } from './user-service.js';

import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { Env } from '../config/env.js';
import type { AuditService } from './audit-service.js';
import type { AuthService } from './auth-service.js';
import type { EmailService } from './email-service.js';
import type { InvitationService } from './invitation-service.js';
import type { TenantService } from './tenant-service.js';
import type { UserService } from './user-service.js';

export type {
  AuditService,
  AuthService,
  EmailService,
  InvitationService,
  TenantService,
  UserService,
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
  return { auth, tenant, user, invitation, audit, email };
}
