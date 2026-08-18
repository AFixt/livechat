import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from 'sequelize';

import type {
  ConsentPurpose,
  ConsentSource,
  Jurisdiction,
  LegalBasis,
  PurposeDecision,
  PurposeState,
} from '@livechat/shared';

/**
 * The visitor's raw explicit per-purpose choices, kept separate from the
 * effective {@link ConsentRecord.purposes}. Only purposes the visitor actually
 * set via a banner action appear here — jurisdiction defaults never do. This is
 * what makes a later cross-jurisdiction re-evaluation correct: a purpose that
 * was merely granted-by-default under an opt-out regime must not be read back as
 * an explicit grant under an opt-in regime. See ADR-0019.
 */
type ExplicitPurposes = Partial<Record<ConsentPurpose, PurposeDecision>>;

/**
 * ConsentRecord — the durable tracking-decision + consent record for a single
 * visitor subject. One row is written every time a decision is made or changed
 * (page load, banner action, GPC signal). The most recent row for a
 * `subjectKey` is the visitor's current consent state.
 *
 * The subject is keyed by {@link ConsentRecord.subjectKey} — an HMAC of the
 * signed visitor cookie's session id. It equals `visitor_sessions.session_cookie_hash`
 * when a tracked session exists, so consent survives even when no session row
 * has been (or will be) created. IP is minimized to an HMAC (`ipHash`); the raw
 * address is never stored on this table.
 */
export class ConsentRecord extends Model<
  InferAttributes<ConsentRecord>,
  InferCreationAttributes<ConsentRecord>
> {
  declare id: CreationOptional<string>;
  declare inc: CreationOptional<number>;
  declare tenantId: string;
  declare visitorSessionId: string | null;
  declare subjectKey: string;
  declare jurisdiction: Jurisdiction;
  declare legalBasis: LegalBasis;
  declare source: ConsentSource;
  declare gpc: CreationOptional<boolean>;
  declare ruleVersion: string;
  declare purposes: PurposeState;
  /** The raw explicit choices behind {@link purposes}; see {@link ExplicitPurposes}. */
  declare explicitPurposes: CreationOptional<ExplicitPurposes | null>;
  declare ipHash: string | null;
  /**
   * The visitor's User-Agent, stored raw (≤500 chars). This is the one
   * non-minimized identifying field on an otherwise minimized table, kept
   * deliberately: it is needed for security/abuse triage of a consent decision
   * and mirrors what `visitor_sessions` already retains for the same subject, so
   * it exposes nothing not already held elsewhere. Nullable — never required.
   */
  declare userAgent: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
  declare deletedAt: CreationOptional<Date | null>;
}

/**
 * Initialize the ConsentRecord model.
 * @param sequelize - Sequelize instance.
 */
export function initConsentRecordModel(sequelize: Sequelize): void {
  ConsentRecord.init(
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
      tenantId: { type: DataTypes.UUID, allowNull: false, field: 'tenant_id' },
      visitorSessionId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'visitor_session_id',
      },
      subjectKey: {
        type: DataTypes.STRING(128),
        allowNull: false,
        field: 'subject_key',
      },
      jurisdiction: { type: DataTypes.STRING(16), allowNull: false },
      legalBasis: { type: DataTypes.STRING(32), allowNull: false, field: 'legal_basis' },
      source: {
        type: DataTypes.ENUM('gpc', 'banner', 'default'),
        allowNull: false,
      },
      gpc: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      ruleVersion: { type: DataTypes.STRING(32), allowNull: false, field: 'rule_version' },
      purposes: { type: DataTypes.JSON, allowNull: false },
      explicitPurposes: { type: DataTypes.JSON, allowNull: true, field: 'explicit_purposes' },
      ipHash: { type: DataTypes.STRING(128), allowNull: true, field: 'ip_hash' },
      userAgent: { type: DataTypes.STRING(500), allowNull: true, field: 'user_agent' },
      createdAt: { type: DataTypes.DATE, field: 'created_at' },
      updatedAt: { type: DataTypes.DATE, field: 'updated_at' },
      deletedAt: { type: DataTypes.DATE, field: 'deleted_at', allowNull: true },
    },
    {
      sequelize,
      tableName: 'consent_records',
      modelName: 'ConsentRecord',
      timestamps: true,
      paranoid: true,
      underscored: true,
    },
  );
}
