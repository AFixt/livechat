'use strict';

/**
 * Adds the `deleted_at` column that six tables were missing.
 *
 * `createSequelize` sets `paranoid: true` as a global `define` default, so
 * every model emits `deleted_at` in its SELECT field list and appends
 * `deleted_at IS NULL` to every WHERE. Six create-table migrations omitted the
 * column, so any read against those tables failed on a migration-created
 * database with `ER_BAD_FIELD_ERROR: Unknown column 'deleted_at'`.
 *
 * This went unnoticed because both the e2e seeder and the API integration
 * tests build their schema with `sync({ force: true })` — i.e. from the models,
 * which always include the column — so nothing exercised the migrated schema.
 */
const TABLES = [
  'visitor_sessions',
  'chat_events',
  'user_sessions',
  'jwt_blacklist',
  'audit_logs',
  'staff_tenants',
];

module.exports = {
  async up(queryInterface, Sequelize) {
    for (const table of TABLES) {
      const columns = await queryInterface.describeTable(table);
      if (columns.deleted_at !== undefined) continue;
      await queryInterface.addColumn(table, 'deleted_at', {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    for (const table of TABLES) {
      const columns = await queryInterface.describeTable(table);
      if (columns.deleted_at === undefined) continue;
      await queryInterface.removeColumn(table, 'deleted_at');
    }
  },
};
