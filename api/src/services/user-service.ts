import { User } from '../models/index.js';
import { ApiError } from '../utils/api-error.js';

import { assertCanChangeRole, type RoleGrantor } from './role-policy.js';

import type { UpdateUserInput, UserSafe } from '@livechat/shared';

/**
 * Copy the non-privileged fields of a patch onto a user. Role is excluded on
 * purpose: it goes through the role ceiling first.
 * @param user - The user being updated.
 * @param input - Validated patch input.
 */
function applyProfilePatch(user: User, input: UpdateUserInput): void {
  if (input.firstName !== undefined) user.firstName = input.firstName;
  if (input.lastName !== undefined) user.lastName = input.lastName;
  if (input.status !== undefined) user.status = input.status;
  if (input.phone !== undefined) user.phone = input.phone;
  if (input.timezone !== undefined) user.timezone = input.timezone;
  if (input.language !== undefined) user.language = input.language;
  if (input.preferences !== undefined) user.preferences = input.preferences;
}

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
     *
     * A role change is checked against the caller's ceiling here, in the
     * service, so every path that updates users is covered (#195).
     * @param id - User UUID.
     * @param input - Validated patch input.
     * @param actor - The caller making the change.
     * @returns Updated safe user.
     * @throws {ApiError} 403 when a role change exceeds the caller's authority.
     */
    async update(id: string, input: UpdateUserInput, actor: RoleGrantor): Promise<UserSafe> {
      const user = await User.findByPk(id);
      if (user === null) throw ApiError.notFound('User not found');
      if (input.role !== undefined) {
        assertCanChangeRole(actor, user, input.role);
        user.role = input.role;
      }
      applyProfilePatch(user, input);
      await user.save();
      return user.toSafeJSON();
    },
  };
}

/**
 * Shape of the user service.
 */
export type UserService = ReturnType<typeof createUserService>;
