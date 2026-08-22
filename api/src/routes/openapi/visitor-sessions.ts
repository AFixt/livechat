import { z } from 'zod';

import { openApiRegistry } from '../../config/swagger.js';

import { ackEnvelope, bearerSecurity, errors, json } from './support.js';

openApiRegistry.registerPath({
  method: 'delete',
  path: '/visitor-sessions/{id}',
  summary: 'Revoke a visitor session',
  description:
    'Staff-initiated counterpart to the visitor’s own "forget me" (#123). ' +
    'Hard-deletes the session, so the visitor’s cookie stops working on both ' +
    'the HTTP routes and the socket handshake, and closes any live socket. ' +
    'Tenant-scoped: a tenanted operator is confined to their own tenant, an ' +
    'untenanted AFixt operator spans every tenant (#19). An already-expired ' +
    'session is still revocable — the row outlives the window in which the ' +
    'cookie works.',
  tags: ['visitor-sessions'],
  security: bearerSecurity(),
  request: { params: z.object({ id: z.uuid() }) },
  responses: { 200: json('Revoked.', ackEnvelope()), ...errors(400, 401, 403, 404) },
});
