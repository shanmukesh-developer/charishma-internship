// Legal business name ZCS -> ZENV, once (GlobalConfig LEGAL_BUSINESS_NAME_ZENV_V1_DONE). Owner, 4 Nov 2026: "AT LAST
// MINUTE WE CHANGED NAME OF COMPANY AND LOGO", "PRIVACY POLICY ETC EVERYTHING". The /legal pages, receipts and the
// apps' "By continuing you agree" line read the business name from GlobalConfig LEGAL_SETTINGS (admin Config ->
// Legal). If the saved name is exactly 'ZCS' (the old default, saved with the first edit there) it becomes 'ZENV';
// every other field of the row stays as it is, and a name the admins typed themselves is kept. Nothing is created
// when the settings were never saved (the code default is ZENV already). Runs once, so an admin can still change
// the name afterwards.
//
// Two instances booting together: the work runs under one advisory lock (utils/pgLock) and re-checks the marker
// inside it, so the second one waits and then skips. If the lock cannot be taken (it fails open), both may run: the
// rename is the same either way and the marker is written with findOrCreate, so neither fails on its unique key.
// DISABLE_LEGAL_BUSINESS_NAME_ZENV=true switches it off.
const MARKER = 'LEGAL_BUSINESS_NAME_ZENV_V1_DONE';
const OLD_NAME = 'ZCS';
const NEW_NAME = 'ZENV';

const runLegalBusinessNameZenv = async () => {
  if (String(process.env.DISABLE_LEGAL_BUSINESS_NAME_ZENV || '').toLowerCase() === 'true') return { skipped: 'disabled' };
  const { getSequelize } = require('../config/db');
  const sequelize = getSequelize();
  const GlobalConfig = sequelize && sequelize.models && sequelize.models.GlobalConfig;
  if (!GlobalConfig) return { skipped: 'models not ready' };
  if (await GlobalConfig.findOne({ where: { key: MARKER } })) return { skipped: 'already done' };

  const legal = require('../utils/legalSettings');
  const { withAdvisoryXactLock } = require('../utils/pgLock');
  let renamed = false;
  const out = await withAdvisoryXactLock(sequelize, MARKER, async (t) => {
    const tx = t ? { transaction: t } : {};
    // Another instance may have finished while this one waited for the lock.
    if (await GlobalConfig.findOne({ where: { key: MARKER }, ...tx })) return { skipped: 'already done' };
    const row = await GlobalConfig.findOne({ where: { key: legal.KEY }, ...tx, ...(t ? { lock: t.LOCK.UPDATE } : {}) });
    let result;
    if (!row) {
      result = { businessName: 'not saved (the default is ZENV)' };
    } else {
      const raw = row.value;
      let v = raw;
      if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = null; } }
      if (v && typeof v === 'object' && !Array.isArray(v) && v.businessName === OLD_NAME) {
        // Only the name changes; the stored shape stays (an object, or JSON text if it was saved that way).
        const next = { ...v, businessName: NEW_NAME };
        await row.update({ value: typeof raw === 'string' ? JSON.stringify(next) : next }, tx);
        renamed = true;
        result = { businessName: `${OLD_NAME} -> ${NEW_NAME}` };
      } else {
        const current = v && typeof v === 'object' && typeof v.businessName === 'string' ? v.businessName.slice(0, 120) : null;
        result = { businessName: 'kept', current };
      }
    }
    // Under the lock nobody else writes the marker. Without it (failed open, or SQLite) another instance may just have
    // written it: the unique key refuses the second copy, which is fine (findOrCreate inside the transaction, so a
    // clash never aborts it; a plain create otherwise, since a transaction of its own could wait on the other one).
    const marker = { key: MARKER, value: { at: new Date().toISOString(), ...result }, description: 'Once: legal business name ZCS -> ZENV (scripts/legal_business_name_zenv_v1.js)' };
    if (t) {
      await GlobalConfig.findOrCreate({ where: { key: MARKER }, defaults: marker, transaction: t });
    } else {
      try { await GlobalConfig.create(marker); } catch (err) { if (!(err && err.name === 'SequelizeUniqueConstraintError')) throw err; }
    }
    return result;
  });
  if (renamed) {
    // After the commit, as an admin save does (controllers/legalController): every instance re-reads the settings
    // (cacheBus), the cached public /api/config/legal answer is dropped and the apps are told to refresh.
    legal.clearCache();
    try { require('../utils/realtime').publish('config', 'updated', 'legal_settings', { scope: 'legal_settings' }); } catch { /* best effort */ }
  }
  return out;
};

module.exports = { runLegalBusinessNameZenv, MARKER, OLD_NAME, NEW_NAME };
