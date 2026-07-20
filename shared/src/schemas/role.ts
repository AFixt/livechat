import { z } from 'zod';

/**
 * Zod schema for the four identity roles, mirroring AFixt/help-desk.
 * @remarks
 * `visitor` is not a role — visitors are represented by `VisitorSession` rows,
 * not `User` rows.
 */
export const roleSchema = z.enum(['super_admin', 'admin', 'staff', 'client']);

/**
 * Union of the four identity roles.
 */
export type Role = z.infer<typeof roleSchema>;

/**
 * Roles that can act on behalf of any tenant (support/admin views).
 */
export const staffOrAdminRoles = [
  'super_admin',
  'admin',
  'staff',
] as const satisfies readonly Role[];
