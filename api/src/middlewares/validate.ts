import { ZodError, type infer as ZodInfer, type ZodType } from 'zod';

import { ApiError } from '../utils/api-error.js';

import type { RequestHandler } from 'express';

interface ValidateSchemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

/**
 * Validate `req.body`, `req.query`, and `req.params` against Zod schemas.
 * Replaces each with the parsed, typed value. Non-conforming payloads throw
 * a 400 ApiError with `details` set to the Zod issues.
 * @param schemas - Zod schemas keyed by request part.
 * @returns Express middleware.
 */
export function validate(schemas: ValidateSchemas): RequestHandler {
  return (req, _res, next) => {
    try {
      if (schemas.body !== undefined) {
        req.body = schemas.body.parse(req.body);
      }
      if (schemas.query !== undefined) {
        Object.assign(req.query, schemas.query.parse(req.query) as Record<string, unknown>);
      }
      if (schemas.params !== undefined) {
        Object.assign(req.params, schemas.params.parse(req.params) as Record<string, unknown>);
      }
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        next(ApiError.badRequest('Validation failed', err.issues));
        return;
      }
      next(err);
    }
  };
}

/**
 * Typed helper to read the parsed body off `req` in a controller.
 * @remarks
 * Pass the schema phantom-style so the inferred type is applied at the call
 * site: `const body = parsedBody(req, loginInputSchema)`.
 * @param req - The Express request.
 * @param _schema - The Zod schema that was applied by {@link validate}.
 * @returns The typed body.
 */
export function parsedBody<S extends ZodType>(req: { body: unknown }, _schema: S): ZodInfer<S> {
  return req.body as ZodInfer<S>;
}
