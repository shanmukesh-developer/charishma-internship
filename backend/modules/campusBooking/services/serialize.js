// What each side sees of a booking. Students: their own bookings, with the stall's UPI details and (once the
// stall accepted) the pickup code. Stalls: their own bookings with the payment proof, NEVER the pickup code
// (the student shows it at the counter and the stall types it in). Admins: everything except the code.
const { STATUS_LABEL, LIMITS, PAID_STATUSES } = require('../enums');
const { rupees } = require('./util');
const { signMediaFields } = require('../../../utils/mediaAccess');

const PROOF_PURPOSES = new Set(['campus_payment']);
const CODE_VISIBLE = new Set(['ACCEPTED', 'PREPARING', 'READY', 'COLLECTED']);
const iso = (d) => (d ? new Date(d).toISOString() : null);

const plainOf = (b) => (b && typeof b.get === 'function' ? b.get({ plain: true }) : { ...b });

/** Stationery bookings: the PDFs to print. `url` is filled only in detail views (signProofs) with a signed link. */
const docsOf = (b) => {
  let list = b.documents;
  if (typeof list === 'string') { try { list = JSON.parse(list); } catch { list = []; } }
  return (Array.isArray(list) ? list : []).filter((d) => d && d.mediaId).map((d) => ({
    id: String(d.mediaId),
    name: String(d.name || 'Document.pdf'),
    size: Number(d.size) || 0,
    url: null,
  }));
};

/** Signed link to one booking PDF (GET /api/campus-booking/documents/:bookingId/:mediaId), valid 60-90 minutes. */
const signedDocUrl = (req, bookingId, mediaId, now = Date.now()) => {
  const mc = require('../../campus/controllers/mediaController');
  const exp = (Math.floor((Math.floor(now / 1000) + 3600) / 1800) + 1) * 1800;
  const base = require('../../../utils/imageStore').publicBase(req);
  return `${base}/api/campus-booking/documents/${bookingId}/${mediaId}?exp=${exp}&sig=${mc.sigFor(`cbdoc.${bookingId}.${mediaId}`, exp)}`;
};

const itemsOf = (b) => (Array.isArray(b.items) ? b.items : []).map((it) => ({
  menuItemId: it.menuItemId ? String(it.menuItemId) : null,
  name: String(it.name || ''),
  unitPrice: Number(it.unitPrice) || 0,
  quantity: Number(it.quantity) || 0,
  lineTotal: Number(it.lineTotal) || 0,
  isVeg: it.isVeg !== false,
}));

/** Pickup progress (board: Payment Verified, Order Accepted, Preparing, Ready for Pickup, Collected). */
const timelineOf = (b) => [
  { key: 'PAYMENT_VERIFIED', label: 'Payment verified', at: iso(b.paymentVerifiedAt) },
  { key: 'ACCEPTED', label: 'Order accepted', at: iso(b.acceptedAt) },
  { key: 'PREPARING', label: 'Preparing your order', at: iso(b.preparingAt) },
  { key: 'READY', label: 'Ready for pickup', at: iso(b.readyAt) },
  { key: 'COLLECTED', label: 'Collected', at: iso(b.collectedAt) },
].map((s) => ({ ...s, done: !!s.at }));

/** upi://pay link the student's UPI app opens (payee, exact amount, booking ref in the note). */
const upiLinkOf = (b) => {
  if (!b.payeeUpiId) return null;
  const q = [
    `pa=${encodeURIComponent(b.payeeUpiId)}`,
    ...(b.payeeName ? [`pn=${encodeURIComponent(b.payeeName)}`] : []),
    `am=${(rupees(b.amountPaise)).toFixed(2)}`,
    'cu=INR',
    `tn=${encodeURIComponent(`ZenWe booking ${b.ref}`)}`,
  ];
  return `upi://pay?${q.join('&')}`;
};

const deadlineOf = (b) => {
  if (b.status === 'PAYMENT_PENDING' && b.createdAt) return iso(new Date(new Date(b.createdAt).getTime() + LIMITS.paymentWindowMin * 60000));
  if (b.status === 'REJECTED' && b.rejectedAt) return iso(new Date(new Date(b.rejectedAt).getTime() + LIMITS.rejectedWindowMin * 60000));
  return null;
};

const base = (b) => ({
  id: String(b.id),
  ref: b.ref,
  // Human order ID from the server-wide ZEN-<n> count (utils/orderNumbers); null until numbered.
  ...require('../../../utils/orderNumbers').fields(b),
  status: b.status,
  statusLabel: STATUS_LABEL[b.status] || b.status,
  items: itemsOf(b),
  itemCount: Number(b.itemCount) || 0,
  amount: rupees(b.amountPaise),
  prepMinutes: Number(b.prepMinutes) || LIMITS.defaultPrepMin,
  estimatedReadyAt: iso(b.estimatedReadyAt),
  timeline: timelineOf(b),
  proof: {
    hasImage: !!b.proofImageUrl,
    imageUrl: b.proofImageUrl || null,
    ref: b.proofRef || null,
    submittedAt: iso(b.proofSubmittedAt),
    attempts: Number(b.proofAttempts) || 0,
    attemptsLeft: Math.max(0, LIMITS.proofMaxAttempts - (Number(b.proofAttempts) || 0)),
  },
  rejection: b.rejectedAt || b.rejectReason ? { code: b.rejectCode || null, reason: b.rejectReason || null, at: iso(b.rejectedAt) } : null,
  cancellation: b.status === 'CANCELLED' ? { by: b.cancelledBy || null, code: b.cancelCode || null, reason: b.cancelReason || null, at: iso(b.cancelledAt) } : null,
  // The stall confirmed the money arrived (shown as "Paid" to the stall; the student was told "Payment verified").
  paymentVerified: !!b.paymentVerifiedAt,
  note: b.note || null,
  documents: docsOf(b),
  createdAt: iso(b.createdAt),
  updatedAt: iso(b.updatedAt),
  paymentVerifiedAt: iso(b.paymentVerifiedAt),
  acceptedAt: iso(b.acceptedAt),
  readyAt: iso(b.readyAt),
  collectedAt: iso(b.collectedAt),
  cancelledAt: iso(b.cancelledAt),
  version: Number(b.version) || 0,
});

const stallBrief = (store) => (store ? {
  id: String(store.id),
  name: store.name,
  location: store.location || null,
  imageUrl: store.imageUrl && !/^data:/i.test(store.imageUrl) ? store.imageUrl : null,
} : null);

/** Student view (own bookings only; the caller checked ownership). */
const forStudent = (row, store) => {
  const b = plainOf(row);
  const out = base(b);
  out.stall = stallBrief(store);
  out.payee = { upiId: b.payeeUpiId || null, name: b.payeeName || null, qrUrl: b.payeeQrUrl || null, upiLink: upiLinkOf(b) };
  out.pickupCode = CODE_VISIBLE.has(b.status) ? b.pickupCode : null;
  out.paymentDeadline = deadlineOf(b);
  out.canSubmitProof = (b.status === 'PAYMENT_PENDING' || b.status === 'REJECTED') && (Number(b.proofAttempts) || 0) < LIMITS.proofMaxAttempts;
  out.canCancel = b.status === 'PAYMENT_PENDING' || b.status === 'REJECTED';
  return out;
};

const firstName = (name) => String(name || '').trim().split(/\s+/)[0].slice(0, 40) || 'Student';

/** Stall view (own stall only). No pickup code, no student phone: first name only. */
const forVendor = (row, user) => {
  const b = plainOf(row);
  const out = base(b);
  out.customer = { firstName: firstName(user && user.name) };
  out.payeeUpiId = b.payeeUpiId || null;
  out.commissionPct = Number(b.commissionPct) || 0;
  out.commission = rupees(b.commissionPaise);
  out.net = rupees(b.vendorNetPaise);
  out.paid = PAID_STATUSES.includes(b.status);
  out.pickupLocked = !!(b.pickupCodeLockedUntil && new Date(b.pickupCodeLockedUntil) > new Date());
  return out;
};

/** Admin view. */
const forAdmin = (row, { user, store } = {}) => {
  const b = plainOf(row);
  const out = base(b);
  out.stall = stallBrief(store);
  out.customer = user ? { id: String(user.id), name: user.name || null, phone: user.phone || null } : { id: String(b.userId) };
  out.payeeUpiId = b.payeeUpiId || null;
  out.commissionPct = Number(b.commissionPct) || 0;
  out.commission = rupees(b.commissionPaise);
  out.net = rupees(b.vendorNetPaise);
  return out;
};

/** Private proof screenshots and print PDFs -> short-lived signed links for the viewer (owner, stall or admin). */
const signProofs = async (req, list) => {
  const all = (Array.isArray(list) ? list : [list]).filter(Boolean);
  await signMediaFields(req, all.map((x) => x.proof), ['imageUrl'], { purposes: PROOF_PURPOSES });
  for (const b of all) for (const d of b.documents || []) d.url = signedDocUrl(req, b.id, d.id);
  return list;
};

module.exports = { forStudent, forVendor, forAdmin, signProofs, timelineOf, upiLinkOf, docsOf, PROOF_PURPOSES, CODE_VISIBLE };
