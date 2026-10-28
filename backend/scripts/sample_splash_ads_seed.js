// Sample splash ads (runs on every startup from server.js, once per database).
//
// Owner, 28 Oct 2026: "mock some ads" so every one of the 8 splash ad styles can be seen on a phone. One SAMPLE ad
// per style, each on a real live store and that store's own photo, all SWITCHED OFF: students never see them; the
// owner plays each one with "Preview on phone" in admin > Splash ads, and switches on or deletes them there.
// Rules, same pattern as scripts/partner_test_accounts_seed.js / auto_routes_seed.js:
//  - text is plainly marked: every subline starts "Sample ad." (never presented as a real offer);
//  - stores: active and publicly listed (the ad routes refuse to switch on an ad for a hidden store), with an
//    https photo that is not the generic fallback; never a "ZCS Test" partner account; a different store per ad;
//  - create-only, one transaction with the GlobalConfig marker SAMPLE_SPLASH_ADS_V1_DONE: two instances booting at
//    once never both create them, and once the marker exists this never runs again (an ad the admin deletes is not
//    re-created). The marker lists the created ids. Delete it to re-run; DISABLE_SAMPLE_SPLASH_ADS=true turns it off.
const { Op } = require('sequelize');

const DEFAULT_MARKER = 'SAMPLE_SPLASH_ADS_V1_DONE';
const COPY = [
  ['tear', '20% OFF', 'Taste the real\nflavour', 'Sample ad. Fresh from the kitchen today', '#7d2c12', '#120805'],
  ['scratch', 'FLAT 15% OFF', 'Scratch for\na treat', 'Sample ad. Your campus favourite', '#6e3c12', '#0e0905'],
  ['envelope', '25% OFF', 'A note from\nnext door', 'Sample ad. Made fresh every morning', '#1e6b43', '#06140e'],
  ['gift', '30% OFF', 'Something\nspecial', 'Sample ad. Today only', '#13563a', '#050e09'],
  ['glass', '10% OFF', 'Clear view,\nfresh deal', 'Sample ad. Order in two taps', '#244d6b', '#081521'],
  ['coupon', 'FLAT 20% OFF', 'Good food,\ngood mood', 'Sample ad. On your next order', '#8a1d16', '#1b0807'],
  ['portal', '15% OFF', 'Step into\nflavour', 'Sample ad. Near your hostel', '#0f5c3a', '#04100a'],
  ['peel', '20% OFF', 'Peel for\na deal', 'Sample ad. Limited time', '#a11319', '#2b0606'],
];
const FALLBACK_PHOTO = /photo-1546069901-ba9599a7e63c/; // the listing's generic fallback image

const runSampleSplashAdsSeed = async ({ marker = DEFAULT_MARKER } = {}) => {
  if (String(process.env.DISABLE_SAMPLE_SPLASH_ADS || '').toLowerCase() === 'true') return { skipped: 'disabled' };
  const { getSequelize } = require('../config/db');
  const { getGlobalConfigModel } = require('../models/GlobalConfig');
  const { getSplashAdModel } = require('../models/SplashAd');
  const { getRestaurantModel } = require('../models/Restaurant');
  const sequelize = getSequelize();
  const GlobalConfig = getGlobalConfigModel();
  const SplashAd = getSplashAdModel();
  const Restaurant = getRestaurantModel();
  if (!sequelize || !GlobalConfig || !SplashAd || !Restaurant) return { skipped: 'models not ready' };
  if (await GlobalConfig.findOne({ where: { key: marker } })) return { skipped: 'already done' };

  const stores = await Restaurant.findAll({
    where: { isActive: true, name: { [Op.notLike]: 'ZCS Test %' }, ...(await require('../utils/receiptSettings').listingWhere()) },
    attributes: ['id', 'name', 'imageUrl'],
    order: [['rating', 'DESC'], ['name', 'ASC']],
    limit: 200,
  });
  const usable = stores.filter((s) => /^https:\/\//i.test(String(s.imageUrl || '')) && String(s.imageUrl).length < 1000 && !FALLBACK_PHOTO.test(s.imageUrl));
  if (usable.length < COPY.length) return { skipped: `only ${usable.length} live stores with their own photo` };

  const result = { created: [] };
  try {
    await sequelize.transaction(async (t) => {
      for (let i = 0; i < COPY.length; i++) {
        const [style, offerText, headline, subline, colorA, colorB] = COPY[i];
        const store = usable[i * (usable.length >= COPY.length * 3 ? 3 : 1)]; // spread across the list, never the same store twice
        const ad = await SplashAd.create({
          restaurantId: store.id, style, offerText, headline, subline, bannerText: `${store.name} - sample`.slice(0, 40),
          imageUrl: store.imageUrl, colorA, colorB, isActive: false, priority: 0, createdBy: null, // made by this script, not an admin
        }, { transaction: t });
        result.created.push({ id: ad.id, style, store: store.name });
      }
      await GlobalConfig.create({
        key: marker,
        value: { doneAt: new Date().toISOString(), ...result },
        description: 'Sample splash ads, all switched off (scripts/sample_splash_ads_seed.js); delete to re-run.',
      }, { transaction: t });
    });
  } catch (err) {
    if (err && err.name === 'SequelizeUniqueConstraintError' && await GlobalConfig.findOne({ where: { key: marker } })) return { skipped: 'already done' };
    throw err;
  }
  return result;
};

module.exports = { runSampleSplashAdsSeed, DEFAULT_MARKER, COPY };
