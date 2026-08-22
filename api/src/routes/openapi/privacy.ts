import {
  dataSubjectRequestInputSchema,
  effectiveConsentStateSchema,
  readConsentQuerySchema,
  recordConsentInputSchema,
  withdrawConsentInputSchema,
} from '@livechat/shared';
import { z } from 'zod';

import { openApiRegistry } from '../../config/swagger.js';

import { body, envelope, errors, json, visitorSecurity } from './support.js';

/**
 * These are visitor-facing: the subject is an anonymous, HMAC-derived key tied
 * to the visitor cookie, not a logged-in user. A caller with no cookie is
 * issued one — establishing a subject to attach a decision to is not itself
 * tracking (ADR-0019) — so they are documented as cookie-authenticated with the
 * cookie optional in practice.
 */
const subjectNote =
  'Subject is the anonymous key derived from the visitor cookie. A request ' +
  'without one is issued a fresh cookie so the decision has something to attach to.';

openApiRegistry.registerPath({
  method: 'get',
  path: '/privacy/consent',
  summary: 'The visitor’s effective consent state',
  description: `${subjectNote} Side-effect-free: writes no audit row and records no consent.`,
  tags: ['privacy'],
  security: visitorSecurity(),
  request: { query: readConsentQuerySchema },
  responses: {
    200: json(
      'The resolved per-purpose state, jurisdiction, and legal basis.',
      envelope(effectiveConsentStateSchema),
    ),
    ...errors(400),
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/privacy/consent',
  summary: 'Record a consent decision',
  description: `${subjectNote} Emits a privacy audit event.`,
  tags: ['privacy'],
  security: visitorSecurity(),
  request: { body: body(recordConsentInputSchema) },
  responses: {
    201: json('The resulting effective state.', envelope(effectiveConsentStateSchema)),
    ...errors(400),
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/privacy/consent/withdraw',
  summary: 'Withdraw consent for every purpose',
  description: `${subjectNote} Recorded with legal basis \`withdrawn\`.`,
  tags: ['privacy'],
  security: visitorSecurity(),
  request: { body: body(withdrawConsentInputSchema) },
  responses: {
    200: json('The resulting effective state.', envelope(effectiveConsentStateSchema)),
    ...errors(400),
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/privacy/data-request',
  summary: 'Raise a data-subject access or erasure request',
  description:
    `${subjectNote} Accepted and audited; fulfilment is asynchronous and ` +
    'currently a stub — see #121.',
  tags: ['privacy'],
  security: visitorSecurity(),
  request: { body: body(dataSubjectRequestInputSchema) },
  responses: {
    202: json(
      'Request accepted for processing.',
      envelope(z.object({ requestId: z.string(), type: z.string() })),
    ),
    ...errors(400),
  },
});
