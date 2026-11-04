/**
 * Friends configuration: feature flags, guidelines, keyword lists, auto-hide threshold, SLA hours.
 * Stored in GlobalConfig key "friends.config" (one JSON value, edited from admin /mod/config), cached 30 s.
 *
 * A sub-tab is ON only when (a) the admin flag is on AND (b) its phase has shipped, i.e. its routes
 * file called markImplemented(feature). So turning a flag on early is harmless.
 */
const { FEATURES } = require('../models/foundation/enums');

const CONFIG_KEY = 'friends.config';
const TTL_MS = 30 * 1000;

const DEFAULT_GUIDELINES = [
  'ZENV Friends is for verified students of your campus. By joining you agree to:',
  '1. Respect: no harassment, bullying, hate, threats or slurs, including in anonymous posts.',
  '2. Privacy: never share anyone\'s phone number, email, room number, photos or private chats without consent.',
  '3. Academic integrity: no exam-taking, proxy attendance, submitting others\' graded work or fake certificates. Tutoring, explaining and debugging are welcome.',
  '4. Consent: in Connect and everywhere else, "no" means no. Do not keep contacting someone who has not replied or has blocked you.',
  '5. Honest reviews: share your own experience; no unsupported allegations or personal attacks on faculty or students.',
  '6. Reporting: use Report on anything that breaks these rules. A report is reviewed by people; it is not proof by itself.',
  '7. Consequences: content can be removed, and accounts can be warned or restricted from Friends. You can appeal any decision.',
  'Anonymous posts hide your name from other students, but ZENV keeps the real author so that safety rules still apply.',
].join('\n');

const DEFAULTS = Object.freeze({
  enabled: true, // master switch for the whole Friends tab
  // All five sub-tabs shipped and verified; each is ON unless the admin config (/mod/config) turns it off.
  features: Object.freeze({ pulse: true, forum: true, tasks: true, connect: true, spaces: true }),
  guidelines: Object.freeze({ version: 1, text: DEFAULT_GUIDELINES }),
  keywords: Object.freeze({ block: Object.freeze([]), flag: Object.freeze([]) }),
  linkDenylist: Object.freeze([]),
  autoHideThreshold: 3,
  slaHours: Object.freeze({ low: 72, medium: 48, high: 24, critical: 4 }),
  connectConsentVersion: 1,
});

const implemented = new Set();
let cache = null; // { at, value }

const clone = (v) => JSON.parse(JSON.stringify(v));

const merge = (stored) => {
  const s = stored && typeof stored === 'object' ? stored : {};
  const out = clone(DEFAULTS);
  if (typeof s.enabled === 'boolean') out.enabled = s.enabled;
  if (s.features && typeof s.features === 'object') {
    for (const f of FEATURES) if (typeof s.features[f] === 'boolean') out.features[f] = s.features[f];
  }
  if (s.guidelines && typeof s.guidelines === 'object') {
    if (Number.isInteger(s.guidelines.version) && s.guidelines.version >= 1) out.guidelines.version = s.guidelines.version;
    if (typeof s.guidelines.text === 'string' && s.guidelines.text.trim()) out.guidelines.text = s.guidelines.text;
  }
  if (s.keywords && typeof s.keywords === 'object') {
    for (const k of ['block', 'flag']) if (Array.isArray(s.keywords[k])) out.keywords[k] = s.keywords[k].filter((w) => typeof w === 'string');
  }
  if (Array.isArray(s.linkDenylist)) out.linkDenylist = s.linkDenylist.filter((w) => typeof w === 'string');
  if (Number.isInteger(s.autoHideThreshold)) out.autoHideThreshold = s.autoHideThreshold;
  if (s.slaHours && typeof s.slaHours === 'object') {
    for (const k of Object.keys(out.slaHours)) if (Number.isFinite(s.slaHours[k]) && s.slaHours[k] > 0) out.slaHours[k] = s.slaHours[k];
  }
  if (Number.isInteger(s.connectConsentVersion) && s.connectConsentVersion >= 1) out.connectConsentVersion = s.connectConsentVersion;
  return out;
};

const configModel = () => {
  try {
    const { getModel } = require('../index');
    return getModel('GlobalConfig') || require('../../../models/GlobalConfig').getGlobalConfigModel();
  } catch {
    return null;
  }
};

const readStored = async () => {
  const GlobalConfig = configModel();
  if (!GlobalConfig) return null;
  const row = await GlobalConfig.findOne({ where: { key: CONFIG_KEY } });
  if (!row) return null;
  let v = row.value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = null; } }
  return v;
};

/** Effective config (defaults merged with the stored value). Never throws. */
const getConfig = async ({ fresh = false } = {}) => {
  if (!fresh && cache && Date.now() - cache.at < TTL_MS) return cache.value;
  let stored = null;
  try { stored = await readStored(); } catch (err) { console.warn('[FRIENDS_CONFIG_WARN]', err.message); }
  const value = merge(stored);
  cache = { at: Date.now(), value };
  return value;
};

/** Last loaded config without I/O (defaults before the first load). */
const peekConfig = () => (cache ? cache.value : merge(null));

// ── Validation of an admin patch ─────────────────────────────────────────────
const validatePatch = (patch, current) => {
  const errors = [];
  const p = patch && typeof patch === 'object' ? patch : {};
  const next = clone(current);
  if (p.enabled !== undefined) {
    if (typeof p.enabled !== 'boolean') errors.push('enabled must be true or false');
    else next.enabled = p.enabled;
  }
  if (p.features !== undefined) {
    if (!p.features || typeof p.features !== 'object') errors.push('features must be an object');
    else {
      for (const [k, v] of Object.entries(p.features)) {
        if (!FEATURES.includes(k)) errors.push(`unknown feature ${k}`);
        else if (typeof v !== 'boolean') errors.push(`features.${k} must be true or false`);
        else next.features[k] = v;
      }
    }
  }
  if (p.guidelines !== undefined) {
    const g = p.guidelines || {};
    if (g.version !== undefined) {
      if (!Number.isInteger(g.version) || g.version < current.guidelines.version || g.version > 1000) errors.push('guidelines.version must be a whole number, not lower than the current one');
      else next.guidelines.version = g.version;
    }
    if (g.text !== undefined) {
      if (typeof g.text !== 'string' || !g.text.trim() || g.text.length > 8000) errors.push('guidelines.text must be 1-8000 characters');
      else next.guidelines.text = g.text;
    }
  }
  if (p.keywords !== undefined) {
    const k = p.keywords || {};
    for (const key of ['block', 'flag']) {
      if (k[key] === undefined) continue;
      const list = k[key];
      if (!Array.isArray(list) || list.length > 500 || list.some((w) => typeof w !== 'string' || !w.trim() || w.length > 60)) {
        errors.push(`keywords.${key} must be up to 500 words of 1-60 characters`);
      } else next.keywords[key] = [...new Set(list.map((w) => w.trim().toLowerCase()))];
    }
  }
  if (p.linkDenylist !== undefined) {
    const list = p.linkDenylist;
    if (!Array.isArray(list) || list.length > 500 || list.some((w) => typeof w !== 'string' || !/^[a-z0-9.-]{3,100}$/i.test(w.trim()))) {
      errors.push('linkDenylist must be up to 500 host names');
    } else next.linkDenylist = [...new Set(list.map((w) => w.trim().toLowerCase()))];
  }
  if (p.autoHideThreshold !== undefined) {
    if (!Number.isInteger(p.autoHideThreshold) || p.autoHideThreshold < 2 || p.autoHideThreshold > 20) errors.push('autoHideThreshold must be 2-20');
    else next.autoHideThreshold = p.autoHideThreshold;
  }
  if (p.slaHours !== undefined) {
    const s = p.slaHours || {};
    for (const [k, v] of Object.entries(s)) {
      if (!(k in next.slaHours)) errors.push(`unknown severity ${k}`);
      else if (!Number.isFinite(v) || v < 1 || v > 720) errors.push(`slaHours.${k} must be 1-720`);
      else next.slaHours[k] = v;
    }
  }
  if (p.connectConsentVersion !== undefined) {
    if (!Number.isInteger(p.connectConsentVersion) || p.connectConsentVersion < current.connectConsentVersion) errors.push('connectConsentVersion must not go down');
    else next.connectConsentVersion = p.connectConsentVersion;
  }
  return { errors, next };
};

/** Saves an admin patch; returns { errors } or { config }. */
const setConfig = async (patch) => {
  const current = await getConfig({ fresh: true });
  const { errors, next } = validatePatch(patch, current);
  if (errors.length) return { errors };
  const GlobalConfig = configModel();
  if (!GlobalConfig) return { errors: ['config storage is not available'] };
  const row = await GlobalConfig.findOne({ where: { key: CONFIG_KEY } });
  if (row) {
    row.value = next;
    row.changed('value', true);
    await row.save();
  } else {
    await GlobalConfig.create({ key: CONFIG_KEY, value: next, description: 'ZENV Friends configuration (admin /mod/config)' });
  }
  cache = { at: Date.now(), value: merge(next) };
  require('../../../utils/cacheBus').broadcast('flags.friends'); // B1: other instances re-read it
  // GET /api/config/sections carries the master switch (campus.live): drop its 60 s cache so the Home "Campus"
  // button follows the switch at once.
  try { require('../../../utils/responseCache').invalidate('sections'); } catch { /* not loaded */ }
  return { config: cache.value };
};

const markImplemented = (feature) => { if (FEATURES.includes(feature)) implemented.add(feature); };
const isImplemented = (feature) => implemented.has(feature);

/** Effective on/off for one feature (null feature = the Friends foundation itself). */
const isEnabled = (cfg, feature) => {
  if (!cfg.enabled) return false;
  if (!feature) return true;
  return !!cfg.features[feature] && implemented.has(feature);
};

const featureMap = (cfg) => Object.fromEntries(FEATURES.map((f) => [f, isEnabled(cfg, f)]));

const clearCache = () => { cache = null; };
// B1: config written on another instance -> drop ours (utils/cacheBus).
require('../../../utils/cacheBus').register('flags.friends', clearCache, { resync: clearCache });

module.exports = {
  CONFIG_KEY,
  DEFAULTS,
  getConfig,
  peekConfig,
  setConfig,
  validatePatch,
  markImplemented,
  isImplemented,
  isEnabled,
  featureMap,
  clearCache,
};
