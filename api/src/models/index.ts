import { AuditLog, initAuditLogModel } from './audit-log.js';
import { ChatEvent, initChatEventModel } from './chat-event.js';
import { ChatMessage, initChatMessageModel } from './chat-message.js';
import { Chat, initChatModel } from './chat.js';
import { ConsentRecord, initConsentRecordModel } from './consent-record.js';
import { Invitation, initInvitationModel } from './invitation.js';
import { JwtBlacklist, initJwtBlacklistModel } from './jwt-blacklist.js';
import { StaffTenant, initStaffTenantModel } from './staff-tenant.js';
import { Tenant, initTenantModel } from './tenant.js';
import { UserSession, initUserSessionModel } from './user-session.js';
import { User, initUserModel } from './user.js';
import { VisitorSession, initVisitorSessionModel } from './visitor-session.js';

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
  initVisitorSessionModel(sequelize);
  initChatModel(sequelize);
  initChatMessageModel(sequelize);
  initChatEventModel(sequelize);
  initConsentRecordModel(sequelize);

  Tenant.hasMany(User, { foreignKey: 'tenant_id', as: 'users' });
  Tenant.hasMany(Invitation, { foreignKey: 'tenant_id', as: 'invitations' });
  Tenant.hasMany(AuditLog, { foreignKey: 'tenant_id', as: 'auditLogs' });
  Tenant.hasMany(VisitorSession, { foreignKey: 'tenant_id', as: 'visitorSessions' });
  Tenant.hasMany(Chat, { foreignKey: 'tenant_id', as: 'chats' });

  User.belongsTo(Tenant, { foreignKey: 'tenant_id', as: 'tenant' });
  User.hasMany(Invitation, { foreignKey: 'invited_by', as: 'sentInvitations' });
  User.hasMany(UserSession, { foreignKey: 'user_id', as: 'sessions' });
  User.hasMany(AuditLog, { foreignKey: 'user_id', as: 'auditLogs' });
  User.hasMany(Chat, { foreignKey: 'assigned_to', as: 'assignedChats' });
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

  VisitorSession.belongsTo(Tenant, { foreignKey: 'tenant_id', as: 'tenant' });
  VisitorSession.hasMany(Chat, { foreignKey: 'visitor_session_id', as: 'chats' });
  VisitorSession.hasMany(ConsentRecord, {
    foreignKey: 'visitor_session_id',
    as: 'consentRecords',
  });

  ConsentRecord.belongsTo(Tenant, { foreignKey: 'tenant_id', as: 'tenant' });
  ConsentRecord.belongsTo(VisitorSession, {
    foreignKey: 'visitor_session_id',
    as: 'visitorSession',
  });

  Chat.belongsTo(Tenant, { foreignKey: 'tenant_id', as: 'tenant' });
  Chat.belongsTo(VisitorSession, { foreignKey: 'visitor_session_id', as: 'visitor' });
  Chat.belongsTo(User, { foreignKey: 'assigned_to', as: 'assignee' });
  Chat.hasMany(ChatMessage, { foreignKey: 'chat_id', as: 'messages' });
  Chat.hasMany(ChatEvent, { foreignKey: 'chat_id', as: 'events' });

  ChatMessage.belongsTo(Chat, { foreignKey: 'chat_id', as: 'chat' });
  ChatMessage.belongsTo(User, { foreignKey: 'sender_user_id', as: 'senderUser' });

  ChatEvent.belongsTo(Chat, { foreignKey: 'chat_id', as: 'chat' });
  ChatEvent.belongsTo(User, { foreignKey: 'actor_user_id', as: 'actorUser' });
}

export {
  AuditLog,
  Chat,
  ChatEvent,
  ChatMessage,
  ConsentRecord,
  Invitation,
  JwtBlacklist,
  StaffTenant,
  Tenant,
  User,
  UserSession,
  VisitorSession,
};
