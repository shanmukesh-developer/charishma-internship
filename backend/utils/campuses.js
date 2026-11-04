/**
 * Colleges ZCS serves (owner, 31 Oct 2026). GlobalConfig key CAMPUS_SERVICE holds each college's status, set by the
 * admins (Admin > Settings > Colleges):
 *
 *   open    orders are taken
 *   paused  shown as the student's college, ordering paused (exam break, holidays, too few riders)
 *   soon    shown as "Coming soon", nobody can pick it or order for it yet
 *
 *   defaults: SRM AP open, VIT AP open, Amrita soon (owner: "currently SRM AP and VIT AP, Amrita starts soon")
 *
 * Stores: Restaurant.visibleCampuses lists the colleges a store serves (['srmap'], ['vitap'], both). Empty or not
 * set = every college (stores made before 31 Oct keep showing everywhere until the admins choose). A student only
 * sees the stores of their college, and an order is refused when the store does not serve that college, so a
 * store is never ordered from across colleges.
 */
const KEY = 'CAMPUS_SERVICE';
const CAMPUSES = Object.freeze([
  Object.freeze({ key: 'srmap', label: 'SRM AP', name: 'SRM University AP' }),
  Object.freeze({ key: 'vitap', label: 'VIT AP', name: 'VIT-AP University' }),
  Object.freeze({ key: 'amrita', label: 'Amrita', name: 'Amrita Vishwa Vidyapeetham' }),
]);
const KEYS = CAMPUSES.map((c) => c.key);
const DEFAULT_STATUS = Object.freeze({ srmap: 'open', vitap: 'open', amrita: 'soon' });
const STATUSES = ['open', 'paused', 'soon'];
const ALIASES = { srm: 'srmap', srmap: 'srmap', srmuniversityap: 'srmap', vit: 'vitap', vitap: 'vitap', vitapuniversity: 'vitap', amrita: 'amrita' };
const TTL_MS = 30 * 1000;
let cache = null; // { at, value }

/** 'SRM AP' / 'srm-ap' / 'srmap' -> 'srmap'; anything else -> null. */
const normalizeKey = (v) => ALIASES[String(v || '').toLowerCase().replace(/[^a-z]/g, '')] || null;
const labelOf = (key) => (CAMPUSES.find((c) => c.key === key) || {}).label || null;

/** Stored value (any shape) -> { srmap, vitap, amrita } statuses; anything unknown keeps its default. */
const parse = (raw) => {
  const out = { ...DEFAULT_STATUS };
  let v = raw;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = null; } }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const k of KEYS) if (STATUSES.includes(v[k])) out[k] = v[k];
  return out;
};

const model = () => {
  try { return require('../models/GlobalConfig').getGlobalConfigModel(); } catch { return null; }
};

/** Current statuses (cached 30 s; a save refreshes the cache at once). */
const getStatuses = async ({ fresh = false } = {}) => {
  if (!fresh && cache && Date.now() - cache.at < TTL_MS) return cache.value;
  let value = { ...DEFAULT_STATUS };
  try {
    const GlobalConfig = model();
    const row = GlobalConfig ? await GlobalConfig.findOne({ where: { key: KEY } }) : null;
    value = parse(row ? row.value : null);
  } catch (err) {
    console.warn('[CAMPUS_SERVICE_WARN]', err.message);
  }
  cache = { at: Date.now(), value };
  return value;
};

/** The public list: [{ key, label, name, status }] in a fixed order. */
const listCampuses = async () => {
  const st = await getStatuses();
  return CAMPUSES.map((c) => ({ ...c, status: st[c.key] }));
};

/** Admin change of one college -> { statuses } or { error }. */
const setStatus = async (key, status) => {
  const k = normalizeKey(key);
  if (!k) return { error: `Unknown college. Use one of: ${KEYS.join(', ')}.` };
  if (!STATUSES.includes(status)) return { error: `Status must be one of: ${STATUSES.join(', ')}.` };
  const GlobalConfig = model();
  if (!GlobalConfig) return { error: 'Settings are not available right now.' };
  const next = { ...(await getStatuses({ fresh: true })), [k]: status };
  await GlobalConfig.upsert({ key: KEY, value: next, description: 'Colleges served: open / paused / soon' });
  cache = { at: Date.now(), value: next };
  try { require('./responseCache').invalidate('config'); } catch { /* not loaded */ }
  try { require('./responseCache').invalidate('catalog'); } catch { /* not loaded */ }
  return { statuses: next };
};

/** A store's colleges: a clean list of known keys; [] = every college. */
const storeCampuses = (store) => {
  let v = store && store.visibleCampuses;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = v.split(','); } }
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map(normalizeKey).filter(Boolean))];
};
/** Does this store serve this college? (No college known: yes, as before colleges existed.) */
const storeServes = (store, campusKey) => {
  if (!campusKey) return true;
  const list = storeCampuses(store);
  return list.length === 0 || list.includes(campusKey);
};
/** Admin input (array / comma string / null) -> clean list, or { error } for an unknown college. */
const cleanVisibleCampuses = (value) => {
  if (value === undefined) return { skip: true };
  if (value === null || value === '') return { list: [] };
  const raw = Array.isArray(value) ? value : String(value).split(',');
  const list = [];
  for (const item of raw) {
    const k = normalizeKey(item);
    if (!k) return { error: `Unknown college "${String(item).slice(0, 40)}". Use: ${CAMPUSES.map((c) => c.label).join(', ')}.` };
    if (!list.includes(k)) list.push(k);
  }
  return { list: list.length === KEYS.length ? [] : list }; // every college ticked = no limit
};

/**
 * Can a student of this college order right now? { ok } or { ok: false, code, message } in plain words.
 * An order with no college (an off-campus pin) is not limited here, as before.
 */
const orderingCheck = async (campusKey) => {
  if (!campusKey) return { ok: true };
  const status = (await getStatuses())[campusKey];
  if (status === 'open') return { ok: true };
  const label = labelOf(campusKey);
  if (status === 'soon') return { ok: false, code: 'CAMPUS_SOON', message: `ZenWe starts at ${label} soon. We will let you know when ordering opens there.` };
  return { ok: false, code: 'CAMPUS_PAUSED', message: `Ordering at ${label} is paused for now. Please check back a little later.` };
};

const _resetCache = () => { cache = null; };

module.exports = {
  KEY, CAMPUSES, KEYS, STATUSES, DEFAULT_STATUS,
  normalizeKey, labelOf, getStatuses, listCampuses, setStatus,
  storeCampuses, storeServes, cleanVisibleCampuses, orderingCheck, _resetCache,
};
