import { z } from 'zod';

import { SECURITY_SCHEMES } from '../../config/swagger.js';

import type { ZodType } from 'zod';

/**
 * Security requirement for a staff/admin JWT-authenticated operation.
 * @returns The operation-level `security` array.
 */
export function bearerSecurity(): [Record<string, string[]>] {
  return [{ [SECURITY_SCHEMES.bearerAuth]: [] }];
}

/**
 * Security requirement for an operation authenticated by the signed visitor
 * session cookie.
 * @returns The operation-level `security` array.
 */
export function visitorSecurity(): [Record<string, string[]>] {
  return [{ [SECURITY_SCHEMES.visitorCookie]: [] }];
}

/**
 * Wrap a payload schema in the house response envelope, `{ success, data }`.
 * Every successful API response uses this shape, so the fuzzer and the ZAP API
 * scan need it to recognise a well-formed response (#119).
 * @param data - Schema of the `data` member.
 * @returns The enveloped schema.
 */
export function envelope(data: ZodType): ZodType {
  return z.object({ success: z.literal(true), data, message: z.string().optional() });
}

/**
 * The envelope for a response that carries no payload — `{ success: true }`.
 * @returns The enveloped schema.
 */
export function ackEnvelope(): ZodType {
  return z.object({ success: z.literal(true), message: z.string().optional() });
}

/** The error body shape every failure returns — `{ success: false, message }`. */
const errorBody = z.object({ success: z.literal(false), message: z.string() });

/**
 * Build a JSON response entry for an OpenAPI operation.
 * @param description - Human-readable description of the response.
 * @param schema - Body schema; omit for an empty-bodied response.
 * @returns A `responses` entry.
 */
export function json(
  description: string,
  schema?: ZodType,
): { description: string; content?: Record<string, { schema: ZodType }> } {
  if (schema === undefined) return { description };
  return { description, content: { 'application/json': { schema } } };
}

/**
 * Build a JSON request-body entry for an OpenAPI operation.
 * @param schema - Body schema.
 * @returns A `request.body` entry.
 */
export function body(schema: ZodType): {
  required: true;
  content: Record<string, { schema: ZodType }>;
} {
  return { required: true, content: { 'application/json': { schema } } };
}

/**
 * The failure responses essentially every operation can produce. Declaring them
 * is what lets an API fuzzer tell an expected rejection apart from an
 * undocumented one — a 500 that is not listed here is a finding (#119, #62).
 * @param codes - Which failures this operation can produce.
 * @returns A partial `responses` map.
 */
export function errors(
  ...codes: (400 | 401 | 403 | 404 | 409 | 413 | 429)[]
): Record<number, ReturnType<typeof json>> {
  const descriptions: Record<number, string> = {
    400: 'Invalid request — validation failed.',
    401: 'Missing or invalid credentials.',
    403: 'Authenticated but not permitted (role, tenant scope, or CSRF).',
    404: 'No such resource, or not visible to this caller.',
    409: 'Conflicts with the current state of the resource.',
    413: 'Request payload too large.',
    429: 'Rate limit exceeded.',
  };
  const out: Record<number, ReturnType<typeof json>> = {};
  for (const code of codes) out[code] = json(descriptions[code] ?? 'Error.', errorBody);
  return out;
}
