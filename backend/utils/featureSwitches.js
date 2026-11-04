/**
 * C2: kill switches for campus features outside Friends, same mechanism as the Rentals switch
 * (GlobalConfig VEHICLE_RENTALS_ENABLED): one GlobalConfig key per feature, default ON, cached 30 s,
 * toggled from the admin dashboard (PUT /api/campus/mod/switches) and audited there.
 *
 *   CAMPUS_WHISPERS_ENABLED  Campus Whispers (anonymous board, /api/campus/pulse/whispers*)
 *   AFTER_DARK_ENABLED       Zenvy After Dark (legacy /api/chat/*, /api/rooms/*, after-dark sockets)
 *
 * When off, the API answers 403 { code: 'FEATURE_OFF', feature } and GET /api/campus/features tells
 * the app to hide the entry point.
 */
const TTL_MS = 30 * 1000;

const SWITCHES = Object.freeze({
  whispers: { key: 'CAMPUS_WHISPERS_ENABLED', label: 'Campus Whispers', message: 'Campus Whispers is paused right now. Please check back soon.' },
  afterDark: { key: 'AFTER_DARK_ENABLED', label: 'ZENV After Dark', message: 'ZENV After Dark is paused right now. Please check back soon.' },
});

const cache = new Map(); // name -> { at, value }
// B1: a switch flipped on one instance is re-read by every instance at once (utils/cacheBus).
const cacheBus = require('./cacheBus');
// Marked stale (not deleted): peek() keeps answering the last known value while it re-reads.
const markStale = (name) => {
  for (const [k, hit] of cache) if (!name || k === name) cache.set(k, { at: 0, value: hit.value });
};
cacheBus.register('flags.switches', markStale, { resync: () => markStale() });

const configModel = () => {
  try { return require('../models/GlobalConfig').getGlobalConfigModel(); } catch { return null; }
};

const parseOn = (v) => {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { /* plain string */ } }
  return !(v === false || v === 'false' || v === 0 || v === '0' || v === 'off' || (v && typeof v === 'object' && v.enabled === false));
};

/** Is the feature on? Never throws (a read error keeps the last known value, default on). */
const isOn = async (name, { fresh = false } = {}) => {
  const sw = SWITCHES[name];
  if (!sw) return true;
  const hit = cache.get(name);
  if (!fresh && hit && Date.now() - hit.at < TTL_MS) return hit.value;
  let value = hit ? hit.value : true;
  try {
    const GlobalConfig = configModel();
    const row = GlobalConfig ? await GlobalConfig.findOne({ where: { key: sw.key } }) : null;
    value = row ? parseOn(row.value) : true;
  } catch (err) {
    console.warn('[FEATURE_SWITCH_WARN]', sw.key, err.message);
  }
  cache.set(name, { at: Date.now(), value });
  return value;
};

/** Last known value without I/O (refreshes in the background when stale). For sync socket checks. */
const peek = (name) => {
  const hit = cache.get(name);
  if (!hit || Date.now() - hit.at >= TTL_MS) isOn(name).catch(() => {});
  return hit ? hit.value : true;
};

const setOn = async (name, enabled) => {
  const sw = SWITCHES[name];
  if (!sw) throw new Error(`unknown switch ${name}`);
  const GlobalConfig = configModel();
  if (!GlobalConfig) throw new Error('config storage is not available');
  const row = await GlobalConfig.findOne({ where: { key: sw.key } });
  if (row) await row.update({ value: !!enabled });
  else await GlobalConfig.create({ key: sw.key, value: !!enabled, description: `${sw.label} on/off (admin Friends moderation)` });
  cache.set(name, { at: Date.now(), value: !!enabled });
  cacheBus.broadcast('flags.switches', name);
  try { require('./realtime').publish('config', 'updated', sw.key, { scope: 'global' }); } catch { /* cache just expires */ }
  return !!enabled;
};

const all = async () => {
  const out = {};
  for (const name of Object.keys(SWITCHES)) out[name] = await isOn(name);
  return out;
};

const offBody = (name) => ({ code: 'FEATURE_OFF', feature: name, message: (SWITCHES[name] || {}).message || 'This feature is paused right now.' });

/** Express middleware: 403 FEATURE_OFF while the switch is off. */
const requireOn = (name) => async (req, res, next) => {
  if (await isOn(name)) return next();
  return res.status(403).json(offBody(name));
};

const clearCache = () => cache.clear();

module.exports = { SWITCHES, isOn, peek, setOn, all, offBody, requireOn, clearCache };
