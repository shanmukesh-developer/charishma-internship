// Sample splash ads removed, once (GlobalConfig SAMPLE_SPLASH_ADS_REMOVED_V1_DONE). Owner, 3 Nov 2026: "remove mock data
// from everywhere in the entire project". The 28 Oct seed (marker SAMPLE_SPLASH_ADS_V1_DONE, which lists the ids it
// made) put one switched-off ad per style on real stores, each subline starting "Sample ad.". Every one of them that is
// still a sample (switched off and still starting "Sample ad.") is deleted; an ad the admin switched on or rewrote is
// kept. The seed itself was removed the same day. DISABLE_SAMPLE_SPLASH_ADS_REMOVAL=true switches this off.
const { Op } = require('sequelize');

const MARKER = 'SAMPLE_SPLASH_ADS_REMOVED_V1_DONE';
const SEED_MARKER = 'SAMPLE_SPLASH_ADS_V1_DONE';
const SAMPLE_TEXT = 'Sample ad.';

const runSampleSplashAdsRemoval = async () => {
  if (String(process.env.DISABLE_SAMPLE_SPLASH_ADS_REMOVAL || '').toLowerCase() === 'true') return { skipped: 'disabled' };
  const { getSequelize } = require('../config/db');
  const sequelize = getSequelize();
  const M = (name) => (sequelize && sequelize.models && sequelize.models[name]) || null;
  const GlobalConfig = M('GlobalConfig');
  const SplashAd = M('SplashAd');
  if (!sequelize || !GlobalConfig || !SplashAd) return { skipped: 'models not ready' };
  if (await GlobalConfig.findOne({ where: { key: MARKER } })) return { skipped: 'already done' };

  let seeded = [];
  const seed = await GlobalConfig.findOne({ where: { key: SEED_MARKER } });
  if (seed) {
    let v = seed.value;
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = null; } }
    seeded = (v && Array.isArray(v.created) ? v.created : []).map((c) => String(c && c.id)).filter(Boolean);
  }
  // The seed's ids, and any other ad still carrying its "Sample ad." text (only the seed ever wrote it).
  const rows = await SplashAd.findAll({
    where: { [Op.or]: [...(seeded.length ? [{ id: { [Op.in]: seeded } }] : []), { subline: { [Op.like]: `${SAMPLE_TEXT}%` } }] },
    attributes: ['id', 'isActive', 'subline'],
  });
  const samples = rows.filter((a) => a.isActive === false && String(a.subline || '').startsWith(SAMPLE_TEXT));
  const ids = samples.map((a) => a.id);
  if (ids.length) await SplashAd.destroy({ where: { id: { [Op.in]: ids } } });
  const out = { removed: ids.length, kept: rows.length - ids.length };
  await GlobalConfig.create({ key: MARKER, value: JSON.stringify({ at: new Date().toISOString(), ...out, ids }) });
  return out;
};

module.exports = { runSampleSplashAdsRemoval, MARKER, SEED_MARKER };
