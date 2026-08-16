// Sequelize CLI config — intentionally CommonJS so `sequelize-cli` can require it.
// Reads from process.env directly; no envalid here because the CLI is run
// out-of-band (migrations) and may legitimately run with a subset of the
// full app env.

// Load api/.env for local `npm run migrate`/`seed` so a clean clone works
// (#81). dotenv never overrides already-set variables, so CI/production (which
// supply env directly) are unaffected; production never reads the file. `test`
// is excluded to match api/src/config/env.ts, so a stray cwd `.env` cannot leak
// into any sequelize-cli invocation a test might trigger.
if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
  try {
    require('dotenv').config();
  } catch {
    // dotenv is a dependency; this guard only protects an unusual install.
  }
}

// TLS is opt-in via DB_SSL so migrations against local docker-compose stay
// plaintext; in production it verifies the server cert against DB_SSL_CA (the
// provider's CA PEM) when supplied. Mirrors api/src/config/mysql.ts.
const ssl =
  process.env.DB_SSL === 'true'
    ? { rejectUnauthorized: true, ...(process.env.DB_SSL_CA ? { ca: process.env.DB_SSL_CA } : {}) }
    : undefined;

const shared = {
  dialect: 'mysql',
  host: process.env.DB_HOST,
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
  username: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  dialectOptions: { ssl },
  define: {
    underscored: true,
    timestamps: true,
    paranoid: true,
  },
};

module.exports = {
  development: shared,
  test: shared,
  production: shared,
};
