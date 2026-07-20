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
