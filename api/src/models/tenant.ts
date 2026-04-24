import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from 'sequelize';

/**
 * Tenant — a single customer organization hosted on the platform.
 */
export class Tenant extends Model<InferAttributes<Tenant>, InferCreationAttributes<Tenant>> {
  declare id: CreationOptional<string>;
  declare inc: CreationOptional<number>;
  declare name: string;
  declare slug: string;
  declare domain: string | null;
  declare status: CreationOptional<'active' | 'suspended' | 'archived'>;
  declare expiresAt: Date | null;
  declare settings: Record<string, unknown> | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
  declare deletedAt: CreationOptional<Date | null>;
}

/**
 * Initialize the Tenant model on the given sequelize instance.
 * @param sequelize - Sequelize instance returned by `createSequelize`.
 */
export function initTenantModel(sequelize: Sequelize): void {
  Tenant.init(
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
      name: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: { notEmpty: true, len: [1, 255] },
      },
      slug: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
        validate: { notEmpty: true, is: /^[a-z0-9-]+$/i },
      },
      domain: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM('active', 'suspended', 'archived'),
        defaultValue: 'active',
        allowNull: false,
      },
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'expires_at',
      },
      settings: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      createdAt: { type: DataTypes.DATE, field: 'created_at' },
      updatedAt: { type: DataTypes.DATE, field: 'updated_at' },
      deletedAt: { type: DataTypes.DATE, field: 'deleted_at', allowNull: true },
    },
    {
      sequelize,
      tableName: 'tenants',
      modelName: 'Tenant',
      timestamps: true,
      paranoid: true,
      underscored: true,
    },
  );
}
