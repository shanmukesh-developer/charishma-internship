// Campus (Friends) switched off once (GlobalConfig CAMPUS_OFF_UNTIL_LAUNCH_V1_DONE). Owner, 2 Nov 2026 night, before
// the Play submission: "block the campus section ... don't delete code, but remove that in app" and "after Sankranti
// I will launch that feature". Sets the admins' master switch (friends.config enabled = false, the same switch as
// Admin > Friends app > Switches): the app hides the Home "Campus" button, its promo and the onboarding Campus page
// (GET /api/config/sections campus.live), and every Campus API answers FEATURE_OFF. No code or data is removed and the
// sub-tab switches are kept. It runs once, so the admins can switch Campus back on from the admin at launch.
// DISABLE_CAMPUS_OFF_ONCE=true switches it off.
const MARKER = 'CAMPUS_OFF_UNTIL_LAUNCH_V1_DONE';

const runCampusOffOnce = async () => {
  if (String(process.env.DISABLE_CAMPUS_OFF_ONCE || '').toLowerCase() === 'true') return { skipped: 'disabled' };
  const { getSequelize } = require('../config/db');
  const sequelize = getSequelize();
  const GlobalConfig = sequelize && sequelize.models && sequelize.models.GlobalConfig;
  if (!GlobalConfig) return { skipped: 'models not ready' };
  if (await GlobalConfig.findOne({ where: { key: MARKER } })) return { skipped: 'already done' };
  const flags = require('../modules/friends/services/featureFlags');
  const wasOn = (await flags.getConfig({ fresh: true })).enabled;
  if (wasOn) {
    const saved = await flags.setConfig({ enabled: false });
    if (saved.errors) return { error: saved.errors.join('; ') }; // no marker: tried again on the next start
  }
  const out = { campus: wasOn ? 'switched off' : 'was already off' };
  await GlobalConfig.create({ key: MARKER, value: JSON.stringify({ at: new Date().toISOString(), ...out }) });
  return out;
};

module.exports = { runCampusOffOnce, MARKER };
