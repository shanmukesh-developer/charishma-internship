/**
 * C4 legal / compliance settings (GlobalConfig key LEGAL_SETTINGS), edited on admin Config → Legal.
 *
 *   { businessName, operatorName, contactEmail, registeredAddress, jurisdictionCity,
 *     grievanceOfficer: { name, designation, email, phone, address },
 *     effectiveDate: 'YYYY-MM-DD', policyVersion: '1.0' }
 *
 * The public pages (routes/legalRoutes.js) render whatever is set here. Nothing is ever invented:
 * an empty field renders as "will be published here" (grievance officer) or is simply left out.
 * policyVersion is what the apps compare with User.termsAcceptedVersion: changing it asks every
 * signed-in customer once (non-blocking) to accept the updated Terms.
 */
const KEY = 'LEGAL_SETTINGS';

// Defaults = what the original /legal/privacy page already said (operator + contact). No other facts.
const DEFAULTS = Object.freeze({
  businessName: 'ZENV',
  operatorName: 'Shanmukesh Kunjam',
  contactEmail: 'projectshanmukh@gmail.com',
  registeredAddress: '',
  jurisdictionCity: '',
  grievanceOfficer: Object.freeze({ name: '', designation: '', email: '', phone: '', address: '' }),
  effectiveDate: '2026-10-18',
  policyVersion: '1.0',
});

const LIMITS = {
  businessName: 120,
  operatorName: 120,
  contactEmail: 254,
  registeredAddress: 400,
  jurisdictionCity: 80,
  'grievanceOfficer.name': 120,
  'grievanceOfficer.designation': 120,
  'grievanceOfficer.email': 254,
  'grievanceOfficer.phone': 20,
  'grievanceOfficer.address': 400,
};

const EMAIL_RE = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}\.[A-Za-z]{2,24}$/;
const PHONE_RE = /^\+?[0-9][0-9 -]{6,18}[0-9]$/;
const VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z.-]{0,19}$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
// Control characters (newlines are allowed only in addresses).
const CTRL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/; // eslint-disable-line no-control-regex

const clone = (o) => JSON.parse(JSON.stringify(o));
const defaults = () => clone(DEFAULTS);

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const isValidDate = (s) => {
  const m = DATE_RE.exec(String(s || ''));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] && +m[1] >= 2020 && +m[1] <= 2100;
};

/** Stored value (any shape, possibly junk) -> full settings object. Bad fields fall back to defaults. */
const parse = (raw) => {
  const out = defaults();
  let v = raw;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = null; } }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const k of ['businessName', 'operatorName', 'contactEmail', 'registeredAddress', 'jurisdictionCity']) {
    if (typeof v[k] === 'string') out[k] = v[k].trim().slice(0, LIMITS[k]);
  }
  if (!out.businessName) out.businessName = DEFAULTS.businessName;
  if (!out.contactEmail || !EMAIL_RE.test(out.contactEmail)) out.contactEmail = DEFAULTS.contactEmail;
  const go = v.grievanceOfficer && typeof v.grievanceOfficer === 'object' ? v.grievanceOfficer : {};
  for (const k of Object.keys(DEFAULTS.grievanceOfficer)) {
    if (typeof go[k] === 'string') out.grievanceOfficer[k] = go[k].trim().slice(0, LIMITS[`grievanceOfficer.${k}`]);
  }
  if (isValidDate(v.effectiveDate)) out.effectiveDate = v.effectiveDate;
  if (typeof v.policyVersion === 'string' && VERSION_RE.test(v.policyVersion.trim())) out.policyVersion = v.policyVersion.trim();
  return out;
};

/** True when the grievance officer can be published (IT Rules 2021 r.3(2) / E-Commerce Rules 2020 r.4(4)). */
const grievanceComplete = (s) => {
  const g = (s && s.grievanceOfficer) || {};
  return !!(str(g.name) && str(g.designation) && str(g.email));
};

/** What is still missing for a complete compliance page (shown on the admin card). */
const missingFields = (s) => {
  const g = (s && s.grievanceOfficer) || {};
  const m = [];
  if (!str(g.name)) m.push('grievanceOfficer.name');
  if (!str(g.designation)) m.push('grievanceOfficer.designation');
  if (!str(g.email)) m.push('grievanceOfficer.email');
  if (!str(s && s.registeredAddress) && !str(g.address)) m.push('registeredAddress');
  if (!str(s && s.jurisdictionCity)) m.push('jurisdictionCity');
  return m;
};

const LABELS = {
  businessName: 'Business name',
  operatorName: 'Operated by',
  contactEmail: 'Contact email',
  registeredAddress: 'Registered address',
  jurisdictionCity: 'Jurisdiction city',
  'grievanceOfficer.name': 'Grievance officer name',
  'grievanceOfficer.designation': 'Grievance officer designation',
  'grievanceOfficer.email': 'Grievance officer email',
  'grievanceOfficer.phone': 'Grievance officer phone',
  'grievanceOfficer.address': 'Grievance officer address',
  effectiveDate: 'Effective date',
  policyVersion: 'Policy version',
};

/**
 * Partial update -> { settings } or { error }. Only fields present in `body` change; '' clears an
 * optional field. Required: businessName, contactEmail, effectiveDate, policyVersion.
 */
const validateUpdate = (before, body) => {
  const next = clone(before);
  const b = body && typeof body === 'object' ? body : {};
  const checkText = (path, val, { required = false, multiline = false } = {}) => {
    if (val === undefined) return null;
    if (val === null) val = '';
    if (typeof val !== 'string') return `${LABELS[path]} must be text.`;
    const t = val.trim();
    if (required && !t) return `${LABELS[path]} is required.`;
    if (t.length > LIMITS[path]) return `${LABELS[path]} must be at most ${LIMITS[path]} characters.`;
    if (CTRL_RE.test(t) || (!multiline && /[\r\n]/.test(t))) return `${LABELS[path]} contains characters that are not allowed.`;
    if (/[<>]/.test(t)) return `${LABELS[path]} must not contain < or >.`;
    return null;
  };
  const top = [
    ['businessName', { required: true }],
    ['operatorName', {}],
    ['contactEmail', { required: true }],
    ['registeredAddress', { multiline: true }],
    ['jurisdictionCity', {}],
  ];
  for (const [k, opts] of top) {
    const err = checkText(k, b[k], opts);
    if (err) return { error: err };
    if (b[k] !== undefined) next[k] = String(b[k] || '').trim();
  }
  if (b.contactEmail !== undefined && !EMAIL_RE.test(next.contactEmail)) return { error: 'Contact email is not a valid email address.' };
  if (b.grievanceOfficer !== undefined) {
    if (!b.grievanceOfficer || typeof b.grievanceOfficer !== 'object' || Array.isArray(b.grievanceOfficer)) return { error: 'Grievance officer must be an object.' };
    const go = b.grievanceOfficer;
    for (const k of Object.keys(DEFAULTS.grievanceOfficer)) {
      const path = `grievanceOfficer.${k}`;
      const err = checkText(path, go[k], { multiline: k === 'address' });
      if (err) return { error: err };
      if (go[k] !== undefined) next.grievanceOfficer[k] = String(go[k] || '').trim();
    }
    const unknown = Object.keys(go).filter((k) => !(k in DEFAULTS.grievanceOfficer));
    if (unknown.length) return { error: `Unknown grievance officer field: ${unknown[0]}.` };
    if (next.grievanceOfficer.email && !EMAIL_RE.test(next.grievanceOfficer.email)) return { error: 'Grievance officer email is not a valid email address.' };
    if (next.grievanceOfficer.phone && !PHONE_RE.test(next.grievanceOfficer.phone)) return { error: 'Grievance officer phone must be a phone number (digits, spaces, dashes, optional leading +).' };
  }
  if (b.effectiveDate !== undefined) {
    if (!isValidDate(b.effectiveDate)) return { error: 'Effective date must be a real date as YYYY-MM-DD.' };
    next.effectiveDate = b.effectiveDate;
  }
  if (b.policyVersion !== undefined) {
    const v = typeof b.policyVersion === 'string' ? b.policyVersion.trim() : '';
    if (!VERSION_RE.test(v)) return { error: 'Policy version must be 1-20 letters, digits, dots or dashes (for example 1.1 or 2026-11).' };
    next.policyVersion = v;
  }
  const known = new Set([...Object.keys(DEFAULTS), 'ifUpdatedAt']);
  const unknownTop = Object.keys(b).filter((k) => !known.has(k));
  if (unknownTop.length) return { error: `Unknown field: ${unknownTop[0]}.` };
  return { settings: next };
};

/** Flat list of what changed, for the audit row. */
const diff = (before, after) => {
  const changes = {};
  for (const k of Object.keys(DEFAULTS)) {
    if (k === 'grievanceOfficer') continue;
    if (before[k] !== after[k]) changes[k] = [before[k], after[k]];
  }
  for (const k of Object.keys(DEFAULTS.grievanceOfficer)) {
    if (before.grievanceOfficer[k] !== after.grievanceOfficer[k]) changes[`grievanceOfficer.${k}`] = [before.grievanceOfficer[k], after.grievanceOfficer[k]];
  }
  return changes;
};

// ─── Cached read (same pattern as utils/appVersionPolicy) ───────────────────
const CACHE_MS = 30 * 1000;
let cache = null;
let loading = null;
const clearCacheLocal = () => { cache = null; };
const clearCache = require('./cacheBus').wrap('legalSettings.clear', clearCacheLocal, { resync: clearCacheLocal });

const readFromDb = async () => {
  const { getGlobalConfigModel } = require('../models/GlobalConfig');
  const GlobalConfig = getGlobalConfigModel();
  if (!GlobalConfig) return { settings: defaults(), row: null };
  const row = await GlobalConfig.findOne({ where: { key: KEY } });
  return { settings: parse(row ? row.value : null), row };
};

/** Cached settings (30 s, cleared on every admin write). A failed read serves the last good copy, or defaults. */
const getSettings = async ({ fresh = false } = {}) => {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.settings;
  if (!loading) {
    loading = readFromDb()
      .then(({ settings }) => { cache = { at: Date.now(), settings }; return settings; })
      .catch((err) => {
        console.warn('[LEGAL_SETTINGS_READ_WARN]', err.message);
        const fallback = cache ? cache.settings : defaults();
        cache = { at: Date.now() - CACHE_MS + 5000, settings: fallback };
        return fallback;
      })
      .finally(() => { loading = null; });
  }
  return loading;
};

const PAGES = [
  { key: 'terms', path: '/legal/terms', title: 'Terms of Service' },
  { key: 'privacy', path: '/legal/privacy', title: 'Privacy Policy' },
  { key: 'refunds', path: '/legal/refunds', title: 'Cancellation & Refund Policy' },
  { key: 'grievance', path: '/legal/grievance', title: 'Grievance Redressal' },
  { key: 'communityGuidelines', path: '/legal/community-guidelines', title: 'Community Guidelines' },
  { key: 'deleteAccount', path: '/legal/delete-account', title: 'Delete your account' },
];

/** Absolute page links for the apps (PUBLIC_API_URL, else the request's host). */
const pageUrls = (req) => {
  const base = require('./publicUrl').apiBase(req);
  const out = { index: `${base}/legal` };
  for (const p of PAGES) out[p.key] = `${base}${p.path}`;
  return out;
};

/** Accepted-terms status for a user / partner row (the apps use termsUpdateRequired). */
const acceptanceStatus = (row, settings) => {
  const current = (settings && settings.policyVersion) || DEFAULTS.policyVersion;
  const accepted = row && row.termsAcceptedVersion ? String(row.termsAcceptedVersion) : null;
  return {
    termsAcceptedVersion: accepted,
    termsAcceptedAt: row && row.termsAcceptedAt ? row.termsAcceptedAt : null,
    termsCurrentVersion: current,
    termsUpdateRequired: accepted !== current,
  };
};

/**
 * Reads { acceptTerms, termsVersion } from a request body. Returns the fields to store on the new row,
 * or {} when the client did not send acceptTerms:true (older app builds: still allowed, no record).
 * The stored version is the one the client says it showed (when valid), else the current one; if it is
 * not the current version the user is simply asked again after sign-in.
 */
const consentFromBody = async (body) => {
  const b = body && typeof body === 'object' ? body : {};
  if (b.acceptTerms !== true && b.acceptTerms !== 'true') return {};
  const settings = await getSettings();
  const sent = typeof b.termsVersion === 'string' ? b.termsVersion.trim() : '';
  return { termsAcceptedVersion: VERSION_RE.test(sent) ? sent : settings.policyVersion, termsAcceptedAt: new Date() };
};

module.exports = {
  KEY, DEFAULTS, LIMITS, PAGES, defaults, parse, validateUpdate, diff, grievanceComplete, missingFields,
  getSettings, readFromDb, clearCache, pageUrls, acceptanceStatus, consentFromBody, isValidDate, VERSION_RE,
};
