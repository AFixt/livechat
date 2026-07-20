import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from 'sequelize';

import type { MessageSenderKind } from '@livechat/shared';

/**
 * ChatMessage — a single utterance from a visitor, user, or the system.
 */
export class ChatMessage extends Model<
  InferAttributes<ChatMessage>,
  InferCreationAttributes<ChatMessage>
> {
  declare id: CreationOptional<string>;
  declare chatId: string;
  declare senderKind: MessageSenderKind;
  declare senderUserId: string | null;
  declare body: string;
  declare deliveredAt: CreationOptional<Date>;
  declare readAt: Date | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
  declare deletedAt: CreationOptional<Date | null>;
}

/**
 * Initialize the ChatMessage model.
 * @param sequelize - Sequelize instance.
 */
export function initChatMessageModel(sequelize: Sequelize): void {
  ChatMessage.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      chatId: { type: DataTypes.UUID, allowNull: false, field: 'chat_id' },
      senderKind: {
        type: DataTypes.ENUM('visitor', 'user', 'system'),
        allowNull: false,
        field: 'sender_kind',
      },
      senderUserId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'sender_user_id',
      },
      body: { type: DataTypes.TEXT, allowNull: false },
      deliveredAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'delivered_at',
      },
      readAt: { type: DataTypes.DATE, allowNull: true, field: 'read_at' },
      createdAt: { type: DataTypes.DATE, field: 'created_at' },
      updatedAt: { type: DataTypes.DATE, field: 'updated_at' },
      deletedAt: { type: DataTypes.DATE, field: 'deleted_at', allowNull: true },
    },
    {
      sequelize,
      tableName: 'chat_messages',
      modelName: 'ChatMessage',
      timestamps: true,
      paranoid: true,
      underscored: true,
    },
  );
}
