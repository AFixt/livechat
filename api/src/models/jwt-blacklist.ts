import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from 'sequelize';

/**
 * JwtBlacklist — durable record of revoked access-token JTIs. Redis is the
 * fast path; this table is the source of truth if Redis is evicted.
 */
export class JwtBlacklist extends Model<
  InferAttributes<JwtBlacklist>,
  InferCreationAttributes<JwtBlacklist>
> {
  declare id: CreationOptional<string>;
  declare userId: string;
  declare jti: string;
  declare expiresAt: Date;
  declare createdAt: CreationOptional<Date>;
}

/**
 * Initialize the JwtBlacklist model.
 * @param sequelize - Sequelize instance.
 */
export function initJwtBlacklistModel(sequelize: Sequelize): void {
  JwtBlacklist.init(
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
      jti: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true,
      },
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'expires_at',
      },
      createdAt: { type: DataTypes.DATE, field: 'created_at' },
    },
    {
      sequelize,
      tableName: 'jwt_blacklist',
      modelName: 'JwtBlacklist',
      timestamps: true,
      updatedAt: false,
      underscored: true,
    },
  );
}
