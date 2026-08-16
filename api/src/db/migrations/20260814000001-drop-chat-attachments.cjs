'use strict';

// Attachments are deferred (#80): the schema, model and required S3 secrets
// existed but there was no upload/download route or UI, so every deployment had
// to supply real S3 credentials for a feature that did not exist. This drops
// the table until the feature is scheduled; `down` recreates it (mirrors
// 20260424000012-create-chat-attachments) so the change is reversible.

module.exports = {
  async up(queryInterface) {
    await queryInterface.dropTable('chat_attachments');
  },

  async down(queryInterface, Sequelize) {
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
};
