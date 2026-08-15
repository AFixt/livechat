import { ZodError } from 'zod';

import { ApiError } from '../utils/api-error.js';
import { recordAudit } from '../utils/audit.js';

import type { AuditService } from '../services/audit-service.js';
import type { ErrorRequestHandler } from 'express';
import type { Logger } from 'pino';

interface ErrorPayload {
  success: false;
  message: string;
  details?: unknown;
}

/**
 * Map a body-parser / `http-errors` failure (malformed JSON, oversized body,
 * unsupported charset) to a client 4xx with a generic, non-leaking message.
 *
 * Without this these surface as an unhandled `Error` and fall through to the
 * generic 500 branch, so a malformed request body reads as a server fault. We
 * deliberately ignore `err.message` — body-parser echoes a slice of the
 * offending payload into it — and return a fixed message per bucket instead.
 * @param err - The thrown value from the error middleware chain.
 * @returns A `{ status, message }` for known body-parser errors, else `null`.
 */
function clientBodyError(err: unknown): { status: number; message: string } | null {
  if (!(err instanceof Error) || !('type' in err) || typeof err.type !== 'string') {
    return null;
  }
  const raw = (err as { status?: unknown; statusCode?: unknown }).status;
  const rawCode = (err as { statusCode?: unknown }).statusCode;
  const status = typeof raw === 'number' ? raw : typeof rawCode === 'number' ? rawCode : 400;
  if (status < 400 || status >= 500) return null;
  if (status === 413) return { status, message: 'Request payload too large' };
  if (status === 415) return { status, message: 'Unsupported media type' };
  return { status: 400, message: 'Malformed request body' };
}

/**
 * Central error handler. Serializes `ApiError` and Zod errors into the
 * response envelope; logs everything else as `error` and returns 500.
 *
 * Also the single place authorization failures are audited. Every guard funnels
 * its `ApiError` through here, so recording 401/403 centrally captures denials
 * — including the tenant-isolation checks — without wrapping each call site.
 * @param logger - Pino logger.
 * @param audit - Audit service; omit to disable denial auditing.
 * @returns An Express error-handling middleware.
 */
export function errorHandler(logger: Logger, audit?: AuditService): ErrorRequestHandler {
  return (err, req, res, _next) => {
    const body: ErrorPayload = { success: false, message: 'Internal server error' };
    let status = 500;

    const bodyError = clientBodyError(err);
    if (err instanceof ApiError) {
      status = err.status;
      body.message = err.message;
      if (err.details !== undefined) {
        body.details = err.details;
      }
    } else if (err instanceof ZodError) {
      status = 400;
      body.message = 'Validation failed';
      body.details = err.issues;
    } else if (bodyError !== null) {
      status = bodyError.status;
      body.message = bodyError.message;
    } else if (err instanceof Error) {
      logger.error({ err, correlationId: req.correlationId, path: req.path }, 'unhandled error');
    } else {
      logger.error(
        { err, correlationId: req.correlationId, path: req.path },
        'unhandled non-error throw',
      );
    }

    if (audit !== undefined && (status === 401 || status === 403)) {
      // Detached: a denial must still be returned promptly even if the audit
      // write is slow, and `record` swallows its own failures.
      void recordAudit(audit, req, {
        action: status === 401 ? 'auth.denied' : 'access.denied',
        resourceType: 'http',
        metadata: { method: req.method, path: req.path, reason: body.message },
      });
    }

    res.status(status).json(body);
  };
}
