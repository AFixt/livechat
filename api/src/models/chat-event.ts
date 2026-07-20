import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from 'sequelize';

/**
 * ChatEvent — a non-message happening on a chat (typing, assignment,
 * support-invitation, restart-chat trigger, etc.). Drives UI transitions.
 */
export class ChatEvent extends Model<
  InferAttributes<ChatEvent>,
  InferCreationAttributes<ChatEvent>
> {
  declare id: CreationOptional<string>;
  declare chatId: string;
  declare eventType: string;
  declare actorKind: 'visitor' | 'user' | 'system';
  declare actorUserId: string | null;
  declare payload: Record<string, unknown> | null;
  declare createdAt: CreationOptional<Date>;
}

/**
 * Initialize the ChatEvent model.
 * @param sequelize - Sequelize instance.
 */
export function initChatEventModel(sequelize: Sequelize): void {
  ChatEvent.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      chatId: { type: DataTypes.UUID, allowNull: false, field: 'chat_id' },
      eventType: {
        type: DataTypes.STRING(64),
        allowNull: false,
        field: 'event_type',
      },
      actorKind: {
        type: DataTypes.ENUM('visitor', 'user', 'system'),
        allowNull: false,
        field: 'actor_kind',
      },
      actorUserId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'actor_user_id',
      },
      payload: { type: DataTypes.JSON, allowNull: true },
      createdAt: { type: DataTypes.DATE, field: 'created_at' },
    },
    {
      sequelize,
      tableName: 'chat_events',
      modelName: 'ChatEvent',
      timestamps: true,
      updatedAt: false,
      underscored: true,
    },
  );
}
