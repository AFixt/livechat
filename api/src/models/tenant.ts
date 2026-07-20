import { randomBytes } from 'node:crypto';

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
  /**
   * HMAC secret used to verify the identity-token JWT minted by the client's
   * own backend and passed to the widget (requirements.md §3). Auto-generated
   * on create; rotate via `tenantService.rotateEmbedSecret`.
   */
  declare embedSecret: CreationOptional<string>;
  /**
   * Origins allowed to load the widget config and init a visitor session for
   * this tenant. `null` or an empty array means "no restriction" (useful
   * during development). Production tenants set this to their own domain(s).
   */
  declare allowedOrigins: string[] | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
  declare deletedAt: CreationOptional<Date | null>;
}

/**
 * Generate a new 64-character hex secret for tenant identity-token signing.
 * @returns A cryptographically-random hex string.
 */
export function generateEmbedSecret(): string {
  return randomBytes(32).toString('hex');
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
      embedSecret: {
        type: DataTypes.STRING(128),
        allowNull: false,
        field: 'embed_secret',
        defaultValue: () => generateEmbedSecret(),
      },
      allowedOrigins: {
        type: DataTypes.JSON,
        allowNull: true,
        field: 'allowed_origins',
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
