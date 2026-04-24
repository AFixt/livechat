'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('users', {
      id: { type: Sequelize.UUID, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      inc: { type: Sequelize.MEDIUMINT.UNSIGNED, autoIncrement: true, unique: true },
      email: { type: Sequelize.STRING(255), allowNull: false, unique: true },
      password_hash: { type: Sequelize.STRING(255), allowNull: false },
      first_name: { type: Sequelize.STRING(100), allowNull: false },
      last_name: { type: Sequelize.STRING(100), allowNull: false },
      role: {
        type: Sequelize.ENUM('super_admin', 'admin', 'staff', 'client'),
        defaultValue: 'client',
        allowNull: false,
      },
      tenant_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'tenants', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      email_verified: { type: Sequelize.BOOLEAN, defaultValue: false },
      email_verification_token: { type: Sequelize.STRING(255), allowNull: true },
      email_verification_expires: { type: Sequelize.DATE, allowNull: true },
      password_reset_token: { type: Sequelize.STRING(255), allowNull: true },
      password_reset_expires: { type: Sequelize.DATE, allowNull: true },
      failed_login_attempts: { type: Sequelize.INTEGER, defaultValue: 0 },
      locked_until: { type: Sequelize.DATE, allowNull: true },
      status: {
        type: Sequelize.ENUM('active', 'suspended', 'pending', 'deactivated'),
        defaultValue: 'pending',
        allowNull: false,
      },
      last_login_at: { type: Sequelize.DATE, allowNull: true },
      phone: { type: Sequelize.STRING(50), allowNull: true },
      timezone: { type: Sequelize.STRING(50), allowNull: true },
      language: { type: Sequelize.STRING(10), allowNull: true, defaultValue: 'en' },
      avatar_url: { type: Sequelize.STRING(500), allowNull: true },
      preferences: { type: Sequelize.JSON, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
      deleted_at: { type: Sequelize.DATE, allowNull: true },
    });
    await queryInterface.addIndex('users', ['tenant_id']);
    await queryInterface.addIndex('users', ['role']);
    await queryInterface.addIndex('users', ['status']);
    await queryInterface.addIndex('users', ['password_reset_token']);
    await queryInterface.addIndex('users', ['email_verification_token']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('users');
  },
};
