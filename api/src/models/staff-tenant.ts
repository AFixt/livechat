import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from 'sequelize';

/**
 * StaffTenant — many-to-many through-table so staff can be scoped to a
 * subset of tenants when needed.
 */
export class StaffTenant extends Model<
  InferAttributes<StaffTenant>,
  InferCreationAttributes<StaffTenant>
> {
  declare id: CreationOptional<string>;
  declare userId: string;
  declare tenantId: string;
  declare createdAt: CreationOptional<Date>;
}

/**
 * Initialize the StaffTenant model.
 * @param sequelize - Sequelize instance.
 */
export function initStaffTenantModel(sequelize: Sequelize): void {
  StaffTenant.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      userId: { type: DataTypes.UUID, allowNull: false, field: 'user_id' },
      tenantId: { type: DataTypes.UUID, allowNull: false, field: 'tenant_id' },
      createdAt: { type: DataTypes.DATE, field: 'created_at' },
    },
    {
      sequelize,
      tableName: 'staff_tenants',
      modelName: 'StaffTenant',
      timestamps: true,
      updatedAt: false,
      underscored: true,
    },
  );
}
