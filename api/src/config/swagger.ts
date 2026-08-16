import { OpenApiGeneratorV3, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

import type { Env } from './env.js';

/**
 * Return type of {@link buildOpenApiSpec} — the OpenAPI 3.0 document shape
 * produced by zod-to-openapi's generator.
 */
type OpenApiSpec = ReturnType<OpenApiGeneratorV3['generateDocument']>;

/**
 * Shared OpenAPI registry — routes register their schemas into this at module
 * load time, then {@link buildOpenApiSpec} serializes them once at startup.
 */
export const openApiRegistry = new OpenAPIRegistry();

/**
 * Name of the two authentication mechanisms the API exposes, registered as
 * OpenAPI `securitySchemes` below. Operations reference these by name in their
 * `security` requirement, and the spec-security test asserts they are declared.
 */
export const SECURITY_SCHEMES = {
  /** Staff/admin JWT access token — `Authorization: Bearer <token>`. */
  bearerAuth: 'bearerAuth',
  /** Signed visitor session cookie (`livechat_visitor`). */
  visitorCookie: 'visitorCookie',
} as const;

// Declare the security schemes so the generated document has a populated
// `components.securitySchemes`. Registered at module load, before
// buildOpenApiSpec() reads registry.definitions.
openApiRegistry.registerComponent('securitySchemes', SECURITY_SCHEMES.bearerAuth, {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
  description:
    'Short-lived JWT access token issued by POST /auth/login and rotated via ' +
    'POST /auth/refresh. Sent as `Authorization: Bearer <token>`.',
});
openApiRegistry.registerComponent('securitySchemes', SECURITY_SCHEMES.visitorCookie, {
  type: 'apiKey',
  in: 'cookie',
  name: 'livechat_visitor',
  description:
    'Signed, httpOnly visitor session cookie set by POST /visitor/session. ' +
    'Identifies an anonymous or token-identified widget visitor.',
});

/**
 * Serialize the current {@link openApiRegistry} into an OpenAPI 3.0.3 document.
 * @param env - Validated env (used for server URL + version).
 * @returns An OpenAPI document object, suitable for swagger-ui-express.
 */
export function buildOpenApiSpec(env: Pick<Env, 'API_URL'>): OpenApiSpec {
  const generator = new OpenApiGeneratorV3(openApiRegistry.definitions);
  return generator.generateDocument({
    openapi: '3.0.3',
    info: {
      title: 'AFixt livechat API',
      version: '0.0.0',
      description: 'Accessibility-first, multi-tenant live chat support.',
    },
    servers: [{ url: `${env.API_URL}/api/v1` }],
  });
}
