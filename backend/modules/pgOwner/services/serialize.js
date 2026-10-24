// What the ZCS PG Partner app and the admin page may see. Students appear as FIRST NAME + booking code only:
// never a phone number, email or account id (same rule as Auto-Ride, where drivers never see a passenger's
// phone). Students and owners talk through the ZCS housing desk.
const pgContent = require('../../../utils/pgContent');
const { ymdOf, isoOf, maskPhone } = require('./util');

const bookingCode = (id) => String(id || '').replace(/-/g, '').slice(0, 8).toUpperCase();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

/** The owner's own profile. */
const ownerSelf = (o, listings = []) => ({
  id: o.id,
  name: o.name,
  phone: o.phone,
  email: o.email || null,
  status: o.status,
  mustChangePassword: !!o.mustChangePassword,
  deletionRequestedAt: isoOf(o.deletionRequestedAt),
  listings,
});

/** Owner as admins see it (phone masked in lists; the detail view can show it in full). */
const ownerAdmin = (o, listings = [], { fullPhone = false } = {}) => ({
  id: o.id,
  name: o.name,
  phone: fullPhone ? o.phone : maskPhone(o.phone),
  phoneLast4: String(o.phone || '').slice(-4),
  email: o.email || null,
  status: o.status,
  suspendedReason: o.suspendedReason || null,
  mustChangePassword: !!o.mustChangePassword,
  lastLoginAt: isoOf(o.lastLoginAt),
  passwordChangedAt: isoOf(o.passwordChangedAt),
  deletionRequestedAt: isoOf(o.deletionRequestedAt),
  deletionReason: o.deletionReason || null,
  createdAt: isoOf(o.createdAt),
  listings,
});

const roomLabel = (r) => {
  if (!r) return '';
  const named = r.roomType && String(r.roomType).trim();
  if (named) return named;
  const s = Number(r.sharingType);
  return `${Number.isFinite(s) && s > 0 ? s : 1}-sharing${r.hasAC ? ' AC' : ''}`;
};

const roomForOwner = (r) => ({
  id: r.id,
  roomNumber: r.roomNumber,
  label: roomLabel(r),
  roomTypeKey: pgContent.roomTypeKey(r),
  sharingType: r.sharingType,
  pricePerBed: num(r.pricePerBed),
  totalBeds: Number(r.totalBeds) || 0,
  availableBeds: Number(r.availableBeds) || 0,
  floorNumber: r.floorNumber,
  hasAttachedBathroom: r.hasAttachedBathroom !== false,
  hasAC: !!r.hasAC,
  hasBalcony: !!r.hasBalcony,
  furnishing: r.furnishing || null,
  isActive: r.isActive !== false,
});

/** Total / occupied / vacant beds of active rooms (what the customer app's pills also come from). */
const bedCounts = (rooms) => {
  const active = rooms.filter((r) => r.isActive !== false);
  const total = active.reduce((a, r) => a + (Number(r.totalBeds) || 0), 0);
  const vacant = active.reduce((a, r) => a + Math.max(0, Number(r.availableBeds) || 0), 0);
  return { rooms: active.length, total, vacant, occupied: Math.max(0, total - vacant) };
};

const coverOf = (pg) => {
  const photos = pgContent.photosOf(pg.get ? pg.get({ plain: true }) : pg);
  const c = photos.find((p) => p.isCover) || photos[0];
  return c ? c.url : null;
};

const listingSummary = (pg, rooms = []) => ({
  id: pg.id,
  name: pg.name,
  area: pg.area || null,
  address: pg.address,
  genderType: pg.genderType || 'Co-ed',
  isActive: pg.isActive !== false,
  isVerified: pg.isVerified === true,
  coverPhoto: coverOf(pg),
  beds: bedCounts(rooms),
});

/** A booking as the owner sees it. */
const bookingForOwner = (b, { user = null, room = null, hostel = null } = {}) => ({
  id: b.id,
  code: bookingCode(b.id),
  status: b.status,
  checkInDate: ymdOf(b.checkInDate),
  durationMonths: b.durationMonths === null || b.durationMonths === undefined ? null : Number(b.durationMonths),
  note: b.note || null,
  decisionReason: b.decisionReason || null,
  decidedAt: isoOf(b.decidedAt),
  movedOutAt: isoOf(b.movedOutAt),
  createdAt: isoOf(b.createdAt),
  student: { firstName: pgContent.firstNameOf(user && user.name) },
  room: room ? { id: room.id, roomNumber: room.roomNumber, label: roomLabel(room), sharingType: room.sharingType, pricePerBed: num(room.pricePerBed), hasAttachedBathroom: room.hasAttachedBathroom !== false, hasAC: !!room.hasAC, availableBeds: Number(room.availableBeds) || 0 } : null,
  hostel: hostel ? { id: hostel.id, name: hostel.name } : { id: b.hostelId, name: null },
});

const rentRecord = (r) => ({
  id: r.id,
  bookingId: r.bookingId,
  month: r.month,
  amount: num(r.amount) || 0,
  method: r.method,
  note: r.note || null,
  status: r.status,
  receivedAt: isoOf(r.receivedAt),
  voidedAt: isoOf(r.voidedAt),
  voidReason: r.voidReason || null,
});

const complaintForOwner = (c, hostel = null) => ({
  id: c.id,
  code: bookingCode(c.id),
  hostel: hostel ? { id: hostel.id, name: hostel.name } : { id: c.hostelId, name: null },
  firstName: c.firstName || 'Resident',
  category: c.category,
  text: c.text,
  status: c.status,
  ownerReply: c.ownerReply || null,
  repliedAt: isoOf(c.repliedAt),
  resolvedAt: isoOf(c.resolvedAt),
  createdAt: isoOf(c.createdAt),
});

/** The tenant's own view of a complaint (customer side). */
const complaintForTenant = (c, hostel = null) => ({
  id: c.id,
  hostel: hostel ? { id: hostel.id, name: hostel.name } : { id: c.hostelId, name: null },
  category: c.category,
  text: c.text,
  status: c.status,
  ownerReply: c.ownerReply || null,
  repliedAt: isoOf(c.repliedAt),
  resolvedAt: isoOf(c.resolvedAt),
  createdAt: isoOf(c.createdAt),
});

module.exports = {
  bookingCode, roomLabel, roomForOwner, bedCounts, listingSummary, bookingForOwner, ownerSelf, ownerAdmin,
  rentRecord, complaintForOwner, complaintForTenant,
};
