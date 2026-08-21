import {
  createInvitationInputSchema,
  createTenantInputSchema,
  invitationSafeSchema,
  tenantSchema,
  updateTenantInputSchema,
  updateUserInputSchema,
  userSafeSchema,
} from '@livechat/shared';
import { z } from 'zod';

import { openApiRegistry } from '../../config/swagger.js';

import { ackEnvelope, bearerSecurity, body, envelope, errors, json } from './support.js';

const byId = z.object({ id: z.uuid() });

/**
 * Every operation here sits behind `authenticate` + `requireRole('super_admin',
 * 'admin')`. A tenant-scoped admin sees only their own tenant, so 404 rather
 * than 403 is the answer for anything outside their scope (#43).
 */
const adminNote = 'Admin only. A tenant-scoped admin sees only their own tenant’s records.';
const superAdminNote = 'Restricted further to `super_admin`.';

openApiRegistry.registerPath({
  method: 'get',
  path: '/users',
  summary: 'List users',
  description: adminNote,
  tags: ['users'],
  security: bearerSecurity(),
  request: { query: z.object({ tenantId: z.uuid().optional() }) },
  responses: {
    200: json('Users in scope.', envelope(z.array(userSafeSchema))),
    ...errors(401, 403),
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/users/{id}',
  summary: 'One user',
  description: adminNote,
  tags: ['users'],
  security: bearerSecurity(),
  request: { params: byId },
  responses: { 200: json('The user.', envelope(userSafeSchema)), ...errors(401, 403, 404) },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/users/{id}',
  summary: 'Update a user',
  description: adminNote,
  tags: ['users'],
  security: bearerSecurity(),
  request: { params: byId, body: body(updateUserInputSchema) },
  responses: {
    200: json('The updated user.', envelope(userSafeSchema)),
    ...errors(400, 401, 403, 404),
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/tenants',
  summary: 'List tenants',
  description: adminNote,
  tags: ['tenants'],
  security: bearerSecurity(),
  responses: {
    200: json('Tenants in scope.', envelope(z.array(tenantSchema))),
    ...errors(401, 403),
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/tenants',
  summary: 'Provision a tenant',
  description: superAdminNote,
  tags: ['tenants'],
  security: bearerSecurity(),
  request: { body: body(createTenantInputSchema) },
  responses: {
    201: json('The new tenant.', envelope(tenantSchema)),
    ...errors(400, 401, 403, 409),
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/tenants/{id}',
  summary: 'One tenant',
  description: adminNote,
  tags: ['tenants'],
  security: bearerSecurity(),
  request: { params: byId },
  responses: { 200: json('The tenant.', envelope(tenantSchema)), ...errors(401, 403, 404) },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/tenants/{id}',
  summary: 'Update a tenant',
  description: superAdminNote,
  tags: ['tenants'],
  security: bearerSecurity(),
  request: { params: byId, body: body(updateTenantInputSchema) },
  responses: {
    200: json('The updated tenant.', envelope(tenantSchema)),
    ...errors(400, 401, 403, 404),
  },
});

openApiRegistry.registerPath({
  method: 'delete',
  path: '/tenants/{id}',
  summary: 'Archive a tenant',
  description: `${superAdminNote} Soft-delete — the row is retained (paranoid).`,
  tags: ['tenants'],
  security: bearerSecurity(),
  request: { params: byId },
  responses: { 200: json('Archived.', ackEnvelope()), ...errors(401, 403, 404) },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/tenants/{id}/rotate-embed-secret',
  summary: 'Rotate the tenant’s widget embed secret',
  description:
    `${superAdminNote} The new secret is returned exactly once and is never ` +
    'written to the audit log.',
  tags: ['tenants'],
  security: bearerSecurity(),
  request: { params: byId },
  responses: {
    200: json('The new secret.', envelope(z.object({ embedSecret: z.string() }))),
    ...errors(401, 403, 404),
  },
});

openApiRegistry.registerPath({
  method: 'put',
  path: '/tenants/{id}/allowed-origins',
  summary: 'Replace the tenant’s allowed widget origins',
  description: `${superAdminNote} Drives the per-tenant CORS policy (#74).`,
  tags: ['tenants'],
  security: bearerSecurity(),
  request: { params: byId, body: body(z.object({ origins: z.array(z.url()).nullable() })) },
  responses: {
    200: json('The updated tenant.', envelope(tenantSchema)),
    ...errors(400, 401, 403, 404),
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/invitations',
  summary: 'List invitations',
  description: adminNote,
  tags: ['invitations'],
  security: bearerSecurity(),
  request: { query: z.object({ tenantId: z.uuid().optional() }) },
  responses: {
    200: json('Invitations in scope.', envelope(z.array(invitationSafeSchema))),
    ...errors(401, 403),
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/invitations',
  summary: 'Invite a user',
  description: `${adminNote} Registration is only possible against one of these.`,
  tags: ['invitations'],
  security: bearerSecurity(),
  request: { body: body(createInvitationInputSchema) },
  responses: {
    201: json('The invitation.', envelope(invitationSafeSchema)),
    ...errors(400, 401, 403, 409),
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/invitations/{id}/revoke',
  summary: 'Revoke an invitation',
  description: adminNote,
  tags: ['invitations'],
  security: bearerSecurity(),
  request: { params: byId },
  responses: { 200: json('Revoked.', ackEnvelope()), ...errors(401, 403, 404, 409) },
});
