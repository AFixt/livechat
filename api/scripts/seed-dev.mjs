import { loadEnv } from '../src/config/env.js';
import { createLogger } from '../src/config/logger.js';
import { createSequelize } from '../src/config/mysql.js';
import { initModels, Tenant, User } from '../src/models/index.js';

const env = loadEnv();
const logger = createLogger(env);
const sequelize = createSequelize(env, logger);
initModels(sequelize);
await sequelize.authenticate();

// Idempotent upsert
let tenant = await Tenant.findOne({ where: { slug: 'acme' } });
if (!tenant) {
  tenant = await Tenant.create({
    name: 'Acme Corp',
    slug: 'acme',
    status: 'active',
    domain: null,
    expiresAt: null,
    settings: null,
  });
}
console.log('tenant:', tenant.id, tenant.slug);

let admin = await User.findOne({ where: { email: 'admin@example.com' } });
if (!admin) {
  admin = await User.create({
    email: 'admin@example.com',
    passwordHash: 'Admin!Password1',
    firstName: 'Super',
    lastName: 'Admin',
    role: 'super_admin',
    tenantId: null,
    status: 'active',
    emailVerified: true,
  });
}
console.log('admin:', admin.email, admin.role);

let staff = await User.findOne({ where: { email: 'staff@acme.example' } });
if (!staff) {
  staff = await User.create({
    email: 'staff@acme.example',
    passwordHash: 'Staff!Password1',
    firstName: 'Acme',
    lastName: 'Staff',
    role: 'staff',
    tenantId: tenant.id,
    status: 'active',
    emailVerified: true,
  });
}
console.log('staff:', staff.email, staff.role);

await sequelize.close();
