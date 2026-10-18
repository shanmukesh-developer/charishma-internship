/**
 * C8 seller compliance fields on a store (models/Restaurant: restaurants, shops and CampusBites stalls).
 *
 *   legalName, fssaiLicenseNumber (14 digits), fssaiLicenseType (BASIC | STATE | CENTRAL), fssaiExpiry
 *   (YYYY-MM-DD), gstin (15-char format, optional), pan (optional, shown masked), payoutUpiId,
 *   bankAccountHolder, bankAccountLast4, bankIfsc.
 *
 * Nothing here is invented: every value comes from the store owner or an admin and is only format-checked.
 * A full bank account number is never stored: if one is sent (bankAccountNumber) only its last 4 digits are
 * kept. Changing the FSSAI number / type / expiry clears the admin verification (fssaiVerifiedAt / By).
 *
 * Who may edit what:
 *   - admin: every field (PUT /api/admin/restaurants/:id/compliance, or the store edit form), audited.
 *   - store owner (restaurant / vendor app): legal name, FSSAI number / type / expiry, GSTIN. PAN and payout
 *     details only through Zenvy support (an attacker with a store login must not be able to redirect payouts).
 */
const FSSAI_TYPES = ['BASIC', 'STATE', 'CENTRAL'];
const OWNER_FIELDS = ['legalName', 'fssaiLicenseNumber', 'fssaiLicenseType', 'fssaiExpiry', 'gstin'];
const ADMIN_ONLY_FIELDS = ['pan', 'payoutUpiId', 'bankAccountHolder', 'bankAccountLast4', 'bankAccountNumber', 'bankIfsc'];
const INPUT_FIELDS = [...OWNER_FIELDS, ...ADMIN_ONLY_FIELDS];
// Stored columns (bankAccountNumber is input only).
const STORED_FIELDS = ['legalName', 'fssaiLicenseNumber', 'fssaiLicenseType', 'fssaiExpiry', 'gstin', 'pan', 'payoutUpiId', 'bankAccountHolder', 'bankAccountLast4', 'bankIfsc'];
const FSSAI_FIELDS = ['fssaiLicenseNumber', 'fssaiLicenseType', 'fssaiExpiry'];
const WRITE_ONLY_FIELDS = ['pan', 'bankAccountNumber'];

const FSSAI_RE = /^\d{14}$/;
// 2-digit state code, 10-char PAN, entity number, 'Z', check character.
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const UPI_RE = /^[a-z0-9][a-z0-9._-]{1,255}@[a-z][a-z0-9.-]{1,63}$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
// eslint-disable-next-line no-control-regex
const CTRL_RE = /[\u0000-\u001F\u007F]/;

const LABELS = {
  legalName: 'Legal name',
  fssaiLicenseNumber: 'FSSAI licence number',
  fssaiLicenseType: 'FSSAI licence type',
  fssaiExpiry: 'FSSAI licence expiry date',
  gstin: 'GSTIN',
  pan: 'PAN',
  payoutUpiId: 'Payout UPI ID',
  bankAccountHolder: 'Bank account holder name',
  bankAccountLast4: 'Bank account last 4 digits',
  bankAccountNumber: 'Bank account number',
  bankIfsc: 'IFSC',
};

class ComplianceInputError extends Error {
  constructor(message, field, code = 'INVALID_COMPLIANCE') { super(message); this.field = field; this.code = code; }
}

const isValidYmd = (s) => {
  const m = DATE_RE.exec(String(s || ''));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] && +m[1] >= 2000 && +m[1] <= 2100;
};

/** 'YYYY-MM-DD' of today in IST. */
const todayIst = (now = new Date()) => require('./istTime').istYmd(now);

const ymdOf = (v) => {
  if (!v) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
};

/** Normalises one field. Returns the value to store (null clears). Throws ComplianceInputError. */
const normalizeField = (key, raw) => {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string' && typeof raw !== 'number') throw new ComplianceInputError(`${LABELS[key]} must be text.`, key);
  let v = String(raw).trim();
  if (!v) return null;
  if (CTRL_RE.test(v) || /[<>]/.test(v)) throw new ComplianceInputError(`${LABELS[key]} contains characters that are not allowed.`, key);
  switch (key) {
    case 'legalName':
      v = v.replace(/\s+/g, ' ');
      if (v.length < 2 || v.length > 200) throw new ComplianceInputError('Legal name must be 2 to 200 characters.', key);
      return v;
    case 'fssaiLicenseNumber':
      v = v.replace(/[\s-]/g, '');
      if (!FSSAI_RE.test(v)) throw new ComplianceInputError('FSSAI licence number must be exactly 14 digits.', key);
      return v;
    case 'fssaiLicenseType':
      v = v.toUpperCase();
      if (!FSSAI_TYPES.includes(v)) throw new ComplianceInputError('FSSAI licence type must be BASIC (registration), STATE or CENTRAL.', key);
      return v;
    case 'fssaiExpiry':
      v = v.slice(0, 10);
      if (!isValidYmd(v)) throw new ComplianceInputError('FSSAI licence expiry must be a real date as YYYY-MM-DD.', key);
      return v;
    case 'gstin':
      v = v.toUpperCase().replace(/\s/g, '');
      if (!GSTIN_RE.test(v)) throw new ComplianceInputError('GSTIN must be 15 characters in the GST format (for example 37ABCDE1234F1Z5).', key);
      return v;
    case 'pan':
      v = v.toUpperCase().replace(/\s/g, '');
      if (!PAN_RE.test(v)) throw new ComplianceInputError('PAN must be 10 characters (5 letters, 4 digits, 1 letter).', key);
      return v;
    case 'payoutUpiId':
      v = v.toLowerCase();
      if (v.length > 256 || !UPI_RE.test(v)) throw new ComplianceInputError('Payout UPI ID must look like name@bank.', key);
      return v;
    case 'bankAccountHolder':
      v = v.replace(/\s+/g, ' ');
      if (v.length < 2 || v.length > 120) throw new ComplianceInputError('Bank account holder name must be 2 to 120 characters.', key);
      return v;
    case 'bankAccountLast4':
      if (!/^\d{4}$/.test(v)) throw new ComplianceInputError('Bank account last 4 digits must be exactly 4 digits.', key);
      return v;
    case 'bankAccountNumber':
      v = v.replace(/[\s-]/g, '');
      if (!/^\d{6,20}$/.test(v)) throw new ComplianceInputError('Bank account number must be 6 to 20 digits.', key);
      return v.slice(-4); // only the last 4 digits are ever kept
    case 'bankIfsc':
      v = v.toUpperCase().replace(/\s/g, '');
      if (!IFSC_RE.test(v)) throw new ComplianceInputError('IFSC must be 11 characters (4 letters, 0, then 6 letters or digits).', key);
      return v;
    default:
      throw new ComplianceInputError(`Unknown field ${key}.`, key);
  }
};

/** True when the body carries at least one compliance field. */
const hasComplianceInput = (body) => !!body && typeof body === 'object' && INPUT_FIELDS.some((k) => body[k] !== undefined);

/**
 * Validates the compliance part of `body` against the current store row.
 *   actor: 'admin' | 'store'
 * Returns { patch, changes } (patch = columns to write; changes = { field: [before, after] } with private
 * values masked, for the audit row). Throws ComplianceInputError on bad input or a forbidden field.
 */
const validateCompliance = (body, current, { actor = 'admin', now = new Date() } = {}) => {
  const b = body && typeof body === 'object' ? body : {};
  const cur = current && typeof current.get === 'function' ? current.get({ plain: true }) : (current || {});
  const patch = {};
  for (const key of INPUT_FIELDS) {
    if (b[key] === undefined) continue;
    // Write-only fields (the UI only ever sees PAN masked): '' means "unchanged", null clears.
    if (WRITE_ONLY_FIELDS.includes(key) && typeof b[key] === 'string' && !b[key].trim()) continue;
    if (actor !== 'admin' && ADMIN_ONLY_FIELDS.includes(key)) {
      throw new ComplianceInputError('PAN and payout details can only be changed by Zenvy support. Please contact support.', key, 'ADMIN_ONLY_FIELD');
    }
    const value = normalizeField(key, b[key]);
    if (key === 'bankAccountNumber') {
      if (value !== null) patch.bankAccountLast4 = value;
      continue;
    }
    patch[key] = value;
  }
  // Drop no-op writes.
  for (const k of Object.keys(patch)) {
    const before = k === 'fssaiExpiry' ? ymdOf(cur[k]) : (cur[k] === undefined ? null : cur[k]);
    if ((before === null ? null : String(before)) === (patch[k] === null ? null : String(patch[k]))) delete patch[k];
  }
  const changes = {};
  for (const k of Object.keys(patch)) {
    const before = k === 'fssaiExpiry' ? ymdOf(cur[k]) : (cur[k] === undefined ? null : cur[k]);
    changes[k] = [maskForAudit(k, before), maskForAudit(k, patch[k])];
  }
  // Type / expiry without a number make no sense.
  const after = { ...cur, ...patch };
  if (!after.fssaiLicenseNumber && (patch.fssaiLicenseType || patch.fssaiExpiry)) {
    throw new ComplianceInputError('Add the 14-digit FSSAI licence number first.', 'fssaiLicenseNumber');
  }
  if (FSSAI_FIELDS.some((k) => k in patch)) {
    patch.fssaiSubmittedAt = after.fssaiLicenseNumber ? now : null;
    // Any change to the licence needs a fresh admin check.
    if (cur.fssaiVerifiedAt || cur.fssaiVerifiedBy) {
      patch.fssaiVerifiedAt = null;
      patch.fssaiVerifiedBy = null;
      changes.fssaiVerification = ['verified', 'cleared (licence changed)'];
    }
    if (!after.fssaiLicenseNumber) {
      // Number cleared: type and expiry go with it.
      if (cur.fssaiLicenseType) { patch.fssaiLicenseType = null; changes.fssaiLicenseType = changes.fssaiLicenseType || [cur.fssaiLicenseType, null]; }
      if (cur.fssaiExpiry) { patch.fssaiExpiry = null; changes.fssaiExpiry = changes.fssaiExpiry || [ymdOf(cur.fssaiExpiry), null]; }
    }
  }
  return { patch, changes };
};

const maskPan = (pan) => (pan ? `XXXXXX${String(pan).slice(-4)}` : null);
const maskUpi = (upi) => {
  if (!upi) return null;
  const [name, bank] = String(upi).split('@');
  return `${name.slice(0, 2)}${'*'.repeat(Math.max(1, name.length - 2))}@${bank || ''}`;
};
function maskForAudit(key, v) {
  if (v === null || v === undefined || v === '') return null;
  if (key === 'pan') return maskPan(v);
  if (key === 'payoutUpiId') return maskUpi(v);
  return v;
}

/**
 * FSSAI status of a store row: MISSING | EXPIRED | PENDING (number given, not yet verified by an admin) |
 * VERIFIED. expiringSoon = valid but expires within 30 days.
 */
const fssaiStatus = (store, now = new Date()) => {
  const s = store || {};
  if (!s.fssaiLicenseNumber) return { status: 'MISSING', expiringSoon: false, expiry: null };
  const exp = ymdOf(s.fssaiExpiry);
  const today = todayIst(now);
  if (exp && exp < today) return { status: 'EXPIRED', expiringSoon: false, expiry: exp };
  const soon = !!exp && exp <= todayIst(new Date(now.getTime() + 30 * 86400000));
  return { status: s.fssaiVerifiedAt ? 'VERIFIED' : 'PENDING', expiringSoon: soon, expiry: exp };
};

/** Customer-facing line for the store page / checkout / receipt. */
const fssaiDisplayText = (number) => (number ? `FSSAI Lic. No. ${number}` : 'FSSAI licence not provided');

/** Public (customer) view: only what must be shown. */
const publicView = (store) => ({
  fssaiLicenseNumber: (store && store.fssaiLicenseNumber) || null,
  fssaiText: fssaiDisplayText(store && store.fssaiLicenseNumber),
});

/** Owner / admin view of the compliance fields. PAN is always masked; the full number is never sent. */
const privateView = (store, { now = new Date() } = {}) => {
  const s = store && typeof store.get === 'function' ? store.get({ plain: true }) : (store || {});
  const st = fssaiStatus(s, now);
  return {
    legalName: s.legalName || null,
    fssaiLicenseNumber: s.fssaiLicenseNumber || null,
    fssaiLicenseType: s.fssaiLicenseType || null,
    fssaiExpiry: ymdOf(s.fssaiExpiry),
    fssaiSubmittedAt: s.fssaiSubmittedAt || null,
    fssaiVerifiedAt: s.fssaiVerifiedAt || null,
    fssaiVerifiedBy: s.fssaiVerifiedBy || null,
    fssaiStatus: st.status,
    fssaiExpiringSoon: st.expiringSoon,
    fssaiText: fssaiDisplayText(s.fssaiLicenseNumber),
    gstin: s.gstin || null,
    panMasked: maskPan(s.pan),
    hasPan: !!s.pan,
    payoutUpiId: s.payoutUpiId || null,
    bankAccountHolder: s.bankAccountHolder || null,
    bankAccountLast4: s.bankAccountLast4 || null,
    bankIfsc: s.bankIfsc || null,
  };
};

module.exports = {
  FSSAI_TYPES, OWNER_FIELDS, ADMIN_ONLY_FIELDS, WRITE_ONLY_FIELDS, INPUT_FIELDS, STORED_FIELDS, FSSAI_FIELDS, LABELS,
  FSSAI_RE, GSTIN_RE, PAN_RE, UPI_RE, IFSC_RE,
  ComplianceInputError, normalizeField, hasComplianceInput, validateCompliance, fssaiStatus, fssaiDisplayText,
  publicView, privateView, maskPan, maskUpi, isValidYmd, ymdOf,
};
