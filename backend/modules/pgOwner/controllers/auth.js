// ZCS PG Partner accounts ("Plan B", like Auto-Ride drivers): the ZCS team creates the account in the admin
// dashboard with a temporary password and links it to the owner's PG listing(s). The owner signs in with
// phone + password (auth rate limit + accountLockout on the route) and must set an own password first
// (mustChangePassword). A password change bumps tokenVersion: every other session signs out.
const bcrypt = require('bcryptjs');
const { getModel } = require('../index');
const { fail, cleanText, isUuid, MOBILE_RE, ownerHostelIds, hit, auditOwner, isoOf, Op } = require('../services/util');
const { signOwnerToken, suspendedError } = require('../services/auth');
const { OWNER_STATUS } = require('../models');
const S = require('../services/serialize');
const notify = require('../services/notify');
const { normalizePhone } = require('../../../utils/phoneUtils');
const { cleanFcmToken } = require('../../../utils/fcmToken');

const Owner = () => getModel('PgOwner');
// Same bcrypt work for unknown numbers (no timing hint about which numbers have accounts).
let dummy = null;
const dummyHash = () => (dummy || (dummy = bcrypt.hashSync(`no-account-${Date.now()}`, 10)));

/** 8-72 characters with letters and numbers (same rule as the other partner apps). */
const checkPassword = (pw, field = 'password') => {
  const p = typeof pw === 'string' ? pw : '';
  if (p.length < 8 || p.length > 72 || !/[A-Za-z]/.test(p) || !/\d/.test(p)) {
    throw fail(400, 'WEAK_PASSWORD', 'Use a password of 8 to 72 characters with letters and numbers.', { field });
  }
  return p;
};

/** { id, name } of the owner's linked listings, in link order. */
const listingBriefs = async (ownerId) => {
  const ids = await ownerHostelIds(ownerId);
  if (!ids.length) return [];
  const PGHostel = require('../../../models/PGHostel').getPGHostelModel();
  const rows = await PGHostel.findAll({ where: { id: { [Op.in]: ids } }, attributes: ['id', 'name', 'area', 'isActive'] });
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  return ids.map((id) => byId.get(id)).filter(Boolean).map((r) => ({ id: r.id, name: r.name, area: r.area || null, isActive: r.isActive !== false }));
};

// POST /api/pg-owner/auth/login { phone, password }
const login = async (req, res) => {
  const body = req.body || {};
  const phone = normalizePhone(body.phone);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!MOBILE_RE.test(phone) || !password) throw fail(400, 'INVALID_INPUT', 'Enter your mobile number and password.');
  const owner = await Owner().findOne({ where: { phone } });
  const ok = owner ? await bcrypt.compare(password.slice(0, 200), owner.password) : await bcrypt.compare(password.slice(0, 200), dummyHash());
  if (!owner || !ok) throw fail(401, 'INVALID_CREDENTIALS', 'Wrong mobile number or password.');
  if (owner.status === OWNER_STATUS.SUSPENDED) throw suspendedError(owner);
  await owner.update({ lastLoginAt: new Date() });
  res.json({ token: signOwnerToken(owner), owner: S.ownerSelf(owner, await listingBriefs(owner.id)) });
};

// POST /api/pg-owner/auth/refresh   (protectOwner; allowed while the temporary password is still set)
const refresh = async (req, res) => res.json({ token: signOwnerToken(req.owner), owner: S.ownerSelf(req.owner, await listingBriefs(req.owner.id)) });

// GET /api/pg-owner/me
const me = async (req, res) => res.json({ owner: S.ownerSelf(req.owner, await listingBriefs(req.owner.id)) });

// POST /api/pg-owner/auth/password { currentPassword, newPassword }
const changePassword = async (req, res) => {
  const body = req.body || {};
  const o = req.owner;
  if (!(await bcrypt.compare(String(body.currentPassword || '').slice(0, 200), o.password))) {
    throw fail(401, 'INVALID_CREDENTIALS', 'Your current password is wrong.', { field: 'currentPassword' });
  }
  const pw = checkPassword(body.newPassword, 'newPassword');
  if (await bcrypt.compare(pw, o.password)) throw fail(400, 'SAME_PASSWORD', 'Choose a new password, not the one you have now.', { field: 'newPassword' });
  await o.update({ password: await bcrypt.hash(pw, 10), tokenVersion: (Number(o.tokenVersion) || 0) + 1, mustChangePassword: false, passwordChangedAt: new Date() });
  await auditOwner(req, o.id, 'PG_OWNER_PASSWORD_CHANGED', { firstChange: !!body.firstChange });
  res.json({ token: signOwnerToken(o), owner: S.ownerSelf(o, await listingBriefs(o.id)), message: 'Password changed. Other phones were signed out.' });
};

// POST /api/pg-owner/fcm-token { token }  /  POST /fcm-token/remove { token }
const saveFcmToken = async (req, res) => {
  const token = cleanFcmToken((req.body || {}).token);
  if (!token) throw fail(400, 'INVALID_INPUT', 'Invalid device token.', { field: 'token' });
  const o = req.owner;
  const list = (Array.isArray(o.fcmTokens) ? o.fcmTokens : []).filter((t) => t !== token);
  list.push(token);
  await o.update({ fcmTokens: list.slice(-5) });
  // A handed-over phone: the previous owner's pushes (new bookings, complaints) stop ringing on it.
  await require('../../../utils/detachDeviceToken').detachDeviceToken(o.constructor, o.id, token, 'PG_OWNER');
  res.json({ ok: true });
};
const removeFcmToken = async (req, res) => {
  const token = cleanFcmToken((req.body || {}).token);
  const o = req.owner;
  await o.update({ fcmTokens: (Array.isArray(o.fcmTokens) ? o.fcmTokens : []).filter((t) => t !== token) });
  res.json({ ok: true });
};

// GET /api/pg-owner/notifications  /  POST /notifications/read { ids? }
const notifications = async (req, res) => {
  const { getNotificationModel } = require('../../../models/Notification');
  const N = getNotificationModel();
  const rows = await N.findAll({ where: { userId: req.owner.id }, order: [['createdAt', 'DESC']], limit: 100 });
  res.json({
    notifications: rows.map((n) => ({ id: n.id, title: n.title, body: n.body, type: n.type, data: n.data, readAt: isoOf(n.readAt), createdAt: isoOf(n.createdAt) })),
    unread: rows.filter((n) => !n.readAt).length,
  });
};
const markRead = async (req, res) => {
  const { getNotificationModel } = require('../../../models/Notification');
  const N = getNotificationModel();
  const ids = Array.isArray((req.body || {}).ids) ? req.body.ids.filter(isUuid).slice(0, 200) : null;
  const where = { userId: req.owner.id, readAt: null, ...(ids ? { id: { [Op.in]: ids } } : {}) };
  const [n] = await N.update({ readAt: new Date() }, { where });
  res.json({ updated: n });
};

// POST /api/pg-owner/account/deletion-request { password, reason? }  (Google Play account deletion)
// Owner accounts are created by ZCS, so the ZCS team closes them: this records the request (re-checked
// with the password), tells the admins and signs nothing out. The admin page shows it on the owner row.
const requestDeletion = async (req, res) => {
  const o = req.owner;
  hit('deletion_request', o.id);
  const body = req.body || {};
  if (!(await bcrypt.compare(String(body.password || '').slice(0, 200), o.password))) {
    throw fail(401, 'WRONG_PASSWORD', 'That password is wrong.', { field: 'password' });
  }
  const reason = cleanText(body.reason, 300);
  if (!o.deletionRequestedAt) await o.update({ deletionRequestedAt: new Date(), deletionReason: reason || null });
  await auditOwner(req, o.id, 'PG_OWNER_DELETION_REQUESTED', { reason: reason || null });
  notify.admin('pg_owner', 'updated', o.id);
  res.json({
    owner: S.ownerSelf(o, await listingBriefs(o.id)),
    message: 'Request sent. The ZenWe team will confirm it with you and close the account within 7 days. Booking and rent records are kept as the law requires.',
  });
};

module.exports = { login, refresh, me, changePassword, saveFcmToken, removeFcmToken, notifications, markRead, requestDeletion, checkPassword, listingBriefs };
