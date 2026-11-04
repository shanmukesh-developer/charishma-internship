// Shared helpers for the ZCS PG Partner module. Errors, handler, text cleaning and the admin audit row
// are the Auto-Ride ones (same { code, message, ...extra } JSON errors as the other partner apps).
const { Op } = require('sequelize');
const base = require('../../autoRide/services/util');
const { getModel } = require('../index');

const { fail, handler, sendError, cleanText, isUuid, isUniqueError, audit, noStore, maskPhone } = base;

const PHONE_RE = /(?:\+?\d[\s().-]{0,2}){8,}/;
const MOBILE_RE = /^[6-9]\d{9}$/;
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** IST calendar helpers (rent months, move-in dates). */
const istNow = (now = Date.now()) => new Date(now + 330 * 60 * 1000);
const istMonth = (now = Date.now()) => istNow(now).toISOString().slice(0, 7);
const istToday = (now = Date.now()) => istNow(now).toISOString().slice(0, 10);
const ymdOf = (d) => {
  if (!d) return null;
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? null : t.toISOString().slice(0, 10);
};
const isoOf = (d) => {
  if (!d) return null;
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
};
/** 'YYYY-MM' + n months. */
const addMonths = (month, n) => {
  const m = MONTH_RE.exec(month);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};

/** Free text an owner writes for students: no phone numbers (students reach PGs through the ZCS desk). */
const ownerText = (v, max, label, field, { multiline = false, min = 0 } = {}) => {
  if (v !== undefined && v !== null && typeof v !== 'string') throw fail(400, 'INVALID_INPUT', `${label} must be text.`, { field });
  const s = cleanText(v, max + 1, { multiline });
  if (s.length > max) throw fail(400, 'INVALID_INPUT', `${label} must be at most ${max} characters.`, { field });
  if (s.length < min) throw fail(400, 'INVALID_INPUT', min > 1 ? `${label} needs at least ${min} characters.` : `Enter ${label.toLowerCase()}.`, { field });
  if (s && PHONE_RE.test(s)) throw fail(400, 'PHONE_NOT_ALLOWED', 'Phone numbers are not allowed here. Students reach you through the ZenWe housing desk.', { field });
  return s;
};

// ── Per-account write limits (in memory, sliding window; one Render instance) ────────────────────
const LIMITS = {
  owner_write: { max: 300, windowMs: 60 * 60 * 1000, message: 'Too many changes. Please slow down and try again in a while.' },
  owner_upload: { max: 60, windowMs: 60 * 60 * 1000, message: 'Too many photo uploads. Please try again in a while.' },
  complaint: { max: 5, windowMs: 24 * 60 * 60 * 1000, message: 'You have raised several complaints today. The PG will reply to those first.' },
  deletion_request: { max: 3, windowMs: 24 * 60 * 60 * 1000, message: 'Your request was already sent. The ZenWe team will contact you.' },
};
const buckets = new Map();
setInterval(() => {
  const t = Date.now();
  for (const [k, list] of buckets) if (!list.length || t - list[list.length - 1] > 24 * 60 * 60 * 1000) buckets.delete(k);
}, 30 * 60 * 1000).unref?.();
const hit = (kind, id) => {
  const cfg = LIMITS[kind];
  if (!cfg) return;
  const key = `${kind}:${id}`;
  const t = Date.now();
  const list = (buckets.get(key) || []).filter((x) => t - x < cfg.windowMs);
  if (list.length >= cfg.max) {
    buckets.set(key, list);
    const retryAfter = Math.max(1, Math.ceil((cfg.windowMs - (t - list[0])) / 1000));
    throw fail(429, 'RATE_LIMITED', cfg.message, { retryAfter });
  }
  list.push(t);
  buckets.set(key, list);
};
const resetLimits = () => buckets.clear();

// ── Ownership scope ──────────────────────────────────────────────────────────────────────────────
/** Ids of the PG listings linked to this owner. */
const ownerHostelIds = async (ownerId) => {
  const Link = getModel('PgOwnerListing');
  if (!Link || !ownerId) return [];
  const rows = await Link.findAll({ where: { ownerId: String(ownerId) }, attributes: ['hostelId'], order: [['createdAt', 'ASC']] });
  return rows.map((r) => String(r.hostelId));
};
/**
 * The listing when it is linked to this owner. Anything else (another owner's PG, unknown id) is a 404,
 * never a 403, so an owner cannot probe which listings exist.
 */
const ownListing = async (req, hostelId) => {
  const id = String(hostelId || '');
  if (!isUuid(id)) throw fail(404, 'NOT_FOUND', 'PG not found.');
  const ids = req.ownerHostelIds || (req.ownerHostelIds = await ownerHostelIds(req.owner.id));
  if (!ids.includes(id)) throw fail(404, 'NOT_FOUND', 'PG not found.');
  const PGHostel = require('../../../models/PGHostel').getPGHostelModel();
  const pg = await PGHostel.findByPk(id);
  if (!pg) throw fail(404, 'NOT_FOUND', 'PG not found.');
  return pg;
};
/** hostelId query filter limited to the owner's listings (all of them when none / unknown is asked). */
const scopedHostelIds = async (req, asked) => {
  const ids = req.ownerHostelIds || (req.ownerHostelIds = await ownerHostelIds(req.owner.id));
  if (asked && isUuid(String(asked))) return ids.includes(String(asked)) ? [String(asked)] : [];
  return ids;
};

/** Audit row for an owner write (same VerificationLog table as admin writes; adminId = 'pg_owner:<id>'). */
const auditOwner = (req, targetId, action, details) =>
  audit({ user: { id: `pg_owner:${req.owner.id}` } }, targetId, action, details);

/** Every listing change also drops the cached PG list payload and tells live screens to refetch. */
const publishPg = (hostelId, scope) => {
  try { require('../../../utils/responseCache').invalidate('pg_home'); } catch (e) { console.warn('[PG_HOME_CACHE]', e.message); }
  try { require('../../../utils/realtime').publish('pg', 'updated', hostelId, scope ? { scope } : undefined); } catch (e) { console.warn('[PG_OWNER_PUBLISH]', e.message); }
};

module.exports = {
  fail, handler, sendError, cleanText, isUuid, isUniqueError, audit, noStore, maskPhone, Op,
  PHONE_RE, MOBILE_RE, MONTH_RE, istMonth, istToday, ymdOf, isoOf, addMonths, ownerText,
  hit, resetLimits, ownerHostelIds, ownListing, scopedHostelIds, auditOwner, publishPg,
};
