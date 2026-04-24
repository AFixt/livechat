import { z } from 'zod';

import { roleSchema } from './role.js';

/**
 * User account status enum — matches the `users.status` ENUM column.
 */
export const userStatusSchema = z.enum(['active', 'suspended', 'pending', 'deactivated']);
/**
 * User account status value.
 */
export type UserStatus = z.infer<typeof userStatusSchema>;

/**
 * Public, "safe" user — never contains password hash, tokens, or lockout
 * counters. Matches `User.toSafeJSON()`.
 */
export const userSafeSchema = z.object({
  id: z.uuid(),
  inc: z.number().int().positive(),
  email: z.email(),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  role: roleSchema,
  tenantId: z.uuid().nullable(),
  emailVerified: z.boolean(),
  status: userStatusSchema,
  lastLoginAt: z.iso.datetime().nullable(),
  phone: z.string().max(50).nullable(),
  timezone: z.string().max(50).nullable(),
  language: z.string().max(10).nullable(),
  avatarUrl: z.url().nullable(),
  preferences: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
/**
 * Public, safe user object.
 */
export type UserSafe = z.infer<typeof userSafeSchema>;

const passwordSchema = z.string().min(8, 'Password must be at least 8 characters').max(200);

/**
 * Input schema for `POST /auth/register`.
 */
export const registerInputSchema = z.object({
  email: z.email().max(255),
  password: passwordSchema,
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  token: z.string().min(1),
});
/**
 * Input for registering a new account via invitation.
 */
export type RegisterInput = z.infer<typeof registerInputSchema>;

/**
 * Input schema for `POST /auth/login`.
 */
export const loginInputSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});
/**
 * Input for logging in.
 */
export type LoginInput = z.infer<typeof loginInputSchema>;

/**
 * Input schema for `POST /auth/forgot-password`.
 */
export const forgotPasswordInputSchema = z.object({
  email: z.email(),
});
/**
 * Input for initiating a password reset.
 */
export type ForgotPasswordInput = z.infer<typeof forgotPasswordInputSchema>;

/**
 * Input schema for `POST /auth/reset-password`.
 */
export const resetPasswordInputSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
});
/**
 * Input for completing a password reset.
 */
export type ResetPasswordInput = z.infer<typeof resetPasswordInputSchema>;

/**
 * Input schema for `PUT /auth/change-password`.
 */
export const changePasswordInputSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});
/**
 * Input for changing a password while authenticated.
 */
export type ChangePasswordInput = z.infer<typeof changePasswordInputSchema>;

/**
 * Input schema for `PATCH /users/:id` — admin-scoped.
 */
export const updateUserInputSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  role: roleSchema.optional(),
  status: userStatusSchema.optional(),
  phone: z.string().max(50).nullable().optional(),
  timezone: z.string().max(50).nullable().optional(),
  language: z.string().max(10).nullable().optional(),
  preferences: z.record(z.string(), z.unknown()).nullable().optional(),
});
/**
 * Input for administratively updating a user.
 */
export type UpdateUserInput = z.infer<typeof updateUserInputSchema>;
