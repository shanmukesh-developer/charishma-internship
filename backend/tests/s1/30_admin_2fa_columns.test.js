// The live AdminTwoFactors table predates the email-code method: models/AdminTwoFactor adds the missing columns
// once (never changes or drops one), an existing authenticator row keeps working as 'totp', and a second start
// adds nothing. Temp SQLite only.
process.env.NODE_ENV = 'test';
delete process.env.DATABASE_URL;

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const B = path.join(__dirname, '..', '..');
const r = (rel) => require(path.join(B, rel));
const { Sequelize } = require(path.join(B, 'node_modules/sequelize'));

const NEW_COLUMNS = ['method', 'email', 'pendingEmail', 'emailCodeHash', 'emailCodeExpiresAt', 'emailCodeSentAt', 'emailWindowStart', 'emailSendCount'];
let sequelize;
let file;

test.before(async () => {
  file = path.join(os.tmpdir(), `admin-2fa-cols-${process.pid}-${crypto.randomBytes(4).toString('hex')}.sqlite`);
  sequelize = new Sequelize({ dialect: 'sqlite', storage: file, logging: false });
  r('models/User').initUserModel(sequelize);
  // The table as the first 2-step release created it.
  await sequelize.query(`CREATE TABLE AdminTwoFactors (id UUID PRIMARY KEY, userId VARCHAR(64) NOT NULL UNIQUE, enabled TINYINT(1) NOT NULL DEFAULT 0,
    secretEnc TEXT, pendingSecretEnc TEXT, pendingCreatedAt DATETIME, enabledAt DATETIME, lastUsedStep BIGINT, recoveryCodes TEXT,
    failedCount INTEGER NOT NULL DEFAULT 0, lockedUntil DATETIME, mfaJti VARCHAR(64), createdAt DATETIME NOT NULL, updatedAt DATETIME NOT NULL)`);
  await sequelize.query(`INSERT INTO AdminTwoFactors (id, userId, enabled, secretEnc, failedCount, createdAt, updatedAt)
    VALUES ('${crypto.randomUUID()}', 'old-admin', 1, 'v1.j.x.y.z', 0, '2026-10-20 10:00:00', '2026-10-20 10:00:00')`);
});

test.after(async () => {
  await sequelize.close();
  for (const f of [file, `${file}-journal`]) { try { fs.unlinkSync(f); } catch { /* gone */ } }
});

test('the email-code columns are added to an old table; the old authenticator row still counts as on', async () => {
  const before = await sequelize.getQueryInterface().describeTable('AdminTwoFactors');
  for (const c of NEW_COLUMNS) assert.ok(!before[c], `${c} missing before`);
  const { getAdminTwoFactorModel } = r('models/AdminTwoFactor');
  const M = await getAdminTwoFactorModel();
  const after = await sequelize.getQueryInterface().describeTable('AdminTwoFactors');
  for (const c of NEW_COLUMNS) assert.ok(after[c], `${c} added`);
  assert.strictEqual(Object.keys(after).length, Object.keys(before).length + NEW_COLUMNS.length, 'nothing else changed');
  const old = await M.findOne({ where: { userId: 'old-admin' } });
  assert.strictEqual(old.enabled, true);
  assert.strictEqual(old.method, null, 'an old row has no method: the service treats it as the authenticator');
  assert.strictEqual(old.secretEnc, 'v1.j.x.y.z', 'existing data untouched');
  const svc = r('services/adminTwoFactor');
  assert.strictEqual(await svc.isEnabled('old-admin'), true);
  // A second call (another request / start) adds nothing and does not fail.
  assert.strictEqual(await getAdminTwoFactorModel(), M);
});
