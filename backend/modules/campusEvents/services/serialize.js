// Every Campus Events payload is built here, per viewer (allow-lists only, never a whole row). Privacy:
//  - Nobody but the student and admins sees a registration's payment details.
//  - Organizers see participants as name + registration code + statuses + their answers: never a phone,
//    e-mail, user id or wallet data. Check-in staff see first name + initial, team, code and slot only.
//  - Team rosters go only to the team's accepted members (and the organizer / admin); an invitee sees
//    the team name, the captain's short name and the event. Invitations are visible to invitee + captain.
//  - The QR token is only in the holder's own ticket payload (team ticket: accepted members).
const E = require('../enums');
const { iso, money } = require('./util');
const { labelAnswers } = require('./validate');
const clock = require('./clock');

const R = E.REG_STATUS;

const firstName = (name) => String(name || 'Student').trim().split(/\s+/)[0].slice(0, 30) || 'Student';
const shortName = (name) => {
  const parts = String(name || 'Student').trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : (parts[0] || 'Student')).slice(0, 40);
};

const mediaUrl = (req, p) => {
  if (!p) return null;
  try { return require('../../campus/campusHelpers').publicBase(req) + p; } catch { return p; }
};

const priceBlock = (event, slot) => {
  const { priceFor } = require('./payments');
  const p = priceFor(event, slot);
  return { priceType: event.priceType, isFree: !(p.total > 0), amount: p.amount, extras: p.extras, total: p.total, extraCharges: Array.isArray(event.extraCharges) ? event.extraCharges : [], label: p.total > 0 ? `₹${p.total}` : 'FREE' };
};

const capacityBlock = (event) => {
  if (event.format === E.FORMAT.SLOT) return { kind: 'SLOTS' };
  const cap = event.format === E.FORMAT.TEAM ? Number(event.maxTeams) || 0 : Number(event.capacity) || 0;
  const left = Math.max(0, cap - (Number(event.unitsLive) || 0));
  return { kind: event.format === E.FORMAT.TEAM ? 'TEAMS' : 'SEATS', capacity: cap, confirmed: Number(event.unitsConfirmed) || 0, remaining: left, waitlistCount: Number(event.waitlistCount) || 0 };
};

/** OPEN | NOT_OPEN | CLOSED | FULL | CANCELLED | COMPLETED */
const registrationState = (event, { slotsLeft } = {}) => {
  const now = clock.nowMs();
  if (event.status === E.EVENT_STATUS.CANCELLED) return 'CANCELLED';
  if (event.status === E.EVENT_STATUS.COMPLETED || (event.endAt && new Date(event.endAt).getTime() <= now)) return 'COMPLETED';
  if (event.regOpensAt && new Date(event.regOpensAt).getTime() > now) return 'NOT_OPEN';
  if ((event.regClosesAt && new Date(event.regClosesAt).getTime() <= now) || (event.startAt && new Date(event.startAt).getTime() <= now && event.format !== E.FORMAT.SLOT)) return 'CLOSED';
  if (event.format === E.FORMAT.SLOT) return slotsLeft === 0 ? 'FULL' : 'OPEN';
  const c = capacityBlock(event);
  return c.remaining > 0 ? 'OPEN' : 'FULL';
};

const organizerBlock = (org, entity) => ({
  name: (entity && entity.name) || (org && org.displayName) || 'Campus organizer',
  club: entity ? { id: entity.id, name: entity.name, type: entity.type, verified: !!entity.verified } : null,
});

const eventCard = (req, ev, { org, entity, mine, slotsLeft } = {}) => ({
  id: ev.id,
  title: ev.title,
  category: ev.category,
  categoryLabel: E.CATEGORY_LABELS[ev.category] || ev.category,
  tags: Array.isArray(ev.tags) ? ev.tags : [],
  posterUrl: mediaUrl(req, ev.posterPath),
  organizer: organizerBlock(org, entity),
  startAt: iso(ev.startAt),
  endAt: iso(ev.endAt),
  venue: ev.venue,
  format: ev.format,
  isTeam: ev.format === E.FORMAT.TEAM,
  price: priceBlock(ev, null),
  regOpensAt: iso(ev.regOpensAt),
  regClosesAt: iso(ev.regClosesAt),
  capacity: capacityBlock(ev),
  ...(ev.format === E.FORMAT.SLOT ? { slotsAvailable: slotsLeft === undefined ? null : slotsLeft } : {}),
  registrationState: registrationState(ev, { slotsLeft }),
  featured: !!ev.featured,
  publishedAt: iso(ev.publishedAt),
  myStatus: mine ? mine.status : null,
});

const slotPublic = (event, s) => {
  const cap = Number(s.capacity) || 0;
  const now = clock.nowMs();
  const remaining = Math.max(0, cap - (Number(s.unitsLive) || 0));
  let state = 'OPEN';
  if (s.status !== 'OPEN') state = 'CANCELLED';
  else if (new Date(s.startAt).getTime() <= now) state = 'STARTED';
  else if (remaining === 0) state = 'FULL';
  return {
    id: s.id, label: s.label, startAt: iso(s.startAt), endAt: iso(s.endAt), durationMinutes: Math.round((new Date(s.endAt) - new Date(s.startAt)) / 60000),
    capacity: cap, confirmed: Number(s.unitsConfirmed) || 0, remaining, waitlistCount: Number(s.waitlistCount) || 0, price: priceBlock(event, s), state,
  };
};

const questionsPublic = (qs) => (Array.isArray(qs) ? qs.map((q) => ({ id: q.id, label: q.label, type: q.type, required: !!q.required, ...(q.options ? { options: q.options } : {}), ...(q.maxLength ? { maxLength: q.maxLength } : {}) })) : []);

const eventDetail = (req, ev, extra = {}) => ({
  ...eventCard(req, ev, extra),
  description: ev.description,
  gallery: (Array.isArray(ev.gallery) ? ev.gallery : []).map((p) => mediaUrl(req, p)),
  venueDirections: ev.venueDirections,
  venueLat: ev.venueLat, venueLon: ev.venueLon,
  eligibility: ev.eligibility || {},
  rules: ev.rules || '',
  rulesVersion: Number(ev.rulesVersion) || 1,
  questions: questionsPublic(ev.questions),
  equipment: ev.equipment,
  contactText: ev.contactText,
  instructions: ev.instructions,
  cancellationPolicy: ev.cancellationPolicy || {},
  team: ev.format === E.FORMAT.TEAM ? {
    min: ev.teamMin, max: ev.teamMax, maxTeams: ev.maxTeams, captainRequired: !!ev.captainRequired, allowSubstitutions: !!ev.allowSubstitutions,
    multiTeamAllowed: !!ev.multiTeamAllowed, attendancePerMember: !!ev.attendancePerMember,
  } : null,
  maxBookingsPerStudent: Number(ev.maxBookingsPerStudent) || 1,
  approvalRequired: !!ev.approvalRequired,
  waitlistEnabled: !!ev.waitlistEnabled,
  // null = the platform default (settings.waitlistOfferMinutes) / no minimum.
  waitlistOfferMinutes: ev.waitlistOfferMinutes === null || ev.waitlistOfferMinutes === undefined ? null : Number(ev.waitlistOfferMinutes),
  minParticipants: ev.minParticipants === null || ev.minParticipants === undefined ? null : Number(ev.minParticipants),
  paymentModes: extra.paymentModes || [],
  entryOpensBeforeMin: Number(ev.entryOpensBeforeMin) || 0,
  status: ev.status,
  ...(extra.cta ? { cta: extra.cta } : {}),
  ...(extra.eligibilityReasons ? { eligibilityReasons: extra.eligibilityReasons } : {}),
  ...(extra.myRegistration ? { myRegistration: extra.myRegistration } : {}),
  ...(extra.myTeam ? { myTeam: extra.myTeam } : {}),
});

const paymentBlock = (reg) => ({
  mode: reg.paymentMode, status: reg.paymentStatus, amount: money(reg.amount), extras: money(reg.extras), total: money(reg.total),
  paidAt: iso(reg.paidAt), refundAmount: money(reg.refundAmount), refundedAt: iso(reg.refundedAt),
  ...(reg.status === R.PENDING_PAYMENT ? { payBy: iso(reg.paymentExpiresAt) } : {}),
});

const ticketBrief = (t) => (t ? { id: t.id, kind: t.kind, status: t.status, ticketCode: t.ticketCode, usedAt: iso(t.usedAt) } : null);

/** The student's own registration (or a team member's view of the team registration). */
const registrationOwn = (req, reg, { event, slot, team, tickets = [], viewerId, canCancel, cancelUntil } = {}) => ({
  id: reg.id,
  code: reg.code,
  type: reg.type,
  status: reg.status,
  event: event ? { id: event.id, title: event.title, startAt: iso(event.startAt), endAt: iso(event.endAt), venue: event.venue, posterUrl: mediaUrl(req, event.posterPath), status: event.status, format: event.format } : null,
  slot: slot ? { id: slot.id, label: slot.label, startAt: iso(slot.startAt), endAt: iso(slot.endAt) } : null,
  team: team ? { id: team.id, name: team.name, isCaptain: String(team.captainUserId) === String(viewerId) } : null,
  isOwner: String(reg.userId) === String(viewerId),
  // Payment details: the registrant (team: the captain who registered) only.
  ...(String(reg.userId) === String(viewerId) ? { payment: paymentBlock(reg) } : {}),
  holdExpiresAt: reg.status === R.HELD ? iso(reg.holdExpiresAt) : null,
  offerExpiresAt: reg.status === R.OFFERED ? iso(reg.offerExpiresAt) : null,
  waitlistAt: iso(reg.waitlistAt),
  confirmedAt: iso(reg.confirmedAt),
  cancelledAt: iso(reg.cancelledAt),
  cancelReason: reg.cancelReason,
  rejectedReason: reg.rejectedReason,
  answers: String(reg.userId) === String(viewerId) ? reg.answers || {} : undefined,
  answerDetails: String(reg.userId) === String(viewerId) ? labelAnswers(reg.answers, reg.questionsSnapshot, event && event.questions) : undefined,
  tickets: tickets.map(ticketBrief),
  ticketStatus: tickets.length ? (tickets.some((t) => t.status === E.TICKET_STATUS.ACTIVE) ? 'AVAILABLE' : tickets[0].status) : (reg.status === R.CONFIRMED ? 'ISSUING' : 'NOT_ISSUED'),
  canCancel: !!canCancel,
  cancelUntil: cancelUntil || null,
  createdAt: iso(reg.createdAt),
});

/** Organizer / admin participant row (no phone / e-mail / user id for organizers). */
const registrationForOrganizer = (reg, { user, team, ticket, forAdmin = false, eventQuestions = null } = {}) => ({
  id: reg.id,
  code: reg.code,
  type: reg.type,
  status: reg.status,
  name: user ? String(user.name || 'Student').slice(0, 80) : 'Student',
  ...(forAdmin ? { userId: reg.userId } : {}),
  team: team ? { id: team.id, name: team.name } : null,
  slotId: reg.slotId,
  unitNo: reg.unitNo,
  answers: reg.answers || {},
  answerDetails: labelAnswers(reg.answers, reg.questionsSnapshot, eventQuestions),
  paymentMode: reg.paymentMode,
  paymentStatus: reg.paymentStatus,
  total: money(reg.total),
  ticket: ticketBrief(ticket),
  waitlistAt: iso(reg.waitlistAt),
  createdAt: iso(reg.createdAt),
  confirmedAt: iso(reg.confirmedAt),
  cancelledAt: iso(reg.cancelledAt),
});

const ticketOwn = (req, t, { event, slot, reg, team, holderName, token } = {}) => ({
  id: t.id,
  kind: t.kind,
  status: t.status,
  ticketCode: t.ticketCode,
  qrToken: t.status === E.TICKET_STATUS.ACTIVE ? token : null,
  holder: t.kind === E.TICKET_KIND.TEAM ? (team ? team.name : 'Team') : shortName(holderName),
  event: event ? { id: event.id, title: event.title, startAt: iso(event.startAt), endAt: iso(event.endAt), venue: event.venue, posterUrl: mediaUrl(req, event.posterPath), instructions: event.instructions, entryOpensBeforeMin: Number(event.entryOpensBeforeMin) || 0 } : null,
  slot: slot ? { id: slot.id, label: slot.label, startAt: iso(slot.startAt), endAt: iso(slot.endAt) } : null,
  registration: reg ? { id: reg.id, code: reg.code, status: reg.status, paymentDue: reg.paymentStatus === E.PAYMENT_STATUS.DUE_AT_VENUE, total: money(reg.total) } : null,
  team: team ? { id: team.id, name: team.name } : null,
  usedAt: iso(t.usedAt),
  entryNote: 'Show this QR or the ticket code at the entry. A cancelled, unpaid or invalid ticket is not admitted.',
});

const memberRow = (m, user, { forMember }) => ({
  id: m.id,
  role: m.role,
  status: m.status,
  name: forMember ? String((user && user.name) || 'Student').slice(0, 80) : shortName(user && user.name),
  avatarUrl: forMember && user ? user.profileImage || null : null,
  isMe: false,
  invitedAt: iso(m.invitedAt),
  respondedAt: iso(m.respondedAt),
});

/** Full team view for accepted members (+ captain-only extras). */
const teamForMember = (team, { members = [], users = new Map(), viewerId, event, registration } = {}) => ({
  id: team.id,
  name: team.name,
  status: team.status,
  rosterVersion: Number(team.rosterVersion) || 1,
  isCaptain: String(team.captainUserId) === String(viewerId),
  event: event ? { id: event.id, title: event.title, startAt: iso(event.startAt), teamMin: event.teamMin, teamMax: event.teamMax, allowSubstitutions: !!event.allowSubstitutions } : null,
  members: members
    .filter((m) => [E.MEMBER_STATUS.ACCEPTED, E.MEMBER_STATUS.INVITED].includes(m.status) && (m.status === E.MEMBER_STATUS.ACCEPTED || String(team.captainUserId) === String(viewerId)))
    .map((m) => ({ ...memberRow(m, users.get(String(m.userId)), { forMember: true }), isMe: String(m.userId) === String(viewerId) })),
  acceptedCount: members.filter((m) => m.status === E.MEMBER_STATUS.ACCEPTED).length,
  registration: registration ? { id: registration.id, code: registration.code, status: registration.status } : null,
  joinLinkActive: String(team.captainUserId) === String(viewerId) ? !!(team.joinTokenHash && team.joinTokenExpiresAt && new Date(team.joinTokenExpiresAt).getTime() > clock.nowMs()) : undefined,
});

const invitationView = (m, { team, event, captain }) => ({
  id: m.id,
  status: m.status,
  expiresAt: iso(m.expiresAt),
  invitedAt: iso(m.invitedAt),
  team: team ? { id: team.id, name: team.name, captain: shortName(captain && captain.name) } : null,
  event: event ? { id: event.id, title: event.title, startAt: iso(event.startAt), venue: event.venue, category: event.category } : null,
});

/** Check-in staff view (minimum needed at the gate). */
const staffView = (t, { reg, team, slot, holderName, event }) => (t ? {
  ticketId: t.id,
  ticketCode: t.ticketCode,
  kind: t.kind,
  holder: t.kind === E.TICKET_KIND.TEAM ? null : shortName(holderName),
  team: team ? team.name : null,
  slot: slot ? { label: slot.label, startAt: iso(slot.startAt), endAt: iso(slot.endAt) } : null,
  event: event ? { id: event.id, title: event.title } : null,
  registrationCode: reg ? reg.code : null,
  paymentDue: reg && reg.paymentStatus === E.PAYMENT_STATUS.DUE_AT_VENUE ? money(reg.total) : 0,
  usedAt: iso(t.usedAt),
} : null);

const organizerOwn = (o) => (o ? {
  id: o.id, status: o.status, displayName: o.displayName, entityId: o.entityId, campusId: o.campusId, reviewNote: o.reviewNote, grantedAt: iso(o.grantedAt), createdAt: iso(o.createdAt),
} : null);

/** Organizer's own event (all editable fields + review state + counters). */
const eventOrganizer = (req, ev, extra = {}) => ({
  ...eventDetail(req, ev, extra),
  status: ev.status,
  publishAt: iso(ev.publishAt),
  submittedAt: iso(ev.submittedAt),
  reviewedAt: iso(ev.reviewedAt),
  reviewNote: ev.reviewNote,
  rejectionReason: ev.rejectionReason,
  pendingChanges: ev.pendingChanges || null,
  cancelReason: ev.cancelReason,
  counters: { unitsLive: ev.unitsLive || 0, confirmed: ev.unitsConfirmed || 0, waitlist: ev.waitlistCount || 0, checkedIn: ev.checkedInCount || 0 },
  posterPath: ev.posterPath,
  galleryPaths: Array.isArray(ev.gallery) ? ev.gallery : [],
  price: priceBlock(ev, null),
  rawPrice: money(ev.price),
  capacityRaw: ev.capacity,
  paymentModesConfigured: Array.isArray(ev.paymentModes) ? ev.paymentModes : [],
  version: ev.version,
  createdAt: iso(ev.createdAt),
  updatedAt: iso(ev.updatedAt),
});

const eventAdmin = (req, ev, extra = {}) => ({
  ...eventOrganizer(req, ev, extra),
  campusId: ev.campusId,
  organizerUserId: ev.organizerUserId,
  entityId: ev.entityId,
  featured: !!ev.featured,
  cancelledAt: iso(ev.cancelledAt),
  completedAt: iso(ev.completedAt),
});

module.exports = {
  firstName, shortName, mediaUrl, priceBlock, capacityBlock, registrationState, eventCard, eventDetail, slotPublic, questionsPublic,
  registrationOwn, registrationForOrganizer, ticketOwn, ticketBrief, teamForMember, invitationView, staffView, organizerOwn, eventOrganizer,
  eventAdmin, paymentBlock, memberRow,
};
