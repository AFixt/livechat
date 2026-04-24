'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('chat_attachments', {
      id: { type: Sequelize.UUID, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      chat_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'chats', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      message_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'chat_messages', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      uploaded_by_kind: {
        type: Sequelize.ENUM('visitor', 'user'),
        allowNull: false,
      },
      uploaded_by_user_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      s3_key: { type: Sequelize.STRING(500), allowNull: false },
      filename: { type: Sequelize.STRING(255), allowNull: false },
      mime_type: { type: Sequelize.STRING(128), allowNull: false },
      size_bytes: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false },
      deleted_at: { type: Sequelize.DATE, allowNull: true },
    });
    await queryInterface.addIndex('chat_attachments', ['chat_id']);
    await queryInterface.addIndex('chat_attachments', ['message_id']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('chat_attachments');
  },
};
