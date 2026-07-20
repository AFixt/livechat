import { randomUUID } from 'node:crypto';

import jwt, { type SignOptions } from 'jsonwebtoken';

import type { Env } from '../config/env.js';
import type { User } from '../models/index.js';

interface GeneratedToken {
  token: string;
  jti: string;
}

/**
 * Sign a short-lived access JWT carrying user identity + role + tenant.
 * @param user - Authenticated user.
 * @param env - Env with JWT access config.
 * @returns The signed token plus its JTI.
 */
export function generateAccessToken(
  user: Pick<User, 'id' | 'email' | 'role' | 'tenantId'>,
  env: Pick<Env, 'JWT_ACCESS_SECRET' | 'JWT_ACCESS_EXPIRES_IN'>,
): GeneratedToken {
  const jti = randomUUID();
  const options = { expiresIn: env.JWT_ACCESS_EXPIRES_IN } as SignOptions;
  const token = jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      jti,
    },
    env.JWT_ACCESS_SECRET,
    options,
  );
  return { token, jti };
}

/**
 * Sign a refresh JWT, rotated on use and stored hashed in `user_sessions`.
 * @param user - Authenticated user.
 * @param env - Env with JWT refresh config.
 * @returns The signed token plus its JTI.
 */
export function generateRefreshToken(
  user: Pick<User, 'id'>,
  env: Pick<Env, 'JWT_REFRESH_SECRET' | 'JWT_REFRESH_EXPIRES_IN'>,
): GeneratedToken {
  const jti = randomUUID();
  const options = { expiresIn: env.JWT_REFRESH_EXPIRES_IN } as SignOptions;
  const token = jwt.sign({ sub: user.id, jti, type: 'refresh' }, env.JWT_REFRESH_SECRET, options);
  return { token, jti };
}
