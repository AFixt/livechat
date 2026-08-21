import { z } from 'zod';

import { openApiRegistry } from '../../config/swagger.js';
import { cspReportSchema } from '../csp-report.js';

import { ackEnvelope, envelope, errors, json } from './support.js';

const widgetConfig = z.object({
  tenantId: z.string(),
  tenantKey: z.string(),
  name: z.string(),
  primaryColor: z.string().nullable(),
  supportHoursText: z.string().nullable(),
  supportPhone: z.string().nullable(),
  supportAvailable: z.boolean(),
  allowedOrigins: z.array(z.string()),
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/widget/config',
  summary: 'Public widget bootstrap configuration',
  description:
    'Cookieless and unauthenticated — the widget calls this before a visitor ' +
    'session exists. Served `Cache-Control: no-store` because `supportAvailable` ' +
    'is a live value.',
  tags: ['widget'],
  request: { query: z.object({ tenantKey: z.string().min(1) }) },
  responses: {
    200: json('The tenant’s public widget configuration.', envelope(widgetConfig)),
    ...errors(400, 404),
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/widget/csp-report',
  summary: 'Browser-posted CSP violation report sink',
  description:
    'Public by necessity — the browser posts these with no credential. Bounded ' +
    'by a per-IP rate limit and an 8 KB body cap, and only whitelisted fields ' +
    'are logged (#84).',
  tags: ['widget'],
  request: {
    body: {
      required: true,
      // Browsers send `application/csp-report` (report-uri) or
      // `application/reports+json` (report-to); both are accepted.
      content: {
        'application/csp-report': { schema: cspReportSchema },
        'application/reports+json': { schema: cspReportSchema },
        'application/json': { schema: cspReportSchema },
      },
    },
  },
  responses: {
    204: json('Report accepted; nothing returned.'),
    400: json('Not shaped like a CSP report.', ackEnvelope()),
    ...errors(413, 429),
  },
});
