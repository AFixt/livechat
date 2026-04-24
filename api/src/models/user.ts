import bcrypt from 'bcryptjs';
import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from 'sequelize';

import type { Role, UserSafe, UserStatus } from '@livechat/shared';

const BCRYPT_COST = 12;
const LOCKOUT_MINUTES = 30;
const MAX_FAILED_ATTEMPTS = 5;

/**
 * User — an identity record for staff, clients, and admins. Visitors are
 * NOT Users; they live in `VisitorSession`.
 */
export class User extends Model<InferAttributes<User>, InferCreationAttributes<User>> {
  declare id: CreationOptional<string>;
  declare inc: CreationOptional<number>;
  declare email: string;
  declare passwordHash: string;
  declare firstName: string;
  declare lastName: string;
  declare role: CreationOptional<Role>;
  declare tenantId: string | null;
  declare emailVerified: CreationOptional<boolean>;
  declare emailVerificationToken: string | null;
  declare emailVerificationExpires: Date | null;
  declare passwordResetToken: string | null;
  declare passwordResetExpires: Date | null;
  declare failedLoginAttempts: CreationOptional<number>;
  declare lockedUntil: Date | null;
  declare status: CreationOptional<UserStatus>;
  declare lastLoginAt: Date | null;
  declare phone: string | null;
  declare timezone: string | null;
  declare language: CreationOptional<string | null>;
  declare avatarUrl: string | null;
  declare preferences: Record<string, unknown> | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
  declare deletedAt: CreationOptional<Date | null>;

  /**
   * Compare a plaintext password against the stored hash.
   * @param password - Plaintext candidate.
   * @returns True if the hash matches.
   */
  public async comparePassword(password: string): Promise<boolean> {
    return bcrypt.compare(password, this.passwordHash);
  }

  /**
   * True if the account is currently in a lockout window.
   * @returns Whether the user is locked.
   */
  public isLocked(): boolean {
    if (this.lockedUntil === null) return false;
    return new Date() < new Date(this.lockedUntil);
  }

  /**
   * Increment the failed-login counter; lock the account for
   * {@link LOCKOUT_MINUTES} after {@link MAX_FAILED_ATTEMPTS} failures.
   */
  public async incrementFailedAttempts(): Promise<void> {
    this.failedLoginAttempts += 1;
    if (this.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
      this.lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000);
    }
    await this.save();
  }

  /**
   * Reset the lockout state on successful login.
   */
  public async resetFailedAttempts(): Promise<void> {
    this.failedLoginAttempts = 0;
    this.lockedUntil = null;
    await this.save();
  }

  /**
   * Serialize the user to the public "safe" shape — strips all credential
   * and lockout fields.
   * @returns A UserSafe-compatible plain object.
   */
  public toSafeJSON(): UserSafe {
    const values = this.get({ plain: true }) as Record<string, unknown>;
    const {
      passwordHash: _passwordHash,
      emailVerificationToken: _emailVerificationToken,
      emailVerificationExpires: _emailVerificationExpires,
      passwordResetToken: _passwordResetToken,
      passwordResetExpires: _passwordResetExpires,
      failedLoginAttempts: _failedLoginAttempts,
      lockedUntil: _lockedUntil,
      deletedAt: _deletedAt,
      ...safe
    } = values;
    return safe as unknown as UserSafe;
  }
}

/**
 * Initialize the User model on the given sequelize instance.
 * @param sequelize - Sequelize instance.
 */
export function initUserModel(sequelize: Sequelize): void {
  User.init(
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
      email: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
        validate: { isEmail: true, notEmpty: true },
        set(value: string) {
          this.setDataValue('email', value.toLowerCase().trim());
        },
      },
      passwordHash: {
        type: DataTypes.STRING(255),
        allowNull: false,
        field: 'password_hash',
      },
      firstName: {
        type: DataTypes.STRING(100),
        allowNull: false,
        field: 'first_name',
        validate: { notEmpty: true },
      },
      lastName: {
        type: DataTypes.STRING(100),
        allowNull: false,
        field: 'last_name',
        validate: { notEmpty: true },
      },
      role: {
        type: DataTypes.ENUM('super_admin', 'admin', 'staff', 'client'),
        defaultValue: 'client',
        allowNull: false,
      },
      tenantId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'tenant_id',
      },
      emailVerified: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        field: 'email_verified',
      },
      emailVerificationToken: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: 'email_verification_token',
      },
      emailVerificationExpires: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'email_verification_expires',
      },
      passwordResetToken: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: 'password_reset_token',
      },
      passwordResetExpires: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'password_reset_expires',
      },
      failedLoginAttempts: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        field: 'failed_login_attempts',
      },
      lockedUntil: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'locked_until',
      },
      status: {
        type: DataTypes.ENUM('active', 'suspended', 'pending', 'deactivated'),
        defaultValue: 'pending',
        allowNull: false,
      },
      lastLoginAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'last_login_at',
      },
      phone: { type: DataTypes.STRING(50), allowNull: true },
      timezone: { type: DataTypes.STRING(50), allowNull: true },
      language: {
        type: DataTypes.STRING(10),
        allowNull: true,
        defaultValue: 'en',
      },
      avatarUrl: {
        type: DataTypes.STRING(500),
        allowNull: true,
        field: 'avatar_url',
      },
      preferences: { type: DataTypes.JSON, allowNull: true },
      createdAt: { type: DataTypes.DATE, field: 'created_at' },
      updatedAt: { type: DataTypes.DATE, field: 'updated_at' },
      deletedAt: { type: DataTypes.DATE, field: 'deleted_at', allowNull: true },
    },
    {
      sequelize,
      tableName: 'users',
      modelName: 'User',
      timestamps: true,
      paranoid: true,
      underscored: true,
      hooks: {
        beforeCreate: async (user: User) => {
          user.passwordHash = await bcrypt.hash(user.passwordHash, BCRYPT_COST);
        },
        beforeUpdate: async (user: User) => {
          if (user.changed('passwordHash')) {
            user.passwordHash = await bcrypt.hash(user.passwordHash, BCRYPT_COST);
          }
        },
      },
    },
  );
}
