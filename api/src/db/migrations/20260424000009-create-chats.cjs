'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('chats', {
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
        allowNull: false,
        references: { model: 'visitor_sessions', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      assigned_to: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      initiated_by: {
        type: Sequelize.ENUM('customer', 'support'),
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM(
          'pending',
          'active',
          'waiting',
          'ended_by_customer',
          'ended_by_support',
          'abandoned',
        ),
        defaultValue: 'pending',
        allowNull: false,
      },
      customer_name: { type: Sequelize.STRING(200), allowNull: true },
      customer_email: { type: Sequelize.STRING(255), allowNull: true },
      started_at: { type: Sequelize.DATE, allowNull: false },
      ended_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
      deleted_at: { type: Sequelize.DATE, allowNull: true },
    });
    await queryInterface.addIndex('chats', ['tenant_id', 'status']);
    await queryInterface.addIndex('chats', ['assigned_to']);
    await queryInterface.addIndex('chats', ['visitor_session_id']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('chats');
  },
};
