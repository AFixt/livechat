import jwt from 'jsonwebtoken';

import { User } from '../models/index.js';
import { assertTenantUsable } from '../services/tenant-access.js';
import { ApiError } from '../utils/api-error.js';

import type { Env } from '../config/env.js';
import type { RequestHandler } from 'express';
import type { Redis } from 'ioredis';

declare module 'express-serve-static-core' {
  interface Request {
    /** Authenticated user — populated by {@link authenticate}. */
    user?: User;
    /** JTI of the access token used — populated by {@link authenticate}. */
    tokenJti?: string;
  }
}

interface AuthDeps {
  env: Pick<Env, 'JWT_ACCESS_SECRET'>;
  redis: Redis;
  /**
   * Enforce the tenant lifecycle rule (#197). True everywhere except logout,
   * so a user of a suspended tenant can still end their session — otherwise
   * it would survive, and revive when the tenant is reactivated.
   */
  checkTenant?: boolean;
}

interface AccessTokenPayload {
  sub: string;
  email: string;
  role: string;
  tenantId: string | null;
  jti: string;
}

/**
 * Extract the token portion of an `Authorization: Bearer <token>` header,
 * throwing 401 if the header is absent or malformed.
 * @param req - Anything with a `header` accessor.
 * @returns The bearer token string.
 */
function parseBearer(req: { header(name: string): string | undefined }): string {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) {
    throw ApiError.unauthorized('Authentication required');
  }
  return header.slice('Bearer '.length);
}

/**
 * Verify + decode an access JWT, throwing 401 on any failure.
 * @param token - The access token.
 * @param secret - Shared JWT secret.
 * @returns The decoded payload.
 */
function verifyAccess(token: string, secret: string): AccessTokenPayload {
  try {
    return jwt.verify(token, secret, { algorithms: ['HS256'] }) as AccessTokenPayload;
  } catch {
    throw ApiError.unauthorized('Invalid or expired token');
  }
}

/** The authenticated principal resolved from an access token. */
export interface AuthenticatedAccess {
  /** The loaded, active User. */
  user: User;
  /** JTI of the presented access token. */
  jti: string;
}

/**
 * Verify an access token the whole way: signature, Redis JTI blacklist,
 * user existence + `active` status, and tenant status + expiry. Shared by the
 * HTTP {@link authenticate} middleware and the Socket.IO handshake so the two
 * can never diverge (issue #72) — a blacklisted, deactivated, or
 * suspended/expired-tenant token is refused on both paths.
 * @param deps - Env + Redis dependencies.
 * @param token - The raw access token (no `Bearer ` prefix).
 * @returns The authenticated user and the token's JTI.
 * @throws {ApiError} 401/403 on any verification failure.
 */
export async function authenticateAccessToken(
  deps: AuthDeps,
  token: string,
): Promise<AuthenticatedAccess> {
  const decoded = verifyAccess(token, deps.env.JWT_ACCESS_SECRET);

  const blacklisted = await deps.redis.get(`bl:${decoded.jti}`);
  if (blacklisted !== null) throw ApiError.unauthorized('Token has been revoked');

  const user = await User.findByPk(decoded.sub);
  if (user === null) throw ApiError.unauthorized('User not found');
  if (user.status !== 'active') throw ApiError.forbidden('Account is not active');

  if (deps.checkTenant !== false) await assertTenantUsable(user);

  return { user, jti: decoded.jti };
}

/**
 * Authenticate the bearer JWT, reject blacklisted or expired tokens, load
 * the User, and enforce the tenant lifecycle rule for tenant users.
 * @param deps - Env + Redis dependencies.
 * @returns Express middleware.
 */
export function authenticate(deps: AuthDeps): RequestHandler {
  return (req, _res, next) => {
    (async () => {
      const token = parseBearer(req);
      const { user, jti } = await authenticateAccessToken(deps, token);
      req.user = user;
      req.tokenJti = jti;
      next();
    })().catch(next);
  };
}
