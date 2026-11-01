// Startup step (C1-1): admin accounts that still use a password the old seed scripts published.
// Older builds ran scripts/unified_seed.js / scripts/seed_full.js against production, creating admins
// 9999999999 / 9391955674 with hard-coded passwords. Anyone who read the repository could sign in.
//
// For every User with role admin whose password still verifies against one of those passwords:
//  - env ADMIN_RESET_PASSWORD (else DEMO_ADMIN_NEW_PASSWORD) set (12+ characters, not a seed
//    password): the password is replaced by it (hashed by the
//    User model hook, which also bumps tokenVersion so every older session / socket ends) and
//    "[ADMIN_SEED_RESET] reset weak password for admin ****5674" is logged.
//  - env not set: NOTHING is changed (the owner must never be locked out of the dashboard); a loud
//    warning is logged on every boot until it is fixed.
// Idempotent (an account is only touched while it still uses a seed password), single runner across
// processes (utils/jobs.runExclusive, name 'admin.seedPasswordReset'). Never logs a password.
const SEED_ADMIN_PASSWORDS = Object.freeze(['admin123', 'zenvy_admin', 'password123']);
const MIN_RESET_LENGTH = 12;
const RESET_ENV_NAMES = Object.freeze(['ADMIN_RESET_PASSWORD', 'DEMO_ADMIN_NEW_PASSWORD']);
const JOB_NAME = 'admin.seedPasswordReset';

const maskPhone = (phone) => `****${String(phone || '').replace(/\D/g, '').slice(-4) || '????'}`;

const usesSeedPassword = async (user) => {
  if (!user || !user.password) return false;
  for (const pw of SEED_ADMIN_PASSWORDS) {
    try {
      if (await user.comparePassword(pw)) return true;
    } catch { /* malformed hash: not a seed password */ }
  }
  return false;
};

/** One pass. Resolves { checked, weak, reset, warned }. Never logs secrets. */
const runAdminSeedReset = async ({ env = process.env, User: UserArg } = {}) => {
  const out = { checked: 0, weak: 0, reset: 0, warned: 0, source: null };
  const User = UserArg || require('../models/User').getUserModel();
  if (!User) return out;
  const { fn, col, where: sqlWhere } = require('sequelize');
  const admins = await User.findAll({ where: sqlWhere(fn('lower', col('role')), 'admin') });
  // ADMIN_RESET_PASSWORD first, else DEMO_ADMIN_NEW_PASSWORD (already set on Render for
  // scripts/demo_data_cleanup.js). Same rules for both: 12+ characters, not a published seed password.
  const valid = (v) => typeof v === 'string' && v.length >= MIN_RESET_LENGTH && !SEED_ADMIN_PASSWORDS.includes(v);
  let source = null;
  for (const name of RESET_ENV_NAMES) {
    const v = env[name];
    if (v === undefined || v === null || v === '') continue;
    if (valid(v)) { if (!source) source = name; }
    else console.warn(`⚠️ [ADMIN_SEED_RESET] ${name} is set but ignored: it must be at least ${MIN_RESET_LENGTH} characters and not a published seed password.`);
  }
  const wanted = source ? env[source] : '';
  const canReset = !!source;
  out.source = source;
  for (const admin of admins) {
    out.checked++;
    if (!(await usesSeedPassword(admin))) continue;
    out.weak++;
    const masked = maskPhone(admin.phone);
    if (!canReset) {
      out.warned++;
      console.warn(`🚨 [ADMIN_SEED_RESET] admin ${masked} still uses a known seed password — set ADMIN_RESET_PASSWORD (or DEMO_ADMIN_NEW_PASSWORD) on Render`);
      continue;
    }
    admin.password = wanted; // hashed by the User beforeUpdate hook, which also bumps tokenVersion
    await admin.save();
    out.reset++;
    try { require('../middleware/authMiddleware').clearCachedUser(admin.id); } catch { /* cache is best effort */ }
    try { require('../utils/realtime').disconnectRevokedSockets(admin.id, admin.tokenVersion); } catch { /* best effort */ }
    console.warn(`🔐 [ADMIN_SEED_RESET] reset weak password for admin ${masked} (new password from ${source})`);
  }
  if (out.reset > 0) console.warn(`🔐 [ADMIN_SEED_RESET] Sign in to the dashboard with the password from ${source}, then change it from the dashboard (or via Forgot password) and remove ADMIN_RESET_PASSWORD / DEMO_ADMIN_NEW_PASSWORD from Render. Accounts that no longer use a seed password are never touched again.`);
  return out;
};

/** Startup entry: single runner across processes. Resolves runExclusive's outcome. */
const startAdminSeedReset = (opts = {}) => {
  const { runExclusive } = require('../utils/jobs');
  return runExclusive(JOB_NAME, () => runAdminSeedReset(opts), { timeoutMs: 2 * 60 * 1000 });
};

module.exports = { runAdminSeedReset, startAdminSeedReset, usesSeedPassword, SEED_ADMIN_PASSWORDS, RESET_ENV_NAMES, maskPhone, JOB_NAME };
