// Splash ads: GET /api/ads/splash (public, cached) and /api/admin/splash-ads/* (admins). Mounted in server.js
// (admin router before /api/admin). Validation + public shape: utils/splashAds.
const crypto = require('crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const { protect, admin } = require('../middleware/authMiddleware');
const { getSplashAdModel } = require('../models/SplashAd');
const { getRestaurantModel } = require('../models/Restaurant');
const { getMenuItemModel } = require('../models/MenuItem');
const splashAds = require('../utils/splashAds');
const responseCache = require('../utils/responseCache');
const realtime = require('../utils/realtime');
const { sendServerError } = require('../utils/httpErrors');
const { STORE_SECRET_FIELDS, ITEM_SECRET_FIELDS } = require('../utils/publicFields');
const { sortMenuItems } = require('../utils/menuSort');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CACHE_GROUP = 'ads';
const dropCache = () => { try { responseCache.invalidate(CACHE_GROUP); } catch (e) { console.warn('[SPLASH_ADS_CACHE]', e.message); } };
// Every store / product change (admin, partner apps, realtime publish, FSSAI listing switch) goes through
// adminController.clearRestaurantsCache: drop the served ads with it (store name, open state, products).
try { require('../controllers/adminController').onRestaurantsCacheClear(dropCache); } catch { /* circular load: the 30 s TTL covers it */ }

// ── Public ──────────────────────────────────────────────────────────────────────────────────────
// Every eligible ad (up to 8, one per style), priority DESC then updatedAt DESC: active, inside its window
// (null start / end = open-ended) and for a store the public store list shows. The app picks at random.
const liveAds = async ({ college = null } = {}) => {
  const SplashAd = getSplashAdModel();
  const Restaurant = getRestaurantModel();
  const MenuItem = getMenuItemModel();
  if (!SplashAd || !Restaurant || !MenuItem) return [];
  const now = new Date();
  const rows = await SplashAd.findAll({
    where: {
      isActive: true,
      [Op.and]: [
        { [Op.or]: [{ startsAt: null }, { startsAt: { [Op.lte]: now } }] },
        { [Op.or]: [{ endsAt: null }, { endsAt: { [Op.gt]: now } }] },
      ],
    },
    order: [['priority', 'DESC'], ['updatedAt', 'DESC']],
    limit: 50,
  });
  if (!rows.length) return [];
  return shapeAds(rows, { listedOnly: true, college });
};

// Public shape for ad rows: their stores (listedOnly = only stores the public list shows) and up to two
// products each. Shared by the live list and the admin preview link.
const shapeAds = async (rows, { listedOnly, college = null }) => {
  const Restaurant = getRestaurantModel();
  const MenuItem = getMenuItemModel();
  const now = new Date();
  const { dataUrlSafeColumns } = require('../utils/imageStore');
  const stores = await Restaurant.findAll({
    where: { id: { [Op.in]: [...new Set(rows.map((r) => r.restaurantId))] }, ...(listedOnly ? { isActive: true, ...(await require('../utils/receiptSettings').listingWhere()) } : {}) },
    attributes: { exclude: ['imageUrl', 'logoUrl', ...STORE_SECRET_FIELDS], include: dataUrlSafeColumns('Restaurant', ['imageUrl']) },
  });
  // ?college=srmap: an ad only for a store that serves the student's college (utils/campuses).
  const campuses = require('../utils/campuses');
  const collegeKey = campuses.normalizeKey(college);
  const storeById = new Map(stores.filter((s) => campuses.storeServes(s, collegeKey)).map((s) => [s.id, s]));
  const seen = new Set();
  const ads = rows.filter((r) => {
    if (!storeById.has(r.restaurantId) || seen.has(r.style)) return false; // one per style even if the index is missing
    seen.add(r.style);
    return true;
  }).slice(0, splashAds.MAX_LIVE);
  if (!ads.length) return [];
  const items = await MenuItem.findAll({
    where: {
      restaurantId: { [Op.in]: [...new Set(ads.map((a) => a.restaurantId))] },
      [Op.or]: [{ isAvailable: true }, { outOfStockUntil: { [Op.lte]: now } }],
    },
    attributes: { exclude: ['imageUrl', 'description', ...ITEM_SECRET_FIELDS], include: dataUrlSafeColumns('MenuItem', ['imageUrl']) },
  });
  const itemsByStore = new Map();
  for (const it of sortMenuItems(items)) {
    if (!splashAds.showableItem(it, now.getTime())) continue;
    if (!itemsByStore.has(it.restaurantId)) itemsByStore.set(it.restaurantId, []);
    itemsByStore.get(it.restaurantId).push(it);
  }
  return ads.map((a) => splashAds.publicAd(a, storeById.get(a.restaurantId), itemsByStore.get(a.restaurantId)));
};

const router = express.Router();
router.get('/splash', responseCache.cacheGet(CACHE_GROUP, { ttlMs: 30 * 1000 }), async (req, res) => {
  try {
    res.json({ ads: await liveAds({ college: req.query.college }) });
  } catch (err) {
    sendServerError(res, err, '[SPLASH_ADS_ERROR]');
  }
});

// ── Preview links ───────────────────────────────────────────────────────────────────────────────
// An admin opens any ad (even switched off or scheduled) on a phone before it goes live: the admin page
// makes a signed link (15 min) and the app plays exactly that ad once. The link names one ad and nothing
// else; it is not a login and grants no other access.
const PREVIEW_TTL_SEC = 15 * 60;
const previewKey = () => {
  const sec = process.env.JWT_SECRET;
  if (!sec) throw new Error('JWT_SECRET is not configured');
  return crypto.createHash('sha256').update(`${sec}:splash-ad-preview:v1`).digest();
};
const signPreview = (adId) => jwt.sign({ aid: String(adId), p: 'adpreview' }, previewKey(), { expiresIn: PREVIEW_TTL_SEC, algorithm: 'HS256' });
// Tappable https page for the preview link (WhatsApp / a QR scan): one button that opens the ZCS app.
const escAttr = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
router.get('/open-preview', (req, res) => {
  const code = String(req.query.code || '').slice(0, 2000);
  res.set('Cache-Control', 'private, no-store');
  res.set('Referrer-Policy', 'no-referrer');
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ZENV ad preview</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0a0b;color:#f5f5f7;font:16px system-ui,sans-serif;text-align:center;padding:24px;box-sizing:border-box}
a{display:inline-block;margin-top:18px;background:#f4c430;color:#2a1c00;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:99px}p{color:#a1a1aa;font-size:14px;max-width:320px;margin:10px auto 0}</style></head>
<body><div><h1 style="font-size:22px;margin:0">Sponsored ad preview</h1><p>Opens this ad in the ZENV app on this phone, exactly as students will see it. The link works for 15 minutes.</p>
<a href="zenvy://ad-preview?code=${escAttr(encodeURIComponent(code))}">Open in ZENV</a></div></body></html>`);
});

router.get('/preview', async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  let aid = null;
  try {
    const d = jwt.verify(String(req.query.code || ''), previewKey(), { algorithms: ['HS256'] });
    if (d && d.p === 'adpreview' && UUID_RE.test(String(d.aid || ''))) aid = d.aid;
  } catch (e) {
    return res.status(410).json({ message: e && e.name === 'TokenExpiredError' ? 'This preview link has expired. Make a new one in admin.' : 'This preview link is not valid.' });
  }
  if (!aid) return res.status(410).json({ message: 'This preview link is not valid.' });
  try {
    const row = await getSplashAdModel().findByPk(aid);
    if (!row) return res.status(404).json({ message: 'This ad was deleted.' });
    const [ad] = await shapeAds([row], { listedOnly: false });
    if (!ad) return res.status(404).json({ message: "This ad's store no longer exists." });
    res.json({ ad });
  } catch (err) {
    sendServerError(res, err, '[SPLASH_AD_PREVIEW_ERROR]');
  }
});

// ── Admin ───────────────────────────────────────────────────────────────────────────────────────
const noStore = (req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); };
const adminRouter = express.Router();
adminRouter.use(protect, admin, noStore);
adminRouter.param('id', (req, res, next, id) => (UUID_RE.test(String(id || '')) ? next() : res.status(404).json({ message: 'Ad not found.' })));

const audit = async (req, adId, action, details) => {
  try {
    const { getVerificationLogModel } = require('../models/VerificationLog');
    const Log = getVerificationLogModel();
    if (!Log) return;
    await Log.create({ adminId: String((req.user && req.user.id) || 'unknown'), targetId: String(adId), action, details: JSON.stringify(details || {}).slice(0, 8000) });
  } catch (e) { console.error('[AUDIT_LOG_ERROR]', e.message); }
};
const afterWrite = (req, id, action, details) => {
  dropCache();
  realtime.notifyAdmin('splash_ad', action, id);
  return audit(req, id, `SPLASH_AD_${action.toUpperCase()}`, details);
};

const storesFor = async (rows) => {
  const ids = [...new Set(rows.map((r) => r.restaurantId))];
  const list = ids.length ? await getRestaurantModel().findAll({ where: { id: ids }, attributes: ['id', 'name', 'isActive'] }) : [];
  return new Map(list.map((s) => [s.id, s]));
};
const adminAd = (row, stores) => {
  const a = row.toJSON();
  const s = stores.get(a.restaurantId);
  return {
    ...a,
    state: splashAds.adState(a),
    styleLabel: (splashAds.STYLES[a.style] || {}).label || a.style,
    store: s ? { id: s.id, name: s.name, isActive: s.isActive !== false } : null,
  };
};

// 409 naming the store whose ACTIVE ad already uses `style` (null when the style is free).
const styleConflict = async (style, exceptId) => {
  const other = await getSplashAdModel().findOne({ where: { isActive: true, style, ...(exceptId ? { id: { [Op.ne]: exceptId } } : {}) }, attributes: ['id', 'restaurantId'] });
  if (!other) return null;
  const store = await getRestaurantModel().findByPk(other.restaurantId, { attributes: ['name'] });
  return {
    code: 'STYLE_IN_USE', field: 'style', conflictId: other.id,
    message: `Style '${style}' is already used by the active ad for ${store ? store.name : 'another store'}; pick another style or turn that one off.`,
  };
};
const isUniqueError = (err) => !!err && err.name === 'SequelizeUniqueConstraintError';

/** Validates an admin write. Returns the column values, or sends the error and returns null. */
const prepare = async (req, res, current, body) => {
  let values;
  try { values = splashAds.validateSplashAd(body, { current }); } catch (err) {
    if (err instanceof splashAds.SplashAdInputError) { res.status(400).json({ code: err.code, field: err.field, message: err.message }); return null; }
    throw err;
  }
  const store = await getRestaurantModel().findByPk(values.restaurantId, { attributes: ['id', 'name', 'isActive', 'fssaiLicenseNumber'] });
  if (!store) { res.status(400).json({ code: 'INVALID_SPLASH_AD', field: 'restaurantId', message: 'That store does not exist.' }); return null; }
  // Switching an ad on (new, re-activated or moved to another store) needs a store customers can see.
  // Pausing or editing an ad whose store was hidden later stays possible (the public read skips it).
  const cur = current ? current.get({ plain: true }) : null;
  const needsListedStore = values.isActive && (!cur || !cur.isActive || cur.restaurantId !== values.restaurantId);
  if (needsListedStore) {
    const hidden = store.isActive === false
      || (!store.fssaiLicenseNumber && (await require('../utils/receiptSettings').hideStoresWithoutFssai()));
    if (hidden) { res.status(400).json({ code: 'INVALID_SPLASH_AD', field: 'restaurantId', message: `${store.name} is hidden from customers. List it before running an ad for it.` }); return null; }
  }
  if (values.isActive) {
    const conflict = await styleConflict(values.style, cur && cur.id);
    if (conflict) { res.status(409).json(conflict); return null; }
  }
  if (!cur || values.imageUrl !== cur.imageUrl) {
    const imageStore = require('../utils/imageStore');
    const id = imageStore.mediaIdOf(String(values.imageUrl).split('?')[0]);
    if (id) {
      const m = (await require('../utils/mediaAccess').loadMediaMeta([id])).get(id);
      if (m && m.isPrivate) { res.status(400).json({ code: 'INVALID_SPLASH_AD', field: 'imageUrl', message: 'That image is private and cannot be used on an ad.' }); return null; }
    }
    const stored = await imageStore.storeImageRef(values.imageUrl, { req, ownerId: req.user.id, purpose: 'store' });
    if (!stored || !stored.ok || !stored.value) { res.status((stored && stored.status) || 400).json({ code: 'INVALID_SPLASH_AD', field: 'imageUrl', message: (stored && stored.message) || 'That image could not be used.' }); return null; }
    values.imageUrl = stored.value;
  }
  return values;
};

// Saves `values` (create when `row` is null). A unique-index race (two admins activating the same style at
// once) becomes the same 409 as the check in prepare().
const save = async (req, res, row, values) => {
  try {
    return row ? await row.update(values) : await getSplashAdModel().create({ ...values, createdBy: req.user.id });
  } catch (err) {
    if (!isUniqueError(err)) throw err;
    const conflict = (await styleConflict(values.style, row && row.id)) || { code: 'STYLE_IN_USE', field: 'style', message: `Style '${values.style}' is already used by another active ad; pick another style or turn that one off.` };
    res.status(409).json(conflict);
    return null;
  }
};

adminRouter.get('/', async (req, res) => {
  try {
    const rows = await getSplashAdModel().findAll({ order: [['priority', 'DESC'], ['updatedAt', 'DESC']], limit: 200 });
    const stores = await storesFor(rows);
    res.json({ ads: rows.map((r) => adminAd(r, stores)) });
  } catch (err) {
    sendServerError(res, err, '[SPLASH_ADS_ADMIN_ERROR]');
  }
});

adminRouter.post('/', async (req, res) => {
  try {
    const values = await prepare(req, res, null, req.body);
    if (!values) return;
    const ad = await save(req, res, null, values);
    if (!ad) return;
    await afterWrite(req, ad.id, 'created', { style: ad.style, restaurantId: ad.restaurantId, isActive: ad.isActive });
    res.status(201).json(adminAd(ad, await storesFor([ad])));
  } catch (err) {
    sendServerError(res, err, '[SPLASH_AD_CREATE_ERROR]');
  }
});

const updateWith = (bodyOf, errTag) => async (req, res) => {
  try {
    const ad = await getSplashAdModel().findByPk(req.params.id);
    if (!ad) return res.status(404).json({ message: 'Ad not found.' });
    const body = bodyOf(req, ad);
    const values = await prepare(req, res, ad, body);
    if (!values) return;
    const saved = await save(req, res, ad, values);
    if (!saved) return;
    await afterWrite(req, ad.id, 'updated', { style: ad.style, isActive: ad.isActive, fields: Object.keys(body || {}) });
    res.json(adminAd(ad, await storesFor([ad])));
  } catch (err) {
    sendServerError(res, err, errTag);
  }
};

adminRouter.put('/:id', updateWith((req) => req.body, '[SPLASH_AD_UPDATE_ERROR]'));

// Preview on a phone: a signed 15 min link to this one ad (zenvy://ad-preview?code=...).
adminRouter.post('/:id/preview', async (req, res) => {
  try {
    const row = await getSplashAdModel().findByPk(req.params.id);
    if (!row) return res.status(404).json({ message: 'Ad not found.' });
    const code = signPreview(row.id);
    audit(req, row.id, 'SPLASH_AD_PREVIEW', {});
    const base = `${req.protocol}://${req.get('host')}`;
    res.json({ code, link: `zenvy://ad-preview?code=${encodeURIComponent(code)}`, webLink: `${base}/api/ads/open-preview?code=${encodeURIComponent(code)}`, expiresInSec: PREVIEW_TTL_SEC });
  } catch (err) {
    sendServerError(res, err, '[SPLASH_AD_PREVIEW_LINK_ERROR]');
  }
});
// PUT /api/admin/splash-ads/:id/active  { isActive: true|false }  (no body = flip)
adminRouter.put('/:id/active', updateWith((req, ad) => {
  const v = req.body && req.body.isActive;
  return { isActive: typeof v === 'boolean' ? v : !ad.isActive };
}, '[SPLASH_AD_TOGGLE_ERROR]'));

adminRouter.delete('/:id', async (req, res) => {
  try {
    const ad = await getSplashAdModel().findByPk(req.params.id);
    if (!ad) return res.status(404).json({ message: 'Ad not found.' });
    await ad.destroy();
    await afterWrite(req, ad.id, 'deleted', { style: ad.style, restaurantId: ad.restaurantId });
    res.json({ message: 'Ad deleted.' });
  } catch (err) {
    sendServerError(res, err, '[SPLASH_AD_DELETE_ERROR]');
  }
});

module.exports = { router, adminRouter, liveAds };
