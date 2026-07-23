import {
  changePasswordInputSchema,
  forgotPasswordInputSchema,
  loginInputSchema,
  registerInputSchema,
  resetPasswordInputSchema,
  type ChangePasswordInput,
  type ForgotPasswordInput,
  type LoginInput,
  type RegisterInput,
  type ResetPasswordInput,
} from '@livechat/shared';
import { Router, type RequestHandler } from 'express';

import { authenticate } from '../middlewares/authenticate.js';
import { createAuthLimiter } from '../middlewares/rate-limit.js';
import { parsedBody, validate } from '../middlewares/validate.js';
import { asyncHandler } from '../utils/async-handler.js';
import { recordAudit } from '../utils/audit.js';

import type { Env } from '../config/env.js';
import type { AuditService, AuthService } from '../services/index.js';
import type { Redis } from 'ioredis';

interface AuthRouterDeps {
  env: Env;
  redis: Redis;
  auth: AuthService;
  audit: AuditService;
  /** Skip auth-specific rate limiting (for unit tests). */
  skipRateLimit?: boolean;
}

const noopMiddleware: RequestHandler = (_req, _res, next) => {
  next();
};

/**
 * Build the `/auth` sub-router.
 * @param deps - Env, redis, and auth service.
 * @returns Express router.
 */
export function buildAuthRouter(deps: AuthRouterDeps): Router {
  const router = Router();
  const authLimit: RequestHandler =
    deps.skipRateLimit === true ? noopMiddleware : createAuthLimiter(deps.redis);
  const requireAuth: RequestHandler = authenticate({ env: deps.env, redis: deps.redis });

  router.post(
    '/register',
    authLimit,
    validate({ body: registerInputSchema }),
    asyncHandler(async (req, res) => {
      const body = parsedBody(req, registerInputSchema) satisfies RegisterInput;
      const user = await deps.auth.register(body);
      await recordAudit(deps.audit, req, {
        action: 'auth.register',
        resourceType: 'user',
        resourceId: user.id,
        userId: user.id,
        tenantId: user.tenantId,
      });
      res.status(201).json({ success: true, data: { user } });
    }),
  );

  router.post(
    '/login',
    authLimit,
    validate({ body: loginInputSchema }),
    asyncHandler(async (req, res) => {
      const body = parsedBody(req, loginInputSchema) satisfies LoginInput;
      const ua = req.header('user-agent');
      const loginArgs: Parameters<AuthService['login']>[0] = {
        email: body.email,
        password: body.password,
      };
      if (req.ip !== undefined) loginArgs.ipAddress = req.ip;
      if (ua !== undefined) loginArgs.userAgent = ua;
      // Audit the failure too — a run of these is the signal that matters.
      let result;
      try {
        result = await deps.auth.login(loginArgs);
      } catch (error) {
        await recordAudit(deps.audit, req, {
          action: 'auth.login_failed',
          resourceType: 'user',
          userId: null,
          tenantId: null,
          metadata: { email: body.email },
        });
        throw error;
      }
      await recordAudit(deps.audit, req, {
        action: 'auth.login',
        resourceType: 'user',
        resourceId: result.user.id,
        userId: result.user.id,
        tenantId: result.user.tenantId,
      });
      res.json({ success: true, data: result });
    }),
  );

  router.post(
    '/logout',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (req.user === undefined || req.tokenJti === undefined) return;
      await deps.auth.logout(req.user.id, req.tokenJti);
      await recordAudit(deps.audit, req, { action: 'auth.logout', resourceType: 'user' });
      res.json({ success: true });
    }),
  );

  router.post(
    '/refresh-token',
    asyncHandler(async (req, res) => {
      const { refreshToken } = req.body as { refreshToken?: string };
      if (refreshToken === undefined) {
        res.status(400).json({ success: false, message: 'refreshToken required' });
        return;
      }
      const tokens = await deps.auth.refresh(refreshToken);
      res.json({ success: true, data: tokens });
    }),
  );

  router.post(
    '/forgot-password',
    authLimit,
    validate({ body: forgotPasswordInputSchema }),
    asyncHandler(async (req, res) => {
      const body = parsedBody(req, forgotPasswordInputSchema) satisfies ForgotPasswordInput;
      await deps.auth.forgotPassword(body.email);
      await recordAudit(deps.audit, req, {
        action: 'auth.password_reset_requested',
        resourceType: 'user',
        userId: null,
        tenantId: null,
        metadata: { email: body.email },
      });
      res.json({
        success: true,
        message: 'If the email exists, a reset link has been sent',
      });
    }),
  );

  router.post(
    '/reset-password',
    validate({ body: resetPasswordInputSchema }),
    asyncHandler(async (req, res) => {
      const body = parsedBody(req, resetPasswordInputSchema) satisfies ResetPasswordInput;
      await deps.auth.resetPassword(body.token, body.password);
      await recordAudit(deps.audit, req, {
        action: 'auth.password_reset',
        resourceType: 'user',
        userId: null,
        tenantId: null,
      });
      res.json({ success: true, message: 'Password reset successfully' });
    }),
  );

  router.get(
    '/verify-email/:token',
    asyncHandler(async (req, res) => {
      const token = req.params.token;
      if (typeof token !== 'string') {
        res.status(400).json({ success: false, message: 'token required' });
        return;
      }
      await deps.auth.verifyEmail(token);
      await recordAudit(deps.audit, req, {
        action: 'auth.email_verified',
        resourceType: 'user',
        userId: null,
        tenantId: null,
      });
      res.json({ success: true, message: 'Email verified successfully' });
    }),
  );

  router.put(
    '/change-password',
    requireAuth,
    validate({ body: changePasswordInputSchema }),
    asyncHandler(async (req, res) => {
      const body = parsedBody(req, changePasswordInputSchema) satisfies ChangePasswordInput;
      if (req.user === undefined) return;
      await deps.auth.changePassword(req.user.id, body.currentPassword, body.newPassword);
      await recordAudit(deps.audit, req, {
        action: 'auth.password_changed',
        resourceType: 'user',
        resourceId: req.user.id,
      });
      res.json({ success: true, message: 'Password changed successfully' });
    }),
  );

  router.get(
    '/me',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (req.user === undefined) return;
      const me = await deps.auth.getMe(req.user.id);
      res.json({ success: true, data: me });
    }),
  );

  return router;
}
