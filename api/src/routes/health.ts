import { Router } from 'express';

import { openApiRegistry } from '../config/swagger.js';

openApiRegistry.registerPath({
  method: 'get',
  path: '/health',
  summary: 'Liveness probe',
  tags: ['health'],
  responses: {
    200: {
      description: 'Service is up.',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['success', 'data'],
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                required: ['status'],
                properties: { status: { type: 'string', enum: ['ok'] } },
              },
            },
          },
        },
      },
    },
  },
});

/**
 * Router exposing the liveness health probe.
 */
const router = Router();

router.get('/', (_req, res) => {
  res.json({ success: true, data: { status: 'ok' } });
});

export default router;
