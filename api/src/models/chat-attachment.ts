import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from 'sequelize';

/**
 * ChatAttachment — S3-backed file attached to a chat message.
 * Deliberately lean: the uploader owns the S3 key; URLs are presigned on read.
 */
export class ChatAttachment extends Model<
  InferAttributes<ChatAttachment>,
  InferCreationAttributes<ChatAttachment>
> {
  declare id: CreationOptional<string>;
  declare chatId: string;
  declare messageId: string | null;
  declare uploadedByKind: 'visitor' | 'user';
  declare uploadedByUserId: string | null;
  declare s3Key: string;
  declare filename: string;
  declare mimeType: string;
  declare sizeBytes: number;
  declare createdAt: CreationOptional<Date>;
  declare deletedAt: CreationOptional<Date | null>;
}

/**
 * Initialize the ChatAttachment model.
 * @param sequelize - Sequelize instance.
 */
export function initChatAttachmentModel(sequelize: Sequelize): void {
  ChatAttachment.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      chatId: { type: DataTypes.UUID, allowNull: false, field: 'chat_id' },
      messageId: { type: DataTypes.UUID, allowNull: true, field: 'message_id' },
      uploadedByKind: {
        type: DataTypes.ENUM('visitor', 'user'),
        allowNull: false,
        field: 'uploaded_by_kind',
      },
      uploadedByUserId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'uploaded_by_user_id',
      },
      s3Key: { type: DataTypes.STRING(500), allowNull: false, field: 's3_key' },
      filename: { type: DataTypes.STRING(255), allowNull: false },
      mimeType: {
        type: DataTypes.STRING(128),
        allowNull: false,
        field: 'mime_type',
      },
      sizeBytes: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: false,
        field: 'size_bytes',
      },
      createdAt: { type: DataTypes.DATE, field: 'created_at' },
      deletedAt: { type: DataTypes.DATE, field: 'deleted_at', allowNull: true },
    },
    {
      sequelize,
      tableName: 'chat_attachments',
      modelName: 'ChatAttachment',
      timestamps: true,
      updatedAt: false,
      paranoid: true,
      underscored: true,
    },
  );
}
