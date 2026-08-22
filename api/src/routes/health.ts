import { Router } from 'express';

import { openApiRegistry } from '../config/swagger.js';

import type { AdapterHealth } from '../io/adapter.js';

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
                required: ['status', 'socketAdapter'],
                properties: {
                  status: { type: 'string', enum: ['ok'] },
                  socketAdapter: {
                    type: 'string',
                    enum: ['ready', 'degraded', 'disabled'],
                    description:
                      'Socket.IO Redis adapter state; "degraded" means rooms are not spanning instances (#73).',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
});

interface HealthDeps {
  /**
   * Socket.IO Redis adapter health, when the adapter is installed. Absent in
   * single-process contexts (unit tests), where it reports `disabled`.
   */
  socketAdapterHealth?: AdapterHealth;
}

/**
 * Build the liveness health router.
 *
 * The probe stays `200` (a degraded adapter must not trigger a liveness-driven
 * restart), but the response body reports the Socket.IO Redis adapter state so
 * a broken cross-instance layer is visible to monitoring rather than failing
 * silently (#73).
 * @param deps - Optional adapter health handle.
 * @returns Express router.
 */
export function buildHealthRouter(deps: HealthDeps = {}): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const socketAdapter =
      deps.socketAdapterHealth === undefined
        ? 'disabled'
        : deps.socketAdapterHealth.ready
          ? 'ready'
          : 'degraded';
    res.json({ success: true, data: { status: 'ok', socketAdapter } });
  });

  return router;
}
