import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from 'sequelize';

import type { ChatInitiatedBy, ChatStatus } from '@livechat/shared';

/**
 * Chat — a single support conversation between a VisitorSession and a User.
 */
export class Chat extends Model<InferAttributes<Chat>, InferCreationAttributes<Chat>> {
  declare id: CreationOptional<string>;
  declare inc: CreationOptional<number>;
  declare tenantId: string;
  declare visitorSessionId: string;
  declare assignedTo: string | null;
  declare initiatedBy: ChatInitiatedBy;
  declare status: CreationOptional<ChatStatus>;
  declare customerName: string | null;
  declare customerEmail: string | null;
  declare startedAt: CreationOptional<Date>;
  declare endedAt: Date | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
  declare deletedAt: CreationOptional<Date | null>;
}

/**
 * Initialize the Chat model.
 * @param sequelize - Sequelize instance.
 */
export function initChatModel(sequelize: Sequelize): void {
  Chat.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      inc: {
        type: DataTypes.MEDIUMINT.UNSIGNED,
        autoIncrement: true,
        unique: true,
      },
      tenantId: { type: DataTypes.UUID, allowNull: false, field: 'tenant_id' },
      visitorSessionId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'visitor_session_id',
      },
      assignedTo: { type: DataTypes.UUID, allowNull: true, field: 'assigned_to' },
      initiatedBy: {
        type: DataTypes.ENUM('customer', 'support'),
        allowNull: false,
        field: 'initiated_by',
      },
      status: {
        type: DataTypes.ENUM(
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
      customerName: {
        type: DataTypes.STRING(200),
        allowNull: true,
        field: 'customer_name',
      },
      customerEmail: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: 'customer_email',
      },
      startedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'started_at',
      },
      endedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'ended_at',
      },
      createdAt: { type: DataTypes.DATE, field: 'created_at' },
      updatedAt: { type: DataTypes.DATE, field: 'updated_at' },
      deletedAt: { type: DataTypes.DATE, field: 'deleted_at', allowNull: true },
    },
    {
      sequelize,
      tableName: 'chats',
      modelName: 'Chat',
      timestamps: true,
      paranoid: true,
      underscored: true,
    },
  );
}
