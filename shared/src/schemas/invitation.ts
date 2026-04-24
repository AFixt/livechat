import { z } from 'zod';

import { roleSchema } from './role.js';

/**
 * Invitation status enum — matches the `invitations.status` ENUM column.
 */
export const invitationStatusSchema = z.enum(['pending', 'accepted', 'expired', 'revoked']);
/**
 * Invitation status value.
 */
export type InvitationStatus = z.infer<typeof invitationStatusSchema>;

/**
 * Public, safe representation of an invitation returned to clients.
 * The raw token is NEVER serialized here — it's only included in the email.
 */
export const invitationSafeSchema = z.object({
  id: z.uuid(),
  inc: z.number().int().positive(),
  tenantId: z.uuid().nullable(),
  email: z.email(),
  name: z.string().max(200).nullable(),
  role: roleSchema,
  status: invitationStatusSchema,
  invitedBy: z.uuid(),
  expiresAt: z.iso.datetime(),
  acceptedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
/**
 * Public, safe invitation object (no raw token).
 */
export type InvitationSafe = z.infer<typeof invitationSafeSchema>;

/**
 * Input schema for `POST /invitations`.
 */
export const createInvitationInputSchema = z.object({
  email: z.email().max(255),
  name: z.string().max(200).optional(),
  role: roleSchema,
  tenantId: z.uuid().nullable().optional(),
  expiresInDays: z.number().int().min(1).max(30).default(7),
});
/**
 * Input for creating an invitation.
 */
export type CreateInvitationInput = z.infer<typeof createInvitationInputSchema>;
