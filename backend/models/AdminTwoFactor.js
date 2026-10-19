// S1: admin 2-step sign-in (TOTP) state, one row per admin user. Its own table (AdminTwoFactors), created
// additively with sync() on first use / at startup on the same Sequelize instance as Users. Never altered
// or dropped by code. The TOTP secret is stored AES-256-GCM encrypted (utils/totp.js); recovery codes as
// SHA-256 hashes only.
const { DataTypes } = require('sequelize');

let Model = null;
let ready = null;

const define = (sequelize) => sequelize.define('AdminTwoFactor', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId: { type: DataTypes.STRING(64), allowNull: false, unique: true },
  enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  // encrypted current secret (when enabled) / secret being enrolled (setup, not yet confirmed)
  secretEnc: { type: DataTypes.TEXT, allowNull: true },
  pendingSecretEnc: { type: DataTypes.TEXT, allowNull: true },
  pendingCreatedAt: { type: DataTypes.DATE, allowNull: true },
  enabledAt: { type: DataTypes.DATE, allowNull: true },
  // highest 30 s step accepted (a code is never accepted twice)
  lastUsedStep: { type: DataTypes.BIGINT, allowNull: true },
  // JSON [{ h: sha256 hex, usedAt: iso|null }]
  recoveryCodes: { type: DataTypes.TEXT, allowNull: true },
  failedCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  lockedUntil: { type: DataTypes.DATE, allowNull: true },
  // the one outstanding sign-in challenge (mfaToken jti); cleared when used
  mfaJti: { type: DataTypes.STRING(64), allowNull: true },
}, { tableName: 'AdminTwoFactors' });

/** The model, defined on the Users' Sequelize instance and its table created once (CREATE TABLE IF NOT EXISTS). */
const getAdminTwoFactorModel = async () => {
  const { getUserModel } = require('./User');
  const User = getUserModel();
  const sequelize = User && User.sequelize;
  if (!sequelize) return null;
  if (!Model || Model.sequelize !== sequelize) {
    Model = sequelize.models.AdminTwoFactor || define(sequelize);
    ready = null;
  }
  if (!ready) {
    const m = Model;
    ready = m.sync().then(() => m).catch((err) => { ready = null; throw err; });
  }
  return ready;
};

module.exports = { getAdminTwoFactorModel };
