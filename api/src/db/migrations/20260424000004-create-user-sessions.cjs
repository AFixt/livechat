'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('user_sessions', {
      id: { type: Sequelize.UUID, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      user_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      session_id: { type: Sequelize.STRING(64), allowNull: false, unique: true },
      refresh_token_hash: { type: Sequelize.STRING(255), allowNull: false },
      jti: { type: Sequelize.STRING(64), allowNull: false, unique: true },
      ip_address: { type: Sequelize.STRING(64), allowNull: true },
      user_agent: { type: Sequelize.STRING(500), allowNull: true },
      expires_at: { type: Sequelize.DATE, allowNull: false },
      last_activity_at: { type: Sequelize.DATE, allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('user_sessions', ['user_id']);
    await queryInterface.addIndex('user_sessions', ['expires_at']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('user_sessions');
  },
};
