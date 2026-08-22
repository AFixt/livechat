import { pino } from 'pino';
import { describe, expect, it } from 'vitest';

import { buildOpenApiSpec } from '../../src/config/swagger.js';
import { buildAuthRouter } from '../../src/routes/auth.js';
import { buildChatsRouter } from '../../src/routes/chats.js';
import { buildHealthRouter } from '../../src/routes/health.js';
import { buildRouter } from '../../src/routes/index.js';
import { buildInvitationsRouter } from '../../src/routes/invitations.js';
import { buildPrivacyRouter } from '../../src/routes/privacy.js';
import { buildTenantsRouter } from '../../src/routes/tenants.js';
import { buildUsersRouter } from '../../src/routes/users.js';
import { buildVisitorSessionsRouter } from '../../src/routes/visitor-sessions.js';
import { buildVisitorRouter } from '../../src/routes/visitor.js';
import { buildWidgetRouter } from '../../src/routes/widget.js';
import { createServices } from '../../src/services/index.js';

import type { Env } from '../../src/config/env.js';
import type { Router } from 'express';
import type { Redis } from 'ioredis';

/**
 * Minimal env — this test never opens a socket, it only walks the router that
 * `buildRouter` assembles.
 * @returns An Env-shaped stub.
 */
function makeEnv(): Env {
  return {
    NODE_ENV: 'test',
    PORT: 0,
    DB_HOST: 'localhost',
    DB_PORT: 3306,
    DB_NAME: 'livechat_test',
    DB_USER: 'test',
    DB_PASS: 'test',
    REDIS_HOST: 'localhost',
    REDIS_PORT: 6379,
    JWT_ACCESS_SECRET: 'test-access-secret',
    JWT_REFRESH_SECRET: 'test-refresh-secret',
    JWT_ACCESS_EXPIRES_IN: '15m',
    JWT_REFRESH_EXPIRES_IN: '7d',
    COOKIE_SECRET: 'test-cookie-secret',
    APP_URL: 'http://localhost:25174',
    API_URL: 'http://localhost:23001',
    WIDGET_URL: 'http://localhost:25175',
    SMTP_HOST: 'localhost',
    SMTP_PORT: 1025,
    SMTP_FROM: 'test@example.com',
    S3_ENDPOINT: 'http://localhost:9000',
    S3_REGION: 'us-east-1',
    S3_ACCESS_KEY: 'test',
    S3_SECRET_KEY: 'test',
    S3_BUCKET: 'test',
    LOG_LEVEL: 'silent' as Env['LOG_LEVEL'],
    isDev: false,
    isProduction: false,
    isTest: true,
    isDevelopment: false,
  } as unknown as Env;
}

interface LayerLike {
  route?: { path: string; methods: Record<string, boolean> };
  handle?: { stack?: LayerLike[] };
}

/**
 * Walk one sub-router and collect its routes as `method /prefix/path`, with
 * Express's `:param` rewritten to OpenAPI's `{param}`.
 *
 * Only the sub-routers are walked, never the top-level mount. Express 5 keeps
 * a mount's path in an opaque matcher closure — `layer.regexp` is gone — so the
 * prefix cannot be recovered by introspection. It is supplied by {@link MOUNTS}
 * instead, and the "every mount is covered" test below stops that table from
 * silently drifting out of date.
 * @param router - The sub-router to walk.
 * @param prefix - The path it is mounted at.
 * @returns Operation keys, e.g. `get /chats/{id}`.
 */
function collectRoutes(router: Router, prefix: string): string[] {
  const found: string[] = [];
  const walk = (stack: LayerLike[]): void => {
    for (const layer of stack) {
      if (layer.route !== undefined) {
        const path = `${prefix}${layer.route.path}`.replace(/:(\w+)/g, '{$1}');
        for (const [method, enabled] of Object.entries(layer.route.methods)) {
          // Express registers an implicit HEAD alongside every GET, and `_all`
          // is its wildcard marker — neither is a distinct documented operation.
          if (!enabled || method === '_all' || method === 'head') continue;
          found.push(`${method} ${path.replace(/(.)\/$/, '$1')}`);
        }
        continue;
      }
      if (layer.handle?.stack !== undefined) walk(layer.handle.stack);
    }
  };
  walk((router as unknown as { stack: LayerLike[] }).stack);
  return found;
}

describe('OpenAPI spec covers the mounted API surface (#119)', () => {
  const env = makeEnv();
  const logger = pino({ level: 'silent' });
  const redis = { on: () => undefined } as unknown as Redis;
  const services = createServices({ env, logger, redis });
  const deps = { env, redis, services, skipRateLimit: true as const };

  /**
   * Every sub-router and the prefix `buildRouter` mounts it at. Adding a router
   * without adding it here fails the "covers every mounted router" test.
   */
  const MOUNTS: { prefix: string; router: Router }[] = [
    { prefix: '/health', router: buildHealthRouter({}) },
    {
      prefix: '/auth',
      router: buildAuthRouter({ ...deps, auth: services.auth, audit: services.audit }),
    },
    {
      prefix: '/tenants',
      router: buildTenantsRouter({ ...deps, tenant: services.tenant, audit: services.audit }),
    },
    {
      prefix: '/users',
      router: buildUsersRouter({ ...deps, user: services.user, audit: services.audit }),
    },
    {
      prefix: '/invitations',
      router: buildInvitationsRouter({ ...deps, invitation: services.invitation }),
    },
    { prefix: '/widget', router: buildWidgetRouter({ ...deps, presence: services.presence }) },
    {
      prefix: '/privacy',
      router: buildPrivacyRouter({
        ...deps,
        consent: services.consent,
        visitorSession: services.visitorSession,
      }),
    },
    {
      prefix: '/visitor',
      router: buildVisitorRouter({
        ...deps,
        visitorSession: services.visitorSession,
        chat: services.chat,
        presence: services.presence,
        consent: services.consent,
        email: services.email,
      }),
    },
    { prefix: '/chats', router: buildChatsRouter({ ...deps, chat: services.chat }) },
    {
      prefix: '/visitor-sessions',
      router: buildVisitorSessionsRouter({
        ...deps,
        visitorSession: services.visitorSession,
        presence: services.presence,
        audit: services.audit,
      }),
    },
  ];

  const mounted = new Set(MOUNTS.flatMap((m) => collectRoutes(m.router, m.prefix)));
  const spec = buildOpenApiSpec({ API_URL: env.API_URL });
  const documented = new Set<string>();
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    for (const method of Object.keys(item as Record<string, unknown>)) {
      documented.add(`${method} ${path}`);
    }
  }

  it('covers every router that buildRouter mounts', () => {
    // If a new sub-router is mounted and not added to MOUNTS above, its routes
    // would go unchecked and this suite would pass while covering less than it
    // claims. Count only the router layers — buildRouter also mounts bare
    // middleware (the per-tenant `originAllowed` guards), which are not routers.
    const stack = (buildRouter(deps) as unknown as { stack: { name?: string }[] }).stack;
    const routerLayers = stack.filter((layer) => layer.name === 'router');
    expect(routerLayers).toHaveLength(MOUNTS.length);
  });

  it('finds a non-trivial surface to compare (guards against an empty walk)', () => {
    // If the router walk silently returned nothing, the assertions below would
    // pass vacuously — which is the failure mode #119 is about. Pin a floor.
    expect(mounted.size).toBeGreaterThan(30);
    expect(documented.size).toBeGreaterThan(30);
  });

  it('documents every mounted route', () => {
    const undocumented = [...mounted].filter((op) => !documented.has(op)).sort();
    expect(undocumented, 'routes with no OpenAPI path — the fuzzer cannot see these').toEqual([]);
  });

  it('does not document routes that are not mounted', () => {
    const phantom = [...documented].filter((op) => !mounted.has(op)).sort();
    expect(phantom, 'OpenAPI paths with no matching route — stale or misspelled').toEqual([]);
  });
});
