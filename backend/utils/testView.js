/**
 * Owner-only test data (owner, 3 Nov 2026: "add valid mock data in every section, I will test it on the live server",
 * then "only my accounts"). Rows with isTestData = true (scripts/test_data_v2_seed.js) are seen only by the owner's
 * tester accounts: the phone numbers in GlobalConfig TEST_VIEWER_PHONES (Admin > Config) and / or the
 * TEST_VIEWER_PHONES env var. Every other customer or rider request, and every signed-out one, never sees them:
 *
 *   - middleware() marks each request: filter on for a signed-out caller, a customer or a rider whose phone is not on
 *     the list; filter off for a tester, an admin, and a store / PG partner / auto driver session (those apps only
 *     read their own rows, and a test store's own app must see its own test orders);
 *   - hideTestRows(Model) adds `isTestData IS NOT true` to every find and count of that model in a filtered request;
 *   - sharesCache() tells the shared response caches (utils/responseCache, the store list caches) to leave an
 *     unfiltered request alone, so a tester's answer is never stored for, or served to, anyone else.
 *
 * Work outside a request (boot scripts, jobs, sockets) is not filtered: code there that offers work to people checks
 * isTestRider() / isTestPhone() itself (utils/riderDispatch).
 */
const { AsyncLocalStorage } = require('async_hooks');
const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const { normalizePhone } = require('./phoneUtils');

const KEY = 'TEST_VIEWER_PHONES';
const REFRESH_MS = 5 * 60 * 1000;
const NOT_TEST = Object.freeze({ isTestData: { [Op.not]: true } });

const als = new AsyncLocalStorage();
let testers = { phones: new Set(), userIds: new Set(), riderIds: new Set(), at: 0 };
let loading = null;

/** "98765 43210, +91 91234 56789" or ["9876543210"] -> ['9876543210', '9123456789'] (10 digits, no repeats). */
const parsePhones = (value) => {
  const parts = Array.isArray(value) ? value : String(value == null ? '' : value).split(/[,;\n]+/);
  const out = [];
  for (const part of parts) {
    if (typeof part !== 'string' && typeof part !== 'number') continue;
    const phone = normalizePhone(String(part).replace(/[^\d+]/g, ''));
    if (/^\d{10}$/.test(phone) && !out.includes(phone)) out.push(phone);
  }
  return out;
};

/** Reads the tester phones and resolves them to customer and rider account ids (at most every REFRESH_MS). */
const loadTesters = async ({ fresh = false } = {}) => {
  if (!fresh && testers.at && Date.now() - testers.at < REFRESH_MS) return testers;
  if (loading) return loading;
  loading = (async () => {
    try {
      const GlobalConfig = require('../models/GlobalConfig').getGlobalConfigModel();
      const row = GlobalConfig ? await GlobalConfig.findOne({ where: { key: KEY } }) : null;
      const phones = [...new Set([...parsePhones(process.env.TEST_VIEWER_PHONES), ...parsePhones(row && row.value)])];
      let userIds = new Set();
      let riderIds = new Set();
      if (phones.length) {
        const User = require('../models/User').getUserModel();
        const DeliveryPartner = require('../models/DeliveryPartner').getDeliveryPartnerModel();
        // Phones are stored as 10 digits (utils/phoneUtils); a few older rows carry +91 / 91.
        const variants = phones.flatMap((p) => [p, `+91${p}`, `91${p}`]);
        const [users, riders] = await Promise.all([
          User ? User.findAll({ where: { phone: { [Op.in]: variants } }, attributes: ['id'] }) : [],
          DeliveryPartner ? DeliveryPartner.findAll({ where: { phone: { [Op.in]: variants } }, attributes: ['id'] }) : [],
        ]);
        userIds = new Set(users.map((u) => String(u.id)));
        riderIds = new Set(riders.map((r) => String(r.id)));
      }
      testers = { phones: new Set(phones), userIds, riderIds, at: Date.now() };
    } catch (err) {
      // Keep the last good list (an empty one hides test data from everyone); try again after REFRESH_MS.
      console.warn('[TEST_VIEW] Could not load the tester list:', err.message);
      testers = { ...testers, at: Date.now() };
    } finally {
      loading = null;
    }
    return testers;
  })();
  return loading;
};

// After Admin > Config saves the list: every instance reloads it at once (utils/cacheBus).
const reloadTesters = require('./cacheBus').wrap('testView.reload', () => {
  testers = { ...testers, at: 0 };
  loadTesters({ fresh: true }).catch(() => {});
});

// Sessions of apps that only read their own rows (store app, PG Partner, Auto-Ride driver) and admins.
const UNFILTERED_ROLES = new Set(['restaurant', 'pg_owner', 'auto_driver', 'admin']);

const tokenOf = (req) => {
  const auth = req.headers && req.headers.authorization;
  if (auth && auth.startsWith('Bearer') && !auth.includes('cookie-managed')) return auth.split(' ')[1];
  return req.cookies && req.cookies.token;
};

/** { filter, tester } for a request; a missing or bad token is a signed-out customer. */
const viewOf = (req) => {
  const raw = tokenOf(req);
  const secret = process.env.JWT_SECRET;
  if (!raw || !secret) return { filter: true, tester: false };
  let claims;
  try {
    claims = jwt.verify(String(raw).replace(/['"]+/g, '').trim(), secret);
  } catch {
    return { filter: true, tester: false };
  }
  if (!claims || !claims.id) return { filter: true, tester: false };
  const role = String(claims.role || '').toLowerCase();
  if (role === 'rider') {
    const tester = testers.riderIds.has(String(claims.id));
    return { filter: !tester, tester };
  }
  if (UNFILTERED_ROLES.has(role)) return { filter: false, tester: false };
  const tester = testers.userIds.has(String(claims.id));
  return { filter: !tester, tester };
};

const middleware = () => (req, res, next) => {
  if (!testers.at || Date.now() - testers.at >= REFRESH_MS) loadTesters().catch(() => {});
  const view = viewOf(req);
  // An answer that may hold test rows is never kept by a shared (CDN / proxy) cache.
  if (!view.filter) res.set('Cache-Control', 'private, no-store');
  als.run(view, next);
};

/** True inside a request that must not see test rows. */
const isFiltering = () => {
  const view = als.getStore();
  return !!(view && view.filter);
};
/** True inside a tester's request (customer or rider on the list). */
const isTester = () => {
  const view = als.getStore();
  return !!(view && view.tester);
};
/** False inside a request that may see test rows: shared caches must neither serve nor store its answer. */
const sharesCache = () => {
  const view = als.getStore();
  return !view || view.filter !== false;
};

const addFilter = (options) => {
  if (!options || !isFiltering()) return;
  options.where = options.where ? { [Op.and]: [options.where, NOT_TEST] } : { ...NOT_TEST };
};

/** Hides the model's test rows from filtered requests (finds, findByPk / findOne / findAndCountAll, counts). */
const hideTestRows = (...models) => {
  for (const Model of models) {
    if (!Model || !Model.rawAttributes || !Model.rawAttributes.isTestData || Model.zcsHidesTestRows) continue;
    Model.addHook('beforeFind', 'zcsTestView', addFilter);
    Model.addHook('beforeCount', 'zcsTestView', addFilter);
    Model.zcsHidesTestRows = true;
  }
};

const isTestRider = (riderId) => testers.riderIds.has(String(riderId));
const testerRiderIds = () => [...testers.riderIds];
/** Whether a store (a row, or { id } without the flag loaded) is an owner-only test store; never filtered. */
const isTestStore = async (store) => {
  if (!store) return false;
  if (typeof store.isTestData === 'boolean') return store.isTestData;
  if (!store.id) return false;
  const Restaurant = require('../models/Restaurant').getRestaurantModel();
  const row = Restaurant ? await Restaurant.findByPk(store.id, { attributes: ['id', 'isTestData'], hooks: false }) : null;
  return !!(row && row.isTestData);
};
const isTestPhone = (phone) => testers.phones.has(normalizePhone(String(phone || '')));
const testerUserIds = () => [...testers.userIds];

/** Runs fn as a filtered (fn) or unfiltered request would (tests and scripts). */
const runAs = (view, fn) => als.run({ filter: !!view.filter, tester: !!view.tester }, fn);

module.exports = {
  KEY, NOT_TEST, parsePhones, loadTesters, reloadTesters, middleware, viewOf, isFiltering, isTester, sharesCache,
  hideTestRows, isTestRider, testerRiderIds, isTestStore, isTestPhone, testerUserIds, runAs,
};
