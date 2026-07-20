import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from 'sequelize';

import type { InvitationStatus, Role } from '@livechat/shared';

/**
 * Invitation — tokenized, role-scoped, expiring registration grant.
 * A user can only register via `/auth/register` with a valid invitation.
 */
export class Invitation extends Model<
  InferAttributes<Invitation>,
  InferCreationAttributes<Invitation>
> {
  declare id: CreationOptional<string>;
  declare inc: CreationOptional<number>;
  declare tenantId: string | null;
  declare email: string;
  declare name: string | null;
  declare role: CreationOptional<Role>;
  declare token: string;
  declare status: CreationOptional<InvitationStatus>;
  declare invitedBy: string;
  declare expiresAt: Date;
  declare acceptedAt: Date | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
  declare deletedAt: CreationOptional<Date | null>;

  /**
   * True if the invitation's expiration has passed.
   * @returns Whether the invitation is expired.
   */
  public isExpired(): boolean {
    return new Date() > new Date(this.expiresAt);
  }
}

/**
 * Initialize the Invitation model.
 * @param sequelize - Sequelize instance.
 */
export function initInvitationModel(sequelize: Sequelize): void {
  Invitation.init(
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
      tenantId: { type: DataTypes.UUID, allowNull: true, field: 'tenant_id' },
      email: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: { isEmail: true, notEmpty: true },
        set(value: string) {
          this.setDataValue('email', value.toLowerCase().trim());
        },
      },
      name: { type: DataTypes.STRING(200), allowNull: true },
      role: {
        type: DataTypes.ENUM('super_admin', 'admin', 'staff', 'client'),
        defaultValue: 'client',
        allowNull: false,
      },
      token: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
      },
      status: {
        type: DataTypes.ENUM('pending', 'accepted', 'expired', 'revoked'),
        defaultValue: 'pending',
        allowNull: false,
      },
      invitedBy: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'invited_by',
      },
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'expires_at',
      },
      acceptedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'accepted_at',
      },
      createdAt: { type: DataTypes.DATE, field: 'created_at' },
      updatedAt: { type: DataTypes.DATE, field: 'updated_at' },
      deletedAt: { type: DataTypes.DATE, field: 'deleted_at', allowNull: true },
    },
    {
      sequelize,
      tableName: 'invitations',
      modelName: 'Invitation',
      timestamps: true,
      paranoid: true,
      underscored: true,
    },
  );
}
