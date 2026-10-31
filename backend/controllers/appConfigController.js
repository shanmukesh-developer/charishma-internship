const AppConfig = require('../models/AppConfig');
const { sendServerError } = require('../utils/httpErrors');

// B25: one config row. Reads always take the oldest row (a stray duplicate can never be served),
// and the first-ever seed uses a fixed id with findOrCreate, so two first requests at once cannot
// create two rows.
const CONFIG_SEED_ID = '00000000-0000-4000-8000-00000000c0f1';
const findConfig = (opts = {}) => AppConfig.findOne({ order: [['createdAt', 'ASC'], ['id', 'ASC']], ...opts });
// Public shape: who last edited the config is admin-only information.
const publicConfig = (config) => {
  const j = config && typeof config.toJSON === 'function' ? config.toJSON() : { ...(config || {}) };
  delete j.lastUpdatedBy;
  return j;
};

exports.getConfig = async (req, res) => {
  try {
    let config = await findConfig();

    if (!config) {
      // Seed default config if none exists
      [config] = await AppConfig.findOrCreate({ where: { id: CONFIG_SEED_ID }, defaults: {
        maintenanceMode: false,
        campusOpen: true,
        banners: [
          {
            imageUrl: 'https://images.unsplash.com/photo-1542838132-92c53300491e?q=80&w=1974&auto=format&fit=crop',
            tagline: 'GROCERIES',
            title1: 'YOUR ESSENTIALS',
            title2: 'DELIVERED TODAY',
            description: 'DAILY NEEDS FROM CAMPUS STORES, DELIVERED TO YOUR HOSTEL GATE.',
            buttonText: 'SHOP NOW',
            redirectUrl: '/others',
            isActive: true
          }
        ],
        categories: [
          { name: 'Fruits', img: null, order: 1, isActive: true },
          { name: 'Rental', img: null, order: 2, isActive: true },
          { name: 'Sweets', img: null, order: 3, isActive: true }
        ]
      } });
    }

    let isAdmin = false;
    try { isAdmin = await require('../middleware/authMiddleware').isLiveAdminRequest(req); } catch { isAdmin = false; }
    // Own-domain move (utils/publicUrl): apiBaseUrl / socketUrl appear only while PUBLIC_API_URL is set,
    // so the response is unchanged until then. The apps read GET /api/config/endpoints (same values).
    const ep = require('../utils/publicUrl').advertisedEndpoints();
    res.status(200).json({
      success: true,
      config: isAdmin ? config : publicConfig(config),
      ...(ep.apiBaseUrl ? { apiBaseUrl: ep.apiBaseUrl, socketUrl: ep.socketUrl } : {}),
    });
  } catch (error) {
    console.error('Error fetching config:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch config' });
  }
};

exports.updateConfig = async (req, res) => {
  try {
    // Only real config fields (never id / timestamps / lastUpdatedBy from the client).
    const EDITABLE = ['banners', 'categories', 'maintenanceMode', 'campusOpen', 'activeTheme', 'globalAnnouncement'];
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const updates = {};
    for (const key of EDITABLE) if (body[key] !== undefined) updates[key] = body[key];
    // Optional optimistic-concurrency check: the version (updatedAt) the editor started from.
    const ifMatchHeader = String(req.get('If-Match') || '').replace(/^W\//, '').replace(/"/g, '').trim();
    const expected = typeof body.ifUpdatedAt === 'string' && body.ifUpdatedAt ? body.ifUpdatedAt : (ifMatchHeader || null);

    const { config, result } = await withLockedConfig(async (cfg) => {
      if (expected && cfg.updatedAt && !sameVersion(cfg.updatedAt, expected)) {
        return { conflict: true, save: false };
      }
      Object.keys(updates).forEach(key => {
        cfg[key] = updates[key];
      });
      cfg.lastUpdatedBy = req.user ? req.user.id : null;
      return { conflict: false };
    });
    if (result.conflict) {
      return res.status(409).json({
        success: false,
        code: 'CONFIG_CONFLICT',
        message: 'Someone else changed the app config since you loaded it. Reload to see their version, then make your change again.',
        config
      });
    }

    // Broadcast via socket if available
    if (req.app.get('io')) {
      req.app.get('io').emit('config_updated', publicConfig(config));
    }
    require('../utils/realtime').publish('config', 'updated', config.id, { scope: 'app' });
    if (updates.globalAnnouncement !== undefined) {
      require('../utils/realtime').publish('announcement', 'updated', config.id, { scope: 'app_config' });
    }

    res.status(200).json({
      success: true,
      config
    });
  } catch (error) {
    console.error('Error updating config:', error);
    sendServerError(res, error, '[APPCONFIGCONTROLLER_ERROR]');
  }
};

// ─── Optimistic concurrency + single-banner edits ────────────────────────────
// The dashboard used to read the whole banner list, edit it in the browser and PUT the whole list
// back, so two admins (or a store's "Home banner" toggle and the CMS page) could silently undo each
// other. Single-banner add/remove now run server-side in one transaction on the locked config row,
// and PUT /api/config accepts an optional version check (If-Match header or body.ifUpdatedAt).

const sameVersion = (a, b) => {
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  return Number.isFinite(ta) && Number.isFinite(tb) && ta === tb;
};

const BANNER_TEXT_LIMITS = { imageUrl: 2000, tagline: 80, title1: 120, title2: 120, description: 400, buttonText: 40, redirectUrl: 300 };
const cleanBanner = (raw) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  for (const [k, max] of Object.entries(BANNER_TEXT_LIMITS)) {
    if (raw[k] === undefined || raw[k] === null) continue;
    if (typeof raw[k] !== 'string') return null;
    out[k] = raw[k].slice(0, max);
  }
  if (raw.isActive !== undefined) out.isActive = raw.isActive === true;
  if (!out.redirectUrl || !out.redirectUrl.startsWith('/')) return null;
  return out;
};

const publishConfigChange = (req, config) => {
  if (req.app.get('io')) req.app.get('io').emit('config_updated', publicConfig(config));
  require('../utils/realtime').publish('config', 'updated', config.id, { scope: 'app' });
};

// In-process queue: config writes from this process run one after another (SQLite dev has no row
// locks, and a second write transaction there fails with SQLITE_BUSY instead of waiting).
let configWriteQueue = Promise.resolve();
const serialize = (fn) => {
  const run = configWriteQueue.then(fn, fn);
  configWriteQueue = run.catch(() => {});
  return run;
};

/**
 * Runs `mutate(config)` as one read-modify-write of the AppConfig row. Postgres (production, possibly
 * several cluster workers): a transaction holding SELECT ... FOR UPDATE on the row, so concurrent
 * writers wait for each other. Other dialects (local SQLite): the in-process queue above.
 */
const withLockedConfig = (mutate) => serialize(async () => {
  const sequelize = AppConfig.sequelize;
  if (sequelize.getDialect() !== 'postgres') {
    let config = await findConfig();
    if (!config) [config] = await AppConfig.findOrCreate({ where: { id: CONFIG_SEED_ID }, defaults: {} });
    const result = await mutate(config);
    if (result && result.save !== false) await config.save();
    return { config, result };
  }
  return sequelize.transaction(async (transaction) => {
    let config = await findConfig({ transaction, lock: transaction.LOCK.UPDATE });
    if (!config) [config] = await AppConfig.findOrCreate({ where: { id: CONFIG_SEED_ID }, defaults: {}, transaction });
    const result = await mutate(config);
    if (result && result.save !== false) await config.save({ transaction });
    return { config, result };
  });
});

// @route POST /api/config/banners   body: { banner }  (admin)
// Adds the banner at the top, or updates the existing banner with the same redirectUrl in place.
exports.upsertBanner = async (req, res) => {
  try {
    const banner = cleanBanner(req.body && req.body.banner);
    if (!banner) return res.status(400).json({ success: false, message: 'A banner needs text fields and a redirectUrl starting with "/".' });
    const { config, result } = await withLockedConfig(async (cfg) => {
      const list = Array.isArray(cfg.banners) ? cfg.banners : [];
      const index = list.findIndex((b) => b && b.redirectUrl === banner.redirectUrl);
      cfg.banners = index >= 0 ? list.map((b, i) => (i === index ? { ...b, ...banner } : b)) : [banner, ...list];
      cfg.lastUpdatedBy = req.user ? req.user.id : null;
      return { created: index < 0 };
    });
    publishConfigChange(req, config);
    res.status(result.created ? 201 : 200).json({ success: true, created: result.created, config });
  } catch (error) {
    sendServerError(res, error, '[APPCONFIG_BANNER_UPSERT_ERROR]');
  }
};

// @route DELETE /api/config/banners?redirectUrl=/store/<id>   (admin)
// Removes every banner that opens that path. 200 with removed: 0 when there was none.
exports.removeBanner = async (req, res) => {
  try {
    const redirectUrl = String((req.query && req.query.redirectUrl) || (req.body && req.body.redirectUrl) || '').slice(0, 300);
    if (!redirectUrl.startsWith('/')) return res.status(400).json({ success: false, message: 'redirectUrl must start with "/".' });
    const { config, result } = await withLockedConfig(async (cfg) => {
      const list = Array.isArray(cfg.banners) ? cfg.banners : [];
      const next = list.filter((b) => !(b && b.redirectUrl === redirectUrl));
      if (next.length === list.length) return { removed: 0, save: false };
      cfg.banners = next;
      cfg.lastUpdatedBy = req.user ? req.user.id : null;
      return { removed: list.length - next.length };
    });
    if (result.removed) publishConfigChange(req, config);
    res.json({ success: true, removed: result.removed, config });
  } catch (error) {
    sendServerError(res, error, '[APPCONFIG_BANNER_REMOVE_ERROR]');
  }
};

exports.sameVersion = sameVersion;
