 
// Sequelize CLI config — intentionally CommonJS so `sequelize-cli` can require it.
// Reads from process.env directly; no envalid here because the CLI is run
// out-of-band (migrations) and may legitimately run with a subset of the
// full app env.

const shared = {
  dialect: 'mysql',
  host: process.env.DB_HOST,
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
  username: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  dialectOptions: {},
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
