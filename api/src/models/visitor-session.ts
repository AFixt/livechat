import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from 'sequelize';

import type { VisitorStatus } from '@livechat/shared';

/**
 * VisitorSession — anonymous or tokenized site visitor. Not a User.
 */
export class VisitorSession extends Model<
  InferAttributes<VisitorSession>,
  InferCreationAttributes<VisitorSession>
> {
  declare id: CreationOptional<string>;
  declare tenantId: string;
  declare sessionCookieHash: string;
  declare identityTokenSub: string | null;
  declare userAgent: string | null;
  declare ipAddress: string | null;
  declare country: string | null;
  declare city: string | null;
  declare language: string | null;
  declare currentUrl: string | null;
  declare referrer: string | null;
  declare status: CreationOptional<VisitorStatus>;
  declare firstSeenAt: CreationOptional<Date>;
  declare lastSeenAt: CreationOptional<Date>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

/**
 * Initialize the VisitorSession model.
 * @param sequelize - Sequelize instance.
 */
export function initVisitorSessionModel(sequelize: Sequelize): void {
  VisitorSession.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      tenantId: { type: DataTypes.UUID, allowNull: false, field: 'tenant_id' },
      sessionCookieHash: {
        type: DataTypes.STRING(128),
        allowNull: false,
        unique: true,
        field: 'session_cookie_hash',
      },
      identityTokenSub: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: 'identity_token_sub',
      },
      userAgent: { type: DataTypes.STRING(500), allowNull: true, field: 'user_agent' },
      ipAddress: { type: DataTypes.STRING(64), allowNull: true, field: 'ip_address' },
      country: { type: DataTypes.STRING(64), allowNull: true },
      city: { type: DataTypes.STRING(128), allowNull: true },
      language: { type: DataTypes.STRING(16), allowNull: true },
      currentUrl: { type: DataTypes.STRING(2048), allowNull: true, field: 'current_url' },
      referrer: { type: DataTypes.STRING(2048), allowNull: true },
      status: {
        type: DataTypes.ENUM('active', 'idle', 'offline'),
        defaultValue: 'active',
        allowNull: false,
      },
      firstSeenAt: { type: DataTypes.DATE, field: 'first_seen_at', allowNull: false },
      lastSeenAt: { type: DataTypes.DATE, field: 'last_seen_at', allowNull: false },
      createdAt: { type: DataTypes.DATE, field: 'created_at' },
      updatedAt: { type: DataTypes.DATE, field: 'updated_at' },
    },
    {
      sequelize,
      tableName: 'visitor_sessions',
      modelName: 'VisitorSession',
      timestamps: true,
      underscored: true,
    },
  );
}
