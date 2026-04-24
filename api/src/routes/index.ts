import { Router } from 'express';

import healthRouter from './health.js';

/**
 * Build the top-level `/api/v1` router.
 * @returns Express router with all v1 sub-routes mounted.
 */
export function buildRouter(): Router {
  const router = Router();
  router.use('/health', healthRouter);
  return router;
}
