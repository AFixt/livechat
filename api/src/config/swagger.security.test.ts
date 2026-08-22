import { describe, expect, it } from 'vitest';

// Side-effect import: registers every route's OpenAPI path into the shared
// registry so the generated document reflects the full surface.
import '../routes/index.js';

import { buildOpenApiSpec, SECURITY_SCHEMES } from './swagger.js';

/**
 * Operations that legitimately require NO authentication. Anything registered
 * in the OpenAPI document that is NOT listed here and carries no `security`
 * requirement is a gap (see the "coverage" test below). Keep this list tight
 * and justified — it is the allowlist a reviewer checks against.
 */
const PUBLIC_OPERATIONS = new Set<string>([
  'get /health', // liveness probe
  'get /widget/config', // public, cookieless widget bootstrap
  'post /widget/csp-report', // browser-posted CSP violation reports
  'post /auth/login', // credentials in, token out
  'post /auth/register', // invitation-token gated, no session yet
  'post /auth/refresh-token', // the refresh token in the body is the credential
  'post /auth/forgot-password', // pre-auth; never discloses whether the address exists
  'post /auth/reset-password', // reset-token gated
  'get /auth/verify-email/{token}', // verification-token gated
  'post /visitor/session', // mints the visitor cookie; none exists yet
]);

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch', 'options', 'head'] as const;

interface OperationRef {
  key: string;
  /** The operation's `security` requirements, or undefined when it declares none. */
  security: unknown[] | undefined;
}

/**
 * Flatten the spec into `{ "get /path", security }` entries for every operation.
 * @param spec - The generated OpenAPI document.
 * @returns One entry per operation.
 */
function listOperations(spec: ReturnType<typeof buildOpenApiSpec>): OperationRef[] {
  const ops: OperationRef[] = [];
  const paths = (spec.paths ?? {}) as Record<string, Record<string, { security?: unknown }>>;
  for (const [path, item] of Object.entries(paths)) {
    for (const method of HTTP_METHODS) {
      const op = item[method];
      if (op === undefined) continue;
      ops.push({
        key: `${method} ${path}`,
        security: Array.isArray(op.security) ? op.security : undefined,
      });
    }
  }
  return ops;
}

describe('OpenAPI spec — security', () => {
  const spec = buildOpenApiSpec({ API_URL: 'http://localhost:3000' });
  const schemes = (spec.components?.securitySchemes ?? {}) as Record<string, { type?: string }>;

  it('declares the JWT bearer and visitor-cookie security schemes', () => {
    expect(spec.components?.securitySchemes).toBeDefined();
    expect(Object.keys(schemes)).toEqual(
      expect.arrayContaining([SECURITY_SCHEMES.bearerAuth, SECURITY_SCHEMES.visitorCookie]),
    );
    expect(schemes[SECURITY_SCHEMES.bearerAuth]).toMatchObject({ type: 'http', scheme: 'bearer' });
    expect(schemes[SECURITY_SCHEMES.visitorCookie]).toMatchObject({ type: 'apiKey', in: 'cookie' });
  });

  it('only references declared schemes in operation-level security', () => {
    const declared = new Set(Object.keys(schemes));
    for (const op of listOperations(spec)) {
      if (op.security === undefined) continue;
      for (const requirement of op.security) {
        if (typeof requirement !== 'object' || requirement === null) continue;
        for (const schemeName of Object.keys(requirement)) {
          expect(declared, `${op.key} references undeclared scheme "${schemeName}"`).toContain(
            schemeName,
          );
        }
      }
    }
  });

  it('flags non-public operations that carry no security requirement', () => {
    const gaps = listOperations(spec)
      .filter((op) => !PUBLIC_OPERATIONS.has(op.key))
      .filter((op) => op.security === undefined || op.security.length === 0)
      .map((op) => op.key);

    if (gaps.length > 0) {
      // Flag, don't silently pass: surface the gaps so they get a `security`
      // requirement or an explicit PUBLIC_OPERATIONS entry.
      console.warn(
        `[openapi-security] ${String(gaps.length)} operation(s) missing a security ` +
          `requirement and not in the public allowlist:\n  - ${gaps.join('\n  - ')}`,
      );
    }

    // Tripwire: every registered operation must be either public (allowlisted)
    // or authenticated. It now covers the whole registered surface (#119), and
    // fails the moment a route is added to the spec without declaring
    // `security` — forcing the author to make the call. Note it earned its
    // keep immediately: two entries in the allowlist above named paths that
    // did not exist (`post /auth/refresh`, `post /auth/verify-email`), and this
    // caught both the moment the real ones were registered.
    expect(gaps).toEqual([]);
  });
});
