import { loadEnv } from '../config/env.js';
import { createLogger } from '../config/logger.js';
import { createSequelize } from '../config/mysql.js';
import { initModels, Tenant, User } from '../models/index.js';

/**
 * One-off seed that creates the initial tenant + super_admin. Enabled via
 * `instance_count: 1` on the `seed-first-tenant` job in .do/app.yaml for
 * the initial deploy, then disabled by dropping `instance_count` back to
 * 0 in a PR.
 *
 * Required env:
 *   FIRST_TENANT_SLUG, FIRST_TENANT_NAME, FIRST_ADMIN_EMAIL,
 *   FIRST_ADMIN_PASSWORD
 *
 * Idempotent — safe to re-run if it was already partially applied.
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env);
  const sequelize = createSequelize(env, logger);
  initModels(sequelize);

  const slug = process.env.FIRST_TENANT_SLUG;
  const name = process.env.FIRST_TENANT_NAME;
  const adminEmail = process.env.FIRST_ADMIN_EMAIL;
  const adminPassword = process.env.FIRST_ADMIN_PASSWORD;

  if (
    slug === undefined ||
    name === undefined ||
    adminEmail === undefined ||
    adminPassword === undefined
  ) {
    logger.fatal(
      'Missing one or more of FIRST_TENANT_SLUG, FIRST_TENANT_NAME, FIRST_ADMIN_EMAIL, FIRST_ADMIN_PASSWORD',
    );
    process.exitCode = 1;
    await sequelize.close();
    return;
  }

  try {
    await sequelize.authenticate();

    const [tenant] = await Tenant.findOrCreate({
      where: { slug },
      defaults: {
        name,
        slug,
        status: 'active',
        domain: null,
        expiresAt: null,
        settings: null,
        allowedOrigins: null,
      },
    });
    logger.info({ tenantId: tenant.id, slug: tenant.slug }, 'tenant ensured');

    const [admin] = await User.findOrCreate({
      where: { email: adminEmail.toLowerCase() },
      defaults: {
        email: adminEmail,
        passwordHash: adminPassword,
        firstName: 'Super',
        lastName: 'Admin',
        role: 'super_admin',
        tenantId: null,
        status: 'active',
        emailVerified: true,
        emailVerificationToken: null,
        emailVerificationExpires: null,
        passwordResetToken: null,
        passwordResetExpires: null,
        lockedUntil: null,
        lastLoginAt: null,
        phone: null,
        timezone: null,
        avatarUrl: null,
        preferences: null,
      },
    });
    logger.info({ userId: admin.id, email: admin.email }, 'super_admin ensured');
    logger.info('seed complete — disable this job by setting instance_count: 0');
  } catch (err) {
    logger.fatal({ err }, 'seed failed');
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
}

void main();
