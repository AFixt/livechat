import { AuditLog, initAuditLogModel } from './audit-log.js';
import { Invitation, initInvitationModel } from './invitation.js';
import { JwtBlacklist, initJwtBlacklistModel } from './jwt-blacklist.js';
import { StaffTenant, initStaffTenantModel } from './staff-tenant.js';
import { Tenant, initTenantModel } from './tenant.js';
import { UserSession, initUserSessionModel } from './user-session.js';
import { User, initUserModel } from './user.js';

import type { Sequelize } from 'sequelize';

/**
 * Initialize every Sequelize model on `sequelize` and wire up associations.
 * Call this exactly once at startup before any model method is used.
 * @param sequelize - The Sequelize instance from `createSequelize`.
 */
export function initModels(sequelize: Sequelize): void {
  initTenantModel(sequelize);
  initUserModel(sequelize);
  initInvitationModel(sequelize);
  initUserSessionModel(sequelize);
  initJwtBlacklistModel(sequelize);
  initStaffTenantModel(sequelize);
  initAuditLogModel(sequelize);

  Tenant.hasMany(User, { foreignKey: 'tenant_id', as: 'users' });
  Tenant.hasMany(Invitation, { foreignKey: 'tenant_id', as: 'invitations' });
  Tenant.hasMany(AuditLog, { foreignKey: 'tenant_id', as: 'auditLogs' });

  User.belongsTo(Tenant, { foreignKey: 'tenant_id', as: 'tenant' });
  User.hasMany(Invitation, { foreignKey: 'invited_by', as: 'sentInvitations' });
  User.hasMany(UserSession, { foreignKey: 'user_id', as: 'sessions' });
  User.hasMany(AuditLog, { foreignKey: 'user_id', as: 'auditLogs' });
  User.belongsToMany(Tenant, {
    through: StaffTenant,
    foreignKey: 'user_id',
    otherKey: 'tenant_id',
    as: 'staffTenants',
  });
  Tenant.belongsToMany(User, {
    through: StaffTenant,
    foreignKey: 'tenant_id',
    otherKey: 'user_id',
    as: 'staffMembers',
  });

  Invitation.belongsTo(Tenant, { foreignKey: 'tenant_id', as: 'tenant' });
  Invitation.belongsTo(User, { foreignKey: 'invited_by', as: 'inviter' });

  UserSession.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
  JwtBlacklist.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
  AuditLog.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
  AuditLog.belongsTo(Tenant, { foreignKey: 'tenant_id', as: 'tenant' });
}

export { AuditLog, Invitation, JwtBlacklist, StaffTenant, Tenant, User, UserSession };
