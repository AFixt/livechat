'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('visitor_sessions', {
      id: { type: Sequelize.UUID, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      tenant_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'tenants', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      session_cookie_hash: { type: Sequelize.STRING(128), allowNull: false, unique: true },
      identity_token_sub: { type: Sequelize.STRING(255), allowNull: true },
      user_agent: { type: Sequelize.STRING(500), allowNull: true },
      ip_address: { type: Sequelize.STRING(64), allowNull: true },
      country: { type: Sequelize.STRING(64), allowNull: true },
      city: { type: Sequelize.STRING(128), allowNull: true },
      language: { type: Sequelize.STRING(16), allowNull: true },
      current_url: { type: Sequelize.STRING(2048), allowNull: true },
      referrer: { type: Sequelize.STRING(2048), allowNull: true },
      status: {
        type: Sequelize.ENUM('active', 'idle', 'offline'),
        defaultValue: 'active',
        allowNull: false,
      },
      first_seen_at: { type: Sequelize.DATE, allowNull: false },
      last_seen_at: { type: Sequelize.DATE, allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('visitor_sessions', ['tenant_id', 'status']);
    await queryInterface.addIndex('visitor_sessions', ['last_seen_at']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('visitor_sessions');
  },
};
