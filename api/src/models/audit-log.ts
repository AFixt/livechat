import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from 'sequelize';

/**
 * AuditLog — record of security-relevant actions (auth events, admin
 * actions, permission changes). Never deleted.
 */
export class AuditLog extends Model<InferAttributes<AuditLog>, InferCreationAttributes<AuditLog>> {
  declare id: CreationOptional<string>;
  declare userId: string | null;
  declare tenantId: string | null;
  declare action: string;
  declare resourceType: string | null;
  declare resourceId: string | null;
  declare ipAddress: string | null;
  declare userAgent: string | null;
  declare metadata: Record<string, unknown> | null;
  declare createdAt: CreationOptional<Date>;
}

/**
 * Initialize the AuditLog model.
 * @param sequelize - Sequelize instance.
 */
export function initAuditLogModel(sequelize: Sequelize): void {
  AuditLog.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      userId: { type: DataTypes.UUID, allowNull: true, field: 'user_id' },
      tenantId: { type: DataTypes.UUID, allowNull: true, field: 'tenant_id' },
      action: { type: DataTypes.STRING(100), allowNull: false },
      resourceType: {
        type: DataTypes.STRING(100),
        allowNull: true,
        field: 'resource_type',
      },
      resourceId: {
        type: DataTypes.STRING(64),
        allowNull: true,
        field: 'resource_id',
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
      metadata: { type: DataTypes.JSON, allowNull: true },
      createdAt: { type: DataTypes.DATE, field: 'created_at' },
    },
    {
      sequelize,
      tableName: 'audit_logs',
      modelName: 'AuditLog',
      timestamps: true,
      updatedAt: false,
      underscored: true,
    },
  );
}
