import { randomBytes, randomUUID } from 'node:crypto';

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

import { Invitation, JwtBlacklist, User, UserSession } from '../models/index.js';
import { ApiError } from '../utils/api-error.js';

import { generateAccessToken, generateRefreshToken } from './tokens.js';

import type { UserSafe } from '@livechat/shared';
import type { Redis } from 'ioredis';
import type { Env } from '../config/env.js';
import type { EmailService } from './email-service.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const VERIFY_TTL_MS = DAY_MS;
const RESET_TTL_MS = 60 * 60 * 1000;
const SESSION_TTL_MS = 7 * DAY_MS;
const ACCESS_BLACKLIST_TTL_S = 3600;

interface AuthDeps {
  env: Env;
  redis: Redis;
  email: EmailService;
}

interface LoginInput {
  email: string;
  password: string;
  ipAddress?: string;
  userAgent?: string;
}

interface LoginResult {
  user: UserSafe;
  accessToken: string;
  refreshToken: string;
}

interface RegisterInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  token: string;
}

/**
 * Build the auth service bound to env, redis, and the email service.
 * @param deps - Dependencies.
 * @returns An object with every auth operation.
 */
export function createAuthService(deps: AuthDeps) {
  return {
    /**
     * Register a new account via a valid invitation token.
     * @param input - Registration input.
     * @returns The created user (safe).
     */
    async register(input: RegisterInput): Promise<UserSafe> {
      const invitation = await Invitation.findOne({
        where: { token: input.token, status: 'pending' },
      });
      if (invitation === null) throw ApiError.badRequest('Invalid or expired invitation');
      if (invitation.isExpired()) {
        await invitation.update({ status: 'expired' });
        throw ApiError.badRequest('Invitation has expired');
      }
      if (invitation.email.toLowerCase() !== input.email.toLowerCase()) {
        throw ApiError.badRequest('Email does not match invitation');
      }
      const existing = await User.findOne({
        where: { email: input.email.toLowerCase() },
      });
      if (existing !== null) throw ApiError.conflict('Email already registered');

      const verificationToken = randomBytes(32).toString('hex');
      const user = await User.create({
        email: input.email,
        passwordHash: input.password,
        firstName: input.firstName,
        lastName: input.lastName,
        role: invitation.role,
        tenantId: invitation.tenantId,
        status: 'active',
        emailVerified: false,
        emailVerificationToken: verificationToken,
        emailVerificationExpires: new Date(Date.now() + VERIFY_TTL_MS),
      });
      await invitation.update({ status: 'accepted', acceptedAt: new Date() });
      await deps.email.sendVerificationEmail(user, verificationToken);
      return user.toSafeJSON();
    },

    /**
     * Authenticate by email + password. Enforces account lockout.
     * @param input - Login input with optional ip/ua.
     * @returns User (safe), access token, refresh token.
     */
    async login(input: LoginInput): Promise<LoginResult> {
      const user = await User.findOne({
        where: { email: input.email.toLowerCase() },
      });
      if (user === null) throw ApiError.unauthorized('Invalid email or password');
      if (user.isLocked()) {
        throw ApiError.forbidden('Account is temporarily locked. Try again later.');
      }
      if (user.status !== 'active') {
        throw ApiError.forbidden('Account is not active');
      }
      const matches = await user.comparePassword(input.password);
      if (!matches) {
        await user.incrementFailedAttempts();
        throw ApiError.unauthorized('Invalid email or password');
      }
      await user.resetFailedAttempts();
      user.lastLoginAt = new Date();
      await user.save();

      const access = generateAccessToken(user, deps.env);
      const refresh = generateRefreshToken(user, deps.env);
      const refreshHash = await bcrypt.hash(refresh.token, 10);
      await UserSession.create({
        userId: user.id,
        sessionId: randomUUID(),
        refreshTokenHash: refreshHash,
        jti: refresh.jti,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        lastActivityAt: new Date(),
      });
      return {
        user: user.toSafeJSON(),
        accessToken: access.token,
        refreshToken: refresh.token,
      };
    },

    /**
     * Revoke the current access token's JTI and destroy all sessions for
     * the user.
     * @param userId - Logged-in user id.
     * @param tokenJti - JTI of the access token being revoked.
     */
    async logout(userId: string, tokenJti: string): Promise<void> {
      await JwtBlacklist.create({
        userId,
        jti: tokenJti,
        expiresAt: new Date(Date.now() + ACCESS_BLACKLIST_TTL_S * 1000),
      });
      await deps.redis.set(`bl:${tokenJti}`, '1', 'EX', ACCESS_BLACKLIST_TTL_S);
      await UserSession.destroy({ where: { userId } });
    },

    /**
     * Rotate a refresh token: verify, re-hash, update session, return new pair.
     * @param refreshToken - The current refresh token.
     * @returns New access + refresh tokens.
     */
    async refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
      interface RefreshPayload {
        sub: string;
        jti: string;
        type: string;
      }
      let decoded: RefreshPayload;
      try {
        decoded = jwt.verify(refreshToken, deps.env.JWT_REFRESH_SECRET) as RefreshPayload;
      } catch {
        throw ApiError.unauthorized('Invalid refresh token');
      }
      if (decoded.type !== 'refresh') throw ApiError.unauthorized('Invalid token type');

      const session = await UserSession.findOne({
        where: { userId: decoded.sub, jti: decoded.jti },
      });
      if (session === null) throw ApiError.unauthorized('Session not found');
      if (new Date() > new Date(session.expiresAt)) {
        await session.destroy();
        throw ApiError.unauthorized('Session expired');
      }
      const valid = await bcrypt.compare(refreshToken, session.refreshTokenHash);
      if (!valid) {
        await session.destroy();
        throw ApiError.unauthorized('Invalid refresh token');
      }
      const user = await User.findByPk(decoded.sub);
      if (user?.status !== 'active') {
        throw ApiError.unauthorized('User not found or inactive');
      }
      const access = generateAccessToken(user, deps.env);
      const next = generateRefreshToken(user, deps.env);
      const hash = await bcrypt.hash(next.token, 10);
      await session.update({
        refreshTokenHash: hash,
        jti: next.jti,
        lastActivityAt: new Date(),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      });
      return { accessToken: access.token, refreshToken: next.token };
    },

    /**
     * Verify an email address with a token from the verification email.
     * @param token - The verification token.
     */
    async verifyEmail(token: string): Promise<void> {
      const user = await User.findOne({ where: { emailVerificationToken: token } });
      if (user === null) throw ApiError.badRequest('Invalid verification token');
      if (
        user.emailVerificationExpires !== null &&
        new Date() > new Date(user.emailVerificationExpires)
      ) {
        throw ApiError.badRequest('Verification token has expired');
      }
      await user.update({
        emailVerified: true,
        emailVerificationToken: null,
        emailVerificationExpires: null,
      });
    },

    /**
     * Initiate a password reset. Always resolves without revealing whether
     * the email exists.
     * @param email - Email requesting reset.
     */
    async forgotPassword(email: string): Promise<void> {
      const user = await User.findOne({ where: { email: email.toLowerCase() } });
      if (user === null) return;
      const token = randomBytes(32).toString('hex');
      await user.update({
        passwordResetToken: token,
        passwordResetExpires: new Date(Date.now() + RESET_TTL_MS),
      });
      await deps.email.sendPasswordResetEmail(user, token);
    },

    /**
     * Complete a password reset. Invalidates all sessions.
     * @param token - The reset token.
     * @param password - The new password.
     */
    async resetPassword(token: string, password: string): Promise<void> {
      const user = await User.findOne({ where: { passwordResetToken: token } });
      if (user === null) throw ApiError.badRequest('Invalid reset token');
      if (user.passwordResetExpires !== null && new Date() > new Date(user.passwordResetExpires)) {
        throw ApiError.badRequest('Reset token has expired');
      }
      user.passwordHash = password;
      user.passwordResetToken = null;
      user.passwordResetExpires = null;
      await user.save();
      await UserSession.destroy({ where: { userId: user.id } });
    },

    /**
     * Change the password for a logged-in user. Invalidates all sessions.
     * @param userId - The user's id.
     * @param currentPassword - Existing password (for confirmation).
     * @param newPassword - New password.
     */
    async changePassword(
      userId: string,
      currentPassword: string,
      newPassword: string,
    ): Promise<void> {
      const user = await User.findByPk(userId);
      if (user === null) throw ApiError.notFound('User not found');
      const matches = await user.comparePassword(currentPassword);
      if (!matches) throw ApiError.badRequest('Current password is incorrect');
      user.passwordHash = newPassword;
      await user.save();
      await UserSession.destroy({ where: { userId } });
    },

    /**
     * Return the currently-authenticated user with tenant info.
     * @param userId - The user's id.
     * @returns The safe user (plus `tenant` if they belong to one).
     */
    async getMe(
      userId: string,
    ): Promise<UserSafe & { tenant?: { id: string; name: string; slug: string } }> {
      const user = await User.findByPk(userId, {
        include: [{ association: 'tenant', attributes: ['id', 'name', 'slug'] }],
      });
      if (user === null) throw ApiError.notFound('User not found');
      const safe = user.toSafeJSON();
      const tenant = (
        user as User & {
          tenant?: { id: string; name: string; slug: string };
        }
      ).tenant;
      return tenant === undefined ? safe : { ...safe, tenant };
    },
  };
}

/**
 * Shape of the auth service.
 */
export type AuthService = ReturnType<typeof createAuthService>;
