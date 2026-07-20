'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('chat_messages', {
      id: { type: Sequelize.UUID, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      chat_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'chats', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      sender_kind: {
        type: Sequelize.ENUM('visitor', 'user', 'system'),
        allowNull: false,
      },
      sender_user_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      body: { type: Sequelize.TEXT, allowNull: false },
      delivered_at: { type: Sequelize.DATE, allowNull: false },
      read_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
      deleted_at: { type: Sequelize.DATE, allowNull: true },
    });
    await queryInterface.addIndex('chat_messages', ['chat_id', 'created_at']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('chat_messages');
  },
};
