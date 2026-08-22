import {
  changePasswordInputSchema,
  forgotPasswordInputSchema,
  loginInputSchema,
  registerInputSchema,
  resetPasswordInputSchema,
  userSafeSchema,
} from '@livechat/shared';
import { z } from 'zod';

import { openApiRegistry } from '../../config/swagger.js';

import { ackEnvelope, bearerSecurity, body, envelope, errors, json } from './support.js';

const tokenPair = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  user: userSafeSchema,
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/auth/register',
  summary: 'Accept an invitation and create the user',
  description: 'Gated on a valid invitation token — there is no open sign-up.',
  tags: ['auth'],
  request: { body: body(registerInputSchema) },
  responses: {
    201: json('Registered; returns the new session.', envelope(tokenPair)),
    ...errors(400, 409, 429),
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/auth/login',
  summary: 'Exchange credentials for an access + refresh token pair',
  tags: ['auth'],
  request: { body: body(loginInputSchema) },
  responses: {
    200: json('Authenticated.', envelope(tokenPair)),
    // 401 covers both bad credentials and the lockout after 5 failures.
    ...errors(400, 401, 429),
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/auth/logout',
  summary: 'Revoke the current access token and destroy the session',
  tags: ['auth'],
  security: bearerSecurity(),
  responses: { 200: json('Logged out.', ackEnvelope()), ...errors(401) },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/auth/refresh-token',
  summary: 'Rotate a refresh token for a fresh pair',
  description: 'The refresh token is the credential, so no access token is required.',
  tags: ['auth'],
  request: { body: body(z.object({ refreshToken: z.string() })) },
  responses: { 200: json('Rotated.', envelope(tokenPair)), ...errors(400, 401, 429) },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/auth/forgot-password',
  summary: 'Request a password-reset email',
  description:
    'Always reports success — whether the address exists is not disclosed, so the ' +
    'endpoint cannot be used to enumerate accounts.',
  tags: ['auth'],
  request: { body: body(forgotPasswordInputSchema) },
  responses: { 200: json('Accepted.', ackEnvelope()), ...errors(400, 429) },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/auth/reset-password',
  summary: 'Set a new password using a reset token',
  tags: ['auth'],
  request: { body: body(resetPasswordInputSchema) },
  responses: { 200: json('Password changed.', ackEnvelope()), ...errors(400, 429) },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/auth/verify-email/{token}',
  summary: 'Verify an email address',
  tags: ['auth'],
  request: { params: z.object({ token: z.string() }) },
  responses: { 200: json('Verified.', ackEnvelope()), ...errors(400) },
});

openApiRegistry.registerPath({
  method: 'put',
  path: '/auth/change-password',
  summary: 'Change the signed-in user’s password',
  description: 'Destroys every other session for the user on success.',
  tags: ['auth'],
  security: bearerSecurity(),
  request: { body: body(changePasswordInputSchema) },
  responses: { 200: json('Password changed.', ackEnvelope()), ...errors(400, 401) },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/auth/me',
  summary: 'The signed-in user',
  tags: ['auth'],
  security: bearerSecurity(),
  responses: { 200: json('The caller.', envelope(userSafeSchema)), ...errors(401) },
});
