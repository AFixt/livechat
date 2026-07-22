// Sequelize CLI config — intentionally CommonJS so `sequelize-cli` can require it.
// Reads from process.env directly; no envalid here because the CLI is run
// out-of-band (migrations) and may legitimately run with a subset of the
// full app env.

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
