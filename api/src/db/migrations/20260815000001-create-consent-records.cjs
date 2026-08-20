'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('consent_records', {
      id: { type: Sequelize.UUID, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      inc: { type: Sequelize.MEDIUMINT.UNSIGNED, autoIncrement: true, unique: true },
      tenant_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'tenants', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      visitor_session_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'visitor_sessions', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      subject_key: { type: Sequelize.STRING(128), allowNull: false },
      jurisdiction: { type: Sequelize.STRING(16), allowNull: false },
      legal_basis: { type: Sequelize.STRING(32), allowNull: false },
      source: { type: Sequelize.ENUM('gpc', 'banner', 'default'), allowNull: false },
      gpc: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      rule_version: { type: Sequelize.STRING(32), allowNull: false },
      purposes: { type: Sequelize.JSON, allowNull: false },
      explicit_purposes: { type: Sequelize.JSON, allowNull: true },
      ip_hash: { type: Sequelize.STRING(128), allowNull: true },
      user_agent: { type: Sequelize.STRING(500), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
      deleted_at: { type: Sequelize.DATE, allowNull: true },
    });
    await queryInterface.addIndex('consent_records', ['tenant_id', 'subject_key']);
    await queryInterface.addIndex('consent_records', ['subject_key', 'created_at']);
    await queryInterface.addIndex('consent_records', ['visitor_session_id']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('consent_records');
  },
};
