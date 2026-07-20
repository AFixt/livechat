import { User } from '../models/index.js';
import { ApiError } from '../utils/api-error.js';

import type { UpdateUserInput, UserSafe } from '@livechat/shared';

/**
 * Build the user service.
 * @returns Admin-scoped user management methods.
 */
export function createUserService() {
  return {
    /**
     * List users (optionally scoped to a tenant).
     * @param tenantId - If provided, only users of this tenant.
     * @returns Users as safe JSON.
     */
    async list(tenantId?: string): Promise<UserSafe[]> {
      const users = await User.findAll({
        where: tenantId === undefined ? {} : { tenantId },
        order: [['inc', 'ASC']],
      });
      return users.map((u) => u.toSafeJSON());
    },

    /**
     * Fetch a user by id.
     * @param id - User UUID.
     * @returns Safe user.
     */
    async getById(id: string): Promise<UserSafe> {
      const user = await User.findByPk(id);
      if (user === null) throw ApiError.notFound('User not found');
      return user.toSafeJSON();
    },

    /**
     * Update fields on a user (admin-only; cannot change email or password).
     * @param id - User UUID.
     * @param input - Validated patch input.
     * @returns Updated safe user.
     */
    async update(id: string, input: UpdateUserInput): Promise<UserSafe> {
      const user = await User.findByPk(id);
      if (user === null) throw ApiError.notFound('User not found');
      if (input.firstName !== undefined) user.firstName = input.firstName;
      if (input.lastName !== undefined) user.lastName = input.lastName;
      if (input.role !== undefined) user.role = input.role;
      if (input.status !== undefined) user.status = input.status;
      if (input.phone !== undefined) user.phone = input.phone;
      if (input.timezone !== undefined) user.timezone = input.timezone;
      if (input.language !== undefined) user.language = input.language;
      if (input.preferences !== undefined) user.preferences = input.preferences;
      await user.save();
      return user.toSafeJSON();
    },
  };
}

/**
 * Shape of the user service.
 */
export type UserService = ReturnType<typeof createUserService>;
