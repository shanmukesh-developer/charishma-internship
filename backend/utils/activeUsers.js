/**
 * Active testers report (Admin > Active testers; routes/activeUsersRoutes.js). Reads what utils/appPresence records
 * on the User row (lastSeenAt / firstSeenAt / lastAppVersion / lastAppBuild / lastPlatform) for customer accounts.
 *
 *   report({ filter, search, page, sort })   summary counts, version breakdown, one page of accounts
 *   testerStatus()                           the owner's closed-tester phone list, each with its account's status
 *   parseTesterPhones(text | array)          -> { phones, invalid } (Indian 10-digit mobiles; +91 / 91 / 0 prefixes ok)
 *
 * Accounts counted: every User row except admins and deleted accounts. Orders counted exclude owner test orders
 * (isTestData, utils/testView); accounts on the owner's TEST_VIEWER_PHONES list are marked ownerTestAccount (they are
 * real sign-ins, often the owner's own phone, so they stay in the list).
 * "Today" is the IST calendar day; "this week" the last 7 × 24 h; "not seen 2+ days" = seen before, not in 48 h.
 */
const { Op, fn, col } = require('sequelize');

const TESTERS_KEY = 'CLOSED_TESTER_PHONES';
// Config keys written only through routes/activeUsersRoutes (the generic Config endpoint refuses them).
const OWN_KEYS = Object.freeze([TESTERS_KEY, 'TESTER_DAILY_TARGET', 'USAGE_TRACKING_ENABLED']);
const MAX_TESTERS = 500;
const PAGE_SIZE = 50;
const DAY = 24 * 60 * 60 * 1000;
const IST_OFFSET = 330 * 60 * 1000;
const FILTERS = ['all', 'today', 'week', 'inactive2d', 'never'];
const SORTS = {
  lastSeen_desc: [['lastSeenAt', 'DESC NULLS LAST'], ['createdAt', 'DESC']],
  lastSeen_asc: [['lastSeenAt', 'ASC NULLS FIRST'], ['createdAt', 'DESC']],
  signedUp_desc: [['createdAt', 'DESC']],
  signedUp_asc: [['createdAt', 'ASC']],
};

const User = () => require('../models/User').getUserModel();

/** Start of today in IST, as a Date. */
const istDayStart = (now = new Date()) => {
  const ist = new Date(now.getTime() + IST_OFFSET);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - IST_OFFSET);
};

// Customer accounts: not admins, not deleted (role null = an old row, treated as a customer).
const CUSTOMER = Object.freeze({ [Op.or]: [{ role: null }, { role: { [Op.notIn]: ['admin', 'deleted'] } }] });

const filterWhere = (filter, now) => {
  switch (filter) {
    case 'today': return { lastSeenAt: { [Op.gte]: istDayStart(now) } };
    case 'week': return { lastSeenAt: { [Op.gte]: new Date(now.getTime() - 7 * DAY) } };
    case 'inactive2d': return { lastSeenAt: { [Op.lt]: new Date(now.getTime() - 2 * DAY) } };
    case 'never': return { lastSeenAt: null };
    default: return null;
  }
};

const likeOp = () => {
  const s = User().sequelize;
  return s && s.getDialect() === 'postgres' ? Op.iLike : Op.like;
};
const searchWhere = (search) => {
  const q = String(search || '').trim().slice(0, 64).replace(/[%_\\]/g, '');
  if (!q) return null;
  const pattern = `%${q}%`;
  const op = likeOp();
  const or = [{ name: { [op]: pattern } }, { email: { [op]: pattern } }];
  const digits = q.replace(/\D/g, '');
  or.push({ phone: { [op]: digits.length >= 3 ? `%${digits.slice(-10)}%` : pattern } });
  return { [Op.or]: or };
};

const and = (...parts) => ({ [Op.and]: parts.filter(Boolean) });

/** "98765 43210\n+91 91234-56789, 09123456789" -> { phones: ['9876543210', '9123456789'], invalid: [] }. */
const parseTesterPhones = (input) => {
  const parts = Array.isArray(input) ? input : String(input == null ? '' : input).split(/[\n\r,;]+/);
  const phones = [];
  const invalid = [];
  for (const raw of parts) {
    if (typeof raw !== 'string' && typeof raw !== 'number') { invalid.push(String(raw)); continue; }
    const text = String(raw).trim();
    if (!text) continue;
    let d = text.replace(/[\s().-]/g, '');
    if (/^\+91\d{10}$/.test(d)) d = d.slice(3);
    else if (/^91\d{10}$/.test(d)) d = d.slice(2);
    else if (/^0\d{10}$/.test(d)) d = d.slice(1);
    if (!/^[6-9]\d{9}$/.test(d)) { invalid.push(text.slice(0, 40)); continue; }
    if (!phones.includes(d)) phones.push(d);
  }
  return { phones, invalid };
};

const phoneVariants = (phones) => phones.flatMap((p) => [p, `+91${p}`, `91${p}`]);
const last10 = (p) => String(p || '').replace(/\D/g, '').slice(-10);

/** Order counts per user id (owner test orders left out). */
const orderCounts = async (ids) => {
  const Order = require('../models/Order').getOrderModel();
  if (!Order || !ids.length) return new Map();
  const where = { userId: { [Op.in]: ids } };
  if (Order.rawAttributes.isTestData) where.isTestData = { [Op.not]: true };
  const rows = await Order.findAll({ attributes: ['userId', [fn('COUNT', col('id')), 'n']], where, group: ['userId'], raw: true });
  return new Map(rows.map((r) => [String(r.userId), Number(r.n) || 0]));
};

const ownerTestPhones = async () => {
  try {
    const tv = require('./testView');
    const t = await tv.loadTesters();
    return t && t.phones ? t.phones : new Set();
  } catch {
    return new Set();
  }
};

/** Latest customer version: the admin's Config > App versions "latest", else the highest version seen. */
const latestVersionOf = async (seenVersions) => {
  const avp = require('./appVersionPolicy');
  try {
    const policy = await avp.getPolicy();
    const v = policy && policy.apps && policy.apps.customer && policy.apps.customer.latestVersion;
    if (v && avp.parseVersion(v)) return { latestVersion: v, latestVersionSource: 'policy' };
  } catch { /* fall back to what was seen */ }
  const seen = seenVersions.filter((v) => avp.parseVersion(v)).sort((a, b) => avp.compareVersions(b, a));
  return seen.length ? { latestVersion: seen[0], latestVersionSource: 'seen' } : { latestVersion: null, latestVersionSource: null };
};

const USER_ATTRS = ['id', 'name', 'phone', 'email', 'role', 'isActive', 'createdAt', 'firstSeenAt', 'lastSeenAt', 'lastAppVersion', 'lastAppBuild', 'lastPlatform'];

const rowOf = (u, counts, testPhones, latest) => {
  const avp = require('./appVersionPolicy');
  const cmp = latest && u.lastAppVersion ? avp.compareVersions(u.lastAppVersion, latest) : null;
  return {
    id: String(u.id),
    name: u.name,
    phone: u.phone,
    email: u.email || null,
    role: u.role || 'student',
    isActive: u.isActive !== false,
    createdAt: u.createdAt,
    firstSeenAt: u.firstSeenAt || null,
    lastSeenAt: u.lastSeenAt || null,
    lastAppVersion: u.lastAppVersion || null,
    lastAppBuild: u.lastAppBuild || null,
    lastPlatform: u.lastPlatform || null,
    orders: counts.get(String(u.id)) || 0,
    ownerTestAccount: testPhones.has(last10(u.phone)),
    olderThanLatest: cmp !== null && cmp < 0,
  };
};

/** CLOSED-TEST ONLY: today's app minutes over customer accounts (admins / deleted left out). */
const usageTotals = async (now) => {
  const usage = require('./usageTime');
  const M = require('../models/UserDailyActivity').getUserDailyActivityModel();
  if (!M) return null;
  const today = require('./testerDailyTarget').istDay(now);
  const rows = await M.findAll({ where: { day: today, activeSeconds: { [Op.gt]: 0 } }, attributes: ['userId'], raw: true });
  const ids = rows.map((r) => String(r.userId));
  const ok = ids.length ? new Set((await User().findAll({ where: and(CUSTOMER, { id: { [Op.in]: ids } }), attributes: ['id'], raw: true })).map((u) => String(u.id))) : new Set();
  const sw = await usage.readSwitch().catch(() => ({ enabled: false }));
  return { ...(await usage.todayTotals((id) => ok.has(id), { now })), trackingEnabled: sw.enabled };
};

const report = async ({ filter = 'all', search = '', page = 1, sort = 'lastSeen_desc', now = new Date() } = {}) => {
  const U = User();
  const f = FILTERS.includes(filter) ? filter : 'all';
  const order = SORTS[sort] || SORTS.lastSeen_desc;
  const p = Math.min(Math.max(parseInt(page, 10) || 1, 1), 10000);

  const [signedUp, seenToday, seenWeek, inactive2d, neverSeen, versionRows, firstRow] = await Promise.all([
    U.count({ where: CUSTOMER }),
    U.count({ where: and(CUSTOMER, filterWhere('today', now)) }),
    U.count({ where: and(CUSTOMER, filterWhere('week', now)) }),
    U.count({ where: and(CUSTOMER, filterWhere('inactive2d', now)) }),
    U.count({ where: and(CUSTOMER, filterWhere('never', now)) }),
    U.findAll({ attributes: ['lastAppVersion', [fn('COUNT', col('id')), 'n']], where: and(CUSTOMER, { lastAppVersion: { [Op.ne]: null } }), group: ['lastAppVersion'], raw: true }),
    U.findOne({ attributes: [[fn('MIN', col('firstSeenAt')), 'first']], raw: true }),
  ]);

  const avp = require('./appVersionPolicy');
  const { latestVersion, latestVersionSource } = await latestVersionOf(versionRows.map((r) => r.lastAppVersion));
  const versions = versionRows
    .map((r) => {
      const cmp = latestVersion ? avp.compareVersions(r.lastAppVersion, latestVersion) : null;
      return { version: r.lastAppVersion, count: Number(r.n) || 0, isLatest: cmp === 0, olderThanLatest: cmp !== null && cmp < 0 };
    })
    .sort((a, b) => (avp.compareVersions(b.version, a.version) ?? String(b.version).localeCompare(String(a.version))));

  const where = and(CUSTOMER, filterWhere(f, now), searchWhere(search));
  const { count: total, rows } = await U.findAndCountAll({ where, attributes: USER_ATTRS, order, limit: PAGE_SIZE, offset: (p - 1) * PAGE_SIZE });
  const [counts, testPhones] = await Promise.all([orderCounts(rows.map((u) => String(u.id))), ownerTestPhones()]);
  // CLOSED-TEST ONLY (utils/usageTime): minutes today, sessions today, 7-day average per day opened; today's totals.
  const usage = require('./usageTime');
  const [usageMap, usageToday] = await Promise.all([
    usage.usageFor(rows.map((u) => String(u.id)), { now }).catch(() => new Map()),
    usageTotals(now).catch(() => null),
  ]);

  const first = firstRow && firstRow.first ? new Date(firstRow.first) : null;
  return {
    now: now.toISOString(),
    todayStartsAt: istDayStart(now).toISOString(),
    trackingStartedAt: first && !Number.isNaN(first.getTime()) ? first.toISOString() : null,
    latestVersion,
    latestVersionSource,
    summary: { signedUp, seenToday, seenWeek, inactive2d, neverSeen, seenEver: signedUp - neverSeen },
    versions,
    filter: f,
    sort: SORTS[sort] ? sort : 'lastSeen_desc',
    search: String(search || '').trim().slice(0, 64),
    page: p,
    pageSize: PAGE_SIZE,
    total,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    users: rows.map((u) => ({ ...rowOf(u.get({ plain: true }), counts, testPhones, latestVersion), usage: usageMap.get(String(u.id)) || null })),
    usageToday,
  };
};

/** The saved closed-tester phones: { phones, updatedAt }. */
const readTesterList = async () => {
  const GlobalConfig = require('../models/GlobalConfig').getGlobalConfigModel();
  const row = GlobalConfig ? await GlobalConfig.findOne({ where: { key: TESTERS_KEY } }) : null;
  let value = row ? row.value : null;
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { /* plain text list */ } }
  const list = value && Array.isArray(value.phones) ? value.phones : value;
  return { phones: parseTesterPhones(Array.isArray(list) ? list.map(String) : list || '').phones, updatedAt: row ? row.updatedAt : null };
};

/** Each saved tester phone with its account: not signed up / never opened / last opened, version, orders. */
const testerStatus = async ({ now = new Date() } = {}) => {
  const { phones, updatedAt } = await readTesterList();
  if (!phones.length) return { phones, updatedAt, testers: [], counts: { total: 0, signedUp: 0, notSignedUp: 0, neverOpened: 0, openedToday: 0, openedWeek: 0, inactive2d: 0 } };
  const U = User();
  const users = await U.findAll({ where: { phone: { [Op.in]: phoneVariants(phones) } }, attributes: USER_ATTRS, raw: true });
  const byPhone = new Map();
  for (const u of users) {
    const k = last10(u.phone);
    // An active account wins over a deleted one with the same number.
    if (!byPhone.has(k) || String(byPhone.get(k).role).toLowerCase() === 'deleted') byPhone.set(k, u);
  }
  const counts = await orderCounts(users.map((u) => String(u.id)));
  const testPhones = await ownerTestPhones();
  const { latestVersion } = await latestVersionOf(users.map((u) => u.lastAppVersion).filter(Boolean));
  // CLOSED-TEST ONLY (utils/usageTime)
  const usageMap = await require('./usageTime').usageFor(users.map((u) => String(u.id)), { now }).catch(() => new Map());
  const todayStart = istDayStart(now).getTime();
  const weekStart = now.getTime() - 7 * DAY;
  const twoDays = now.getTime() - 2 * DAY;
  // Status: today (opened since IST midnight) / recent (within 48 h) / inactive (not in 48 h) / never_opened / not_signed_up.
  const testers = phones.map((phone) => {
    const u = byPhone.get(phone);
    if (!u || String(u.role).toLowerCase() === 'deleted') return { phone, status: 'not_signed_up', user: null };
    const seen = u.lastSeenAt ? new Date(u.lastSeenAt).getTime() : null;
    let status = 'never_opened';
    if (seen !== null) status = seen >= todayStart ? 'today' : seen >= twoDays ? 'recent' : 'inactive';
    return { phone, status, user: { ...rowOf(u, counts, testPhones, latestVersion), usage: usageMap.get(String(u.id)) || null } };
  });
  const c = (s) => testers.filter((t) => t.status === s).length;
  return {
    phones,
    updatedAt,
    testers,
    counts: {
      total: testers.length,
      signedUp: testers.length - c('not_signed_up'),
      notSignedUp: c('not_signed_up'),
      neverOpened: c('never_opened'),
      openedToday: c('today'),
      openedWeek: testers.filter((t) => t.user && t.user.lastSeenAt && new Date(t.user.lastSeenAt).getTime() >= weekStart).length,
      inactive2d: c('inactive'),
    },
  };
};

module.exports = {
  TESTERS_KEY, OWN_KEYS, MAX_TESTERS, PAGE_SIZE, FILTERS, SORTS,
  istDayStart, parseTesterPhones, readTesterList, testerStatus, report,
};
