'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('invitations', {
      id: { type: Sequelize.UUID, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      inc: { type: Sequelize.MEDIUMINT.UNSIGNED, autoIncrement: true, unique: true },
      tenant_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'tenants', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      email: { type: Sequelize.STRING(255), allowNull: false },
      name: { type: Sequelize.STRING(200), allowNull: true },
      role: {
        type: Sequelize.ENUM('super_admin', 'admin', 'staff', 'client'),
        defaultValue: 'client',
        allowNull: false,
      },
      token: { type: Sequelize.STRING(255), allowNull: false, unique: true },
      status: {
        type: Sequelize.ENUM('pending', 'accepted', 'expired', 'revoked'),
        defaultValue: 'pending',
        allowNull: false,
      },
      invited_by: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      expires_at: { type: Sequelize.DATE, allowNull: false },
      accepted_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
      deleted_at: { type: Sequelize.DATE, allowNull: true },
    });
    await queryInterface.addIndex('invitations', ['email', 'status']);
    await queryInterface.addIndex('invitations', ['tenant_id']);
    await queryInterface.addIndex('invitations', ['expires_at']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('invitations');
  },
};
