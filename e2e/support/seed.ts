/**
 * Standalone seed entry — invoked by `global-setup.ts` as a `tsx` subprocess
 * against the `livechat_e2e` database. Drops every table and replays the real
 * migrations, then inserts the {@link fixtures} dataset, so each run starts
 * from an identical, isolated state.
 *
 * The schema deliberately comes from `api/src/db/migrations` rather than
 * `sync({ force: true })`: building it from the models would make the models
 * the source of truth for both the code under test and the schema it runs
 * against, hiding migration drift from the one suite that drives the real
 * browser end to end.
 *
 * Run directly: `DB_NAME=livechat_e2e tsx e2e/support/seed.ts`
 */
import { pino } from 'pino';

import { createSequelize } from '../../api/src/config/mysql.js';
import { resetSchemaFromMigrations } from '../../api/src/db/migrator.js';
import { initModels, Invitation, Tenant, User } from '../../api/src/models/index.js';

import { PENDING_INVITATION, TENANTS, USERS } from './fixtures.js';

import type { Env } from '../../api/src/config/env.js';

const env = {
  DB_HOST: process.env.DB_HOST ?? 'localhost',
  DB_PORT: process.env.DB_PORT === undefined ? 23307 : Number(process.env.DB_PORT),
  DB_NAME: process.env.DB_NAME ?? 'livechat_e2e',
  DB_USER: process.env.DB_USER ?? 'livechat_user',
  DB_PASS: process.env.DB_PASS ?? 'livechat_pass',
  NODE_ENV: 'test',
} as unknown as Env;

const logger = pino({ level: 'error' });
const sequelize = createSequelize(env, logger);
initModels(sequelize);

await resetSchemaFromMigrations(sequelize);

// Tenants first, so users/invitations can resolve their slug → id.
const tenantIdBySlug = new Map<string, string>();
for (const t of Object.values(TENANTS)) {
  const row = await Tenant.create({
    name: t.name,
    slug: t.slug,
    domain: null,
    status: 'active',
    expiresAt: null,
    settings: null,
    allowedOrigins: null,
  });
  tenantIdBySlug.set(t.slug, row.id);
}

const userIdByEmail = new Map<string, string>();
for (const u of Object.values(USERS)) {
  const row = await User.create({
    email: u.email,
    passwordHash: u.password,
    firstName: u.firstName,
    lastName: u.lastName,
    role: u.role,
    status: u.status,
    emailVerified: true,
    tenantId: u.tenantSlug === null ? null : (tenantIdBySlug.get(u.tenantSlug) ?? null),
  });
  userIdByEmail.set(u.email, row.id);
}

await Invitation.create({
  email: PENDING_INVITATION.email,
  name: null,
  role: PENDING_INVITATION.role,
  tenantId: tenantIdBySlug.get(PENDING_INVITATION.tenantSlug) ?? null,
  token: PENDING_INVITATION.token,
  status: 'pending',
  invitedBy: userIdByEmail.get(USERS.superAdmin.email) ?? '',
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  acceptedAt: null,
});

process.stdout.write(
  `e2e seed: ${String(Object.keys(TENANTS).length)} tenants, ` +
    `${String(Object.keys(USERS).length)} users, 1 invitation\n`,
);
await sequelize.close();
