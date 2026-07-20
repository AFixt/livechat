import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from 'sequelize';

/**
 * UserSession — one row per active refresh token. Deleted on logout,
 * password change, and password reset.
 */
export class UserSession extends Model<
  InferAttributes<UserSession>,
  InferCreationAttributes<UserSession>
> {
  declare id: CreationOptional<string>;
  declare userId: string;
  declare sessionId: string;
  declare refreshTokenHash: string;
  declare jti: string;
  declare ipAddress: string | null;
  declare userAgent: string | null;
  declare expiresAt: Date;
  declare lastActivityAt: Date;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

/**
 * Initialize the UserSession model.
 * @param sequelize - Sequelize instance.
 */
export function initUserSessionModel(sequelize: Sequelize): void {
  UserSession.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'user_id',
      },
      sessionId: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true,
        field: 'session_id',
      },
      refreshTokenHash: {
        type: DataTypes.STRING(255),
        allowNull: false,
        field: 'refresh_token_hash',
      },
      jti: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true,
      },
      ipAddress: {
        type: DataTypes.STRING(64),
        allowNull: true,
        field: 'ip_address',
      },
      userAgent: {
        type: DataTypes.STRING(500),
        allowNull: true,
        field: 'user_agent',
      },
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'expires_at',
      },
      lastActivityAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'last_activity_at',
      },
      createdAt: { type: DataTypes.DATE, field: 'created_at' },
      updatedAt: { type: DataTypes.DATE, field: 'updated_at' },
    },
    {
      sequelize,
      tableName: 'user_sessions',
      modelName: 'UserSession',
      timestamps: true,
      underscored: true,
    },
  );
}
