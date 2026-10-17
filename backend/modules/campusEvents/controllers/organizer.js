// Organizer side (/api/campus-events/organizer). Only users with an ACTIVE CeOrganizer row (granted by an
// admin; students can apply) can create events; ordinary students get 403 NOT_ORGANIZER. Drafts work
// while the feature is off; submitting for review needs CAMPUS_EVENTS_ENABLED. Organizers see their own
// events and participants (name + code + statuses + answers; never phones / e-mails / payment details).
const { Op } = require('sequelize');
const E = require('../enums');
const { fail, assertUuid, cleanText, hit, iso, num, parseTime, money } = require('../services/util');
const S = require('../services/serialize');
const clock = require('../services/clock');
const cap = require('../services/capacity');
const elig = require('../services/eligibility');
const flag = require('../services/flag');
const EV = require('../services/events');
const notify = require('../services/notify');
const outcomes = require('../services/outcomes');
const audit = require('../services/audit');
const { M, loadEvent, usersById, byIds, organizerContext, Entity, staffRole } = require('./common');

const OS = E.ORGANIZER_STATUS;
const R = E.REG_STATUS;
const N = E.NOTIFY;

/** Middleware: ACTIVE organizer (req.ce.organizer). */
const requireOrganizer = async (req, res, next) => {
  try {
    const o = await M().Organizer.findOne({ where: { userId: req.user.id } });
    if (!o || o.status !== OS.ACTIVE) throw fail(403, 'NOT_ORGANIZER', o && o.status === OS.SUSPENDED ? 'Your organizer access is suspended.' : 'Only verified clubs and authorised student organizers can publish events. Apply from the Campus Events page.', { organizerStatus: o ? o.status : null });
    req.ce = { organizer: o };
    return next();
  } catch (err) {
    return require('../services/util').sendError(res, err, 'CAMPUS_EVENTS_ORGANIZER');
  }
};

const ownEvent = async (req) => {
  const ev = await loadEvent(req.params.id);
  if (String(ev.organizerUserId) !== String(req.user.id)) throw fail(404, 'NOT_FOUND', 'This event was not found.');
  return ev;
};

const eventOut = async (req, ev) => {
  const ctx = await organizerContext([ev]);
  return S.eventOrganizer(req, ev, { ...ctx(ev), paymentModes: await require('../services/payments').enabledModes(ev) });
};

// GET /me
const me = async (req, res) => {
  const o = await M().Organizer.findOne({ where: { userId: req.user.id } });
  const ctx = await elig.loadContext(req.user.id);
  const ent = Entity();
  let clubs = [];
  if (ent && ctx.campusId) {
    const rows = await ent.findAll({ where: { campusId: ctx.campusId, verified: true }, attributes: ['id', 'name', 'type', 'managerIds', 'status'], limit: 500 });
    clubs = rows.filter((r) => r.status !== 'suspended' && (Array.isArray(r.managerIds) ? r.managerIds : []).map(String).includes(String(req.user.id))).map((r) => ({ id: r.id, name: r.name, type: r.type }));
  }
  res.json({ organizer: S.organizerOwn(o), canApply: (!o || [OS.REJECTED, OS.REVOKED].includes(o.status)) && ctx.eligible, eligibilityReasons: ctx.reasons, managedClubs: clubs });
};

// POST /apply   { displayName, entityId?, note, proofText? }
const apply = async (req, res) => {
  hit('apply', req.user.id);
  const ctx = await elig.loadContext(req.user.id);
  elig.assertEligible(ctx);
  const b = req.body || {};
  const displayName = cleanText(b.displayName, 80);
  if (displayName.length < 2) throw fail(400, 'INVALID_INPUT', 'Tell us the club or organizer name.', { field: 'displayName' });
  let entityId = null;
  if (b.entityId) {
    entityId = assertUuid(b.entityId, 'club');
    const ent = Entity();
    const row = ent ? await ent.findByPk(entityId) : null;
    if (!row || !row.verified || String(row.campusId) !== String(ctx.campusId)) throw fail(400, 'INVALID_INPUT', 'Pick a verified club of your campus.', { field: 'entityId' });
  }
  const existing = await M().Organizer.findOne({ where: { userId: req.user.id } });
  if (existing && [OS.PENDING, OS.ACTIVE, OS.SUSPENDED].includes(existing.status)) throw fail(409, 'ALREADY_APPLIED', existing.status === OS.ACTIVE ? 'You are already an organizer.' : 'Your application is already with the Zenvy team.', { status: existing.status });
  const fields = { campusId: ctx.campusId, entityId, displayName, status: OS.PENDING, applicationNote: cleanText(b.note, 1000, { multiline: true }), proofText: cleanText(b.proofText, 500), reviewNote: null };
  const o = existing ? await existing.update(fields) : await M().Organizer.create({ userId: req.user.id, ...fields });
  await audit.fromReq(req, { action: 'organizer.apply', details: { organizerId: o.id } }, null, 'user');
  notify.admin('created', o.id);
  res.status(201).json({ organizer: S.organizerOwn(o) });
};

// GET /events?status=
const listEvents = async (req, res) => {
  const where = { organizerUserId: req.user.id };
  if (req.query.status) where.status = String(req.query.status).toUpperCase();
  const rows = await M().Event.findAll({ where, order: [['startAt', 'DESC'], ['createdAt', 'DESC']], limit: 200 });
  const out = [];
  for (const ev of rows) out.push(await eventOut(req, ev));
  res.json({ events: out });
};

// POST /events   (DRAFT)
const createEvent = async (req, res) => {
  hit('organizer_write', req.user.id);
  const o = req.ce.organizer;
  const ctx = await elig.loadContext(req.user.id);
  if (!ctx.campusId) throw fail(403, 'VERIFICATION_REQUIRED', elig.REASON_MESSAGES.CAMPUS_REQUIRED);
  const b = req.body || {};
  const fields = await EV.cleanFields(req.user.id, b, null);
  if (!fields.title) throw fail(400, 'INVALID_INPUT', 'Give the event a title (3+ characters).', { field: 'title' });
  let entityId = o.entityId || null;
  if (b.entityId) {
    entityId = assertUuid(b.entityId, 'club');
    const ent = Entity();
    const row = ent ? await ent.findByPk(entityId) : null;
    const managers = row && Array.isArray(row.managerIds) ? row.managerIds.map(String) : [];
    if (!row || !row.verified || (!managers.includes(String(req.user.id)) && String(o.entityId) !== String(entityId))) throw fail(403, 'NOT_CLUB_MANAGER', 'You can only publish for a verified club you manage.', { field: 'entityId' });
  }
  const s = await flag.readSettings();
  const defaults = { format: E.FORMAT.INDIVIDUAL, category: 'OTHER', priceType: E.PRICE_TYPE.FREE, entryOpensBeforeMin: s.entryOpensBeforeMin, waitlistEnabled: true, maxBookingsPerStudent: 1, paymentModes: [E.PAYMENT_MODE.VENUE] };
  const ev = { ...defaults, ...fields };
  require('../services/validate').checkEventShape(ev);
  const row = await M().Event.create({ ...ev, campusId: ctx.campusId, organizerUserId: req.user.id, organizerId: o.id, entityId, status: E.EVENT_STATUS.DRAFT, slug: EV.slugify(ev.title), version: 1, rulesVersion: 1 });
  await audit.fromReq(req, { eventId: row.id, action: 'event.create', details: {} }, null, 'organizer');
  res.status(201).json({ event: await eventOut(req, row) });
};

// GET /events/:id
const getEvent = async (req, res) => res.json({ event: await eventOut(req, await ownEvent(req)) });

// PATCH /events/:id
const updateEvent = async (req, res) => {
  hit('organizer_write', req.user.id);
  const ev = await ownEvent(req);
  const r = await EV.organizerEdit(req, ev, req.body || {});
  res.json({ event: await eventOut(req, await M().Event.findByPk(ev.id)), pendingReview: r.pending });
};

// DELETE /events/:id   (drafts with no registrations only)
const deleteEvent = async (req, res) => {
  const ev = await ownEvent(req);
  if (ev.status !== E.EVENT_STATUS.DRAFT) throw fail(409, 'NOT_DRAFT', 'Only drafts can be deleted. Cancel a published event instead.');
  if (await M().Reg.count({ where: { eventId: ev.id } })) throw fail(409, 'HAS_REGISTRATIONS', 'This event has registrations.');
  await M().Slot.destroy({ where: { eventId: ev.id } });
  await ev.destroy();
  await audit.fromReq(req, { eventId: ev.id, action: 'event.delete_draft', details: {} }, null, 'organizer');
  res.json({ ok: true });
};

// POST /events/:id/submit
const submit = async (req, res) => {
  const ev = await ownEvent(req);
  await EV.submit(req, ev);
  res.json({ event: await eventOut(req, ev) });
};

// POST /events/:id/withdraw   (SUBMITTED -> DRAFT)
const withdraw = async (req, res) => {
  const ev = await ownEvent(req);
  if (ev.status !== E.EVENT_STATUS.SUBMITTED) throw fail(409, 'NOT_SUBMITTED', 'Only events waiting for review can be withdrawn.');
  await ev.update({ status: E.EVENT_STATUS.DRAFT });
  await audit.fromReq(req, { eventId: ev.id, action: 'event.withdraw', details: {} }, null, 'organizer');
  notify.admin('updated', ev.id);
  res.json({ event: await eventOut(req, ev) });
};

// POST /events/:id/cancel   { reason }
const cancelEvent = async (req, res) => {
  const ev = await ownEvent(req);
  if (E.EDITABLE_EVENT_STATUSES.includes(ev.status) || ev.status === E.EVENT_STATUS.SUBMITTED) {
    await ev.update({ status: E.EVENT_STATUS.CANCELLED, cancelledAt: clock.now(), cancelledBy: req.user.id, cancelReason: cleanText(req.body && req.body.reason, 500) || 'Cancelled by the organizer' });
    await audit.fromReq(req, { eventId: ev.id, action: 'event.cancel', details: { by: 'organizer', draft: true } }, null, 'organizer');
    return res.json({ event: await eventOut(req, ev) });
  }
  const out = await EV.cancelEvent(req, ev.id, { by: 'organizer', reason: req.body && req.body.reason });
  res.json({ event: await eventOut(req, out) });
};

// ── Slots ────────────────────────────────────────────────────────────────────
const slotInput = (b, current) => {
  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(b || {}, k);
  if (has('label')) out.label = cleanText(b.label, 80);
  if (has('startAt') || !current) out.startAt = parseTime(b.startAt, 'startAt');
  if (has('endAt') || !current) out.endAt = parseTime(b.endAt, 'endAt');
  if (has('capacity') || !current) out.capacity = num(b.capacity, { min: 1, max: 1000, int: true, field: 'capacity' });
  if (!current && !out.capacity) throw fail(400, 'INVALID_INPUT', 'Set the slot capacity.', { field: 'capacity' });
  if (has('price')) out.price = b.price === null || b.price === '' ? null : num(b.price, { min: 0, max: 100000, field: 'price' });
  const start = out.startAt || (current && current.startAt);
  const end = out.endAt || (current && current.endAt);
  if (new Date(end).getTime() <= new Date(start).getTime()) throw fail(400, 'INVALID_INPUT', 'A slot must end after it starts.', { field: 'endAt' });
  return out;
};

const assertSlotEditable = (ev) => {
  if (ev.format !== E.FORMAT.SLOT) throw fail(400, 'NOT_SLOT_EVENT', 'Slots are only for slot-booking activities.');
  if ([E.EVENT_STATUS.CANCELLED, E.EVENT_STATUS.COMPLETED, E.EVENT_STATUS.SUBMITTED].includes(ev.status)) throw fail(409, ev.status === E.EVENT_STATUS.SUBMITTED ? 'EVENT_UNDER_REVIEW' : 'EVENT_CLOSED', ev.status === E.EVENT_STATUS.SUBMITTED ? 'Withdraw the event from review to change slots.' : 'This event is closed.');
};

// GET /events/:id/slots
const listSlots = async (req, res) => {
  const ev = await ownEvent(req);
  const rows = await M().Slot.findAll({ where: { eventId: ev.id }, order: [['startAt', 'ASC']] });
  res.json({ slots: rows.map((s) => ({ ...S.slotPublic(ev, s), status: s.status })) });
};

// POST /events/:id/slots   { label?, startAt, endAt, capacity, price? }   (body.slots: [..] for many)
const createSlots = async (req, res) => {
  hit('organizer_write', req.user.id);
  const ev = await ownEvent(req);
  assertSlotEditable(ev);
  const list = Array.isArray(req.body && req.body.slots) ? req.body.slots : [req.body || {}];
  if (!list.length || list.length > 100) throw fail(400, 'INVALID_INPUT', 'Send 1 to 100 slots.', { field: 'slots' });
  const clean = list.map((b) => slotInput(b, null));
  for (const s of clean) {
    if (ev.startAt && new Date(s.startAt).getTime() < new Date(ev.startAt).getTime() - 60 * 1000) throw fail(400, 'INVALID_INPUT', 'Slots must be within the event dates.', { field: 'startAt' });
    if (ev.endAt && new Date(s.endAt).getTime() > new Date(ev.endAt).getTime() + 60 * 1000) throw fail(400, 'INVALID_INPUT', 'Slots must be within the event dates.', { field: 'endAt' });
  }
  const rows = [];
  for (const s of clean) rows.push(await M().Slot.create({ ...s, eventId: ev.id, status: 'OPEN' }));
  await audit.fromReq(req, { eventId: ev.id, action: 'slot.create', details: { count: rows.length } }, null, 'organizer');
  notify.eventChanged(ev.id);
  res.status(201).json({ slots: rows.map((s) => S.slotPublic(ev, s)) });
};

// PATCH /events/:id/slots/:slotId
const updateSlot = async (req, res) => {
  hit('organizer_write', req.user.id);
  const ev0 = await ownEvent(req);
  assertSlotEditable(ev0);
  const slotId = assertUuid(req.params.slotId, 'slot');
  let timeChanged = false;
  const out = await cap.inLock(ev0.id, async (t, ev) => {
    const slot = await M().Slot.findByPk(slotId, { transaction: t });
    if (!slot || String(slot.eventId) !== String(ev.id) || slot.status !== 'OPEN') throw fail(404, 'NOT_FOUND', 'This slot was not found.');
    const changes = slotInput(req.body || {}, slot);
    if (changes.capacity !== undefined && changes.capacity < (Number(slot.unitsLive) || 0)) throw fail(409, 'CAPACITY_BELOW_TAKEN', `This slot already has ${slot.unitsLive} bookings.`, { field: 'capacity' });
    if (changes.price !== undefined && (Number(slot.unitsLive) || 0) + (Number(slot.waitlistCount) || 0) > 0) throw fail(409, 'HAS_REGISTRATIONS', 'The price cannot change once the slot has bookings.', { field: 'price' });
    timeChanged = ['startAt', 'endAt'].some((k) => changes[k] && new Date(changes[k]).getTime() !== new Date(slot[k]).getTime());
    await slot.update(changes, { transaction: t });
    const promoted = await cap.promote(ev, slot.id, t);
    await audit.fromReq(req, { eventId: ev.id, action: 'slot.edit', details: { slotId: slot.id, fields: Object.keys(changes) } }, t, 'organizer');
    return { slot, promoted };
  });
  outcomes.promoted(out.promoted, out.event);
  if (timeChanged) notify.eventBroadcast(out.event, { title: 'Slot time changed 🕒', body: `Your slot for ${out.event.title} has a new time. Open your booking for details.`, type: N.SLOT_CHANGED, slotId: out.slot.id, dedupe: String(out.slot.updatedAt && new Date(out.slot.updatedAt).getTime()) });
  res.json({ slot: S.slotPublic(out.event, out.slot) });
};

// POST /events/:id/slots/:slotId/cancel   { reason? }
const cancelSlot = async (req, res) => {
  const ev = await ownEvent(req);
  assertSlotEditable(ev);
  const slot = await EV.cancelSlot(req, ev.id, assertUuid(req.params.slotId, 'slot'), { by: 'organizer', reason: cleanText(req.body && req.body.reason, 300) });
  res.json({ slot: { id: slot.id, status: slot.status } });
};

// ── Participants ─────────────────────────────────────────────────────────────
const participantRows = async (ev, query, { forAdmin = false } = {}) => {
  const where = { eventId: ev.id };
  if (query.status) where.status = String(query.status).toUpperCase();
  if (query.slotId) where.slotId = String(query.slotId);
  const rows = await M().Reg.findAll({ where, order: [['createdAt', 'ASC']], limit: 2000 });
  const users = await usersById(rows.map((r) => r.userId));
  const teams = await byIds(M().Team, rows.map((r) => r.teamId));
  const tks = rows.length ? await M().Ticket.findAll({ where: { registrationId: { [Op.in]: rows.map((r) => r.id) }, holderKey: { [Op.in]: ['TEAM', ...rows.map((r) => String(r.userId))] } } }) : [];
  const tByReg = new Map();
  for (const tk of tks) if (!tByReg.has(String(tk.registrationId)) || tk.status === E.TICKET_STATUS.USED || tk.status === E.TICKET_STATUS.ACTIVE) tByReg.set(String(tk.registrationId), tk);
  return rows.map((r) => S.registrationForOrganizer(r, { user: users.get(String(r.userId)), team: teams.get(String(r.teamId)), ticket: tByReg.get(String(r.id)), forAdmin, eventQuestions: ev.questions }));
};

// GET /events/:id/registrations?status&slotId
const registrations = async (req, res) => {
  const ev = await ownEvent(req);
  res.json({ registrations: await participantRows(ev, req.query || {}), questions: S.questionsPublic(ev.questions) });
};

// GET /events/:id/teams   (organizer: rosters of registered teams)
const teams = async (req, res) => {
  const ev = await ownEvent(req);
  const rows = await M().Team.findAll({ where: { eventId: ev.id, status: { [Op.ne]: E.TEAM_STATUS.CANCELLED } }, order: [['createdAt', 'ASC']] });
  const members = rows.length ? await M().Member.findAll({ where: { teamId: { [Op.in]: rows.map((r) => r.id) }, status: E.MEMBER_STATUS.ACCEPTED } }) : [];
  const users = await usersById(members.map((m) => m.userId));
  res.json({
    teams: rows.map((tm) => ({
      id: tm.id, name: tm.name, status: tm.status, rosterVersion: tm.rosterVersion, registrationId: tm.registrationId,
      members: members.filter((m) => String(m.teamId) === String(tm.id)).map((m) => ({ id: m.id, role: m.role, name: String((users.get(String(m.userId)) || {}).name || 'Student').slice(0, 80) })),
    })),
  });
};

/** Organizer / admin decision on a PENDING_APPROVAL registration. */
const decide = async (req, ev0, regId, approve, reason) => {
  const out = await cap.inLock(ev0.id, async (t, ev) => {
    const reg = await M().Reg.findByPk(regId, { transaction: t });
    if (!reg || String(reg.eventId) !== String(ev.id)) throw fail(404, 'NOT_FOUND', 'This registration was not found.');
    if (reg.status !== R.PENDING_APPROVAL) throw fail(409, 'NOT_PENDING', 'This registration is not waiting for approval.', { status: reg.status });
    if (approve) {
      await reg.update({ status: R.CONFIRMED, confirmedAt: clock.now(), approvedAt: clock.now(), approvedBy: req.user.id }, { transaction: t });
      await require('../services/tickets').issueFor(reg, ev, t);
      await audit.fromReq(req, { eventId: ev.id, registrationId: reg.id, action: 'registration.approve', details: {} }, t, 'organizer');
      return { reg, promoted: [] };
    }
    const r = await cap.endRegistration(t, ev, reg, { status: R.REJECTED, by: 'organizer', reason, pct: 100 });
    await audit.fromReq(req, { eventId: ev.id, registrationId: reg.id, action: 'registration.reject', details: { reason } }, t, 'organizer');
    return r;
  });
  if (approve) {
    require('../services/notify').registrationNotice(out.reg, { title: out.reg.type === E.REG_TYPE.TEAM ? 'Team approved ✅' : 'Registration approved ✅', body: `You are confirmed for ${out.event.title}. Your ticket is ready.`, type: N.REGISTRATION_APPROVED });
  } else outcomes.ended(out.reg, out.event, { by: 'organizer', reason });
  outcomes.promoted(out.promoted, out.event);
  return out.reg;
};

// POST /events/:id/registrations/:regId/approve | reject { reason }
const approveRegistration = async (req, res) => {
  const ev = await ownEvent(req);
  tickets().assertConfigured();
  const reg = await decide(req, ev, assertUuid(req.params.regId, 'registration'), true);
  res.json({ registration: { id: reg.id, status: reg.status } });
};
const rejectRegistration = async (req, res) => {
  const ev = await ownEvent(req);
  const reason = cleanText(req.body && req.body.reason, 300);
  if (reason.length < 3) throw fail(400, 'INVALID_INPUT', 'Give a reason (the student sees it).', { field: 'reason' });
  const reg = await decide(req, ev, assertUuid(req.params.regId, 'registration'), false, reason);
  res.json({ registration: { id: reg.id, status: reg.status } });
};
const tickets = () => require('../services/tickets');

/** DUE_AT_VENUE -> PAID_AT_VENUE (organizer / admin / staff), audited. */
const markPaid = async (req, eventId, regId, role, t) => {
  const reg = await M().Reg.findByPk(regId, t ? { transaction: t } : {});
  if (!reg || String(reg.eventId) !== String(eventId)) throw fail(404, 'NOT_FOUND', 'This registration was not found.');
  if (reg.paymentStatus === E.PAYMENT_STATUS.PAID_AT_VENUE) return reg;
  if (reg.paymentStatus !== E.PAYMENT_STATUS.DUE_AT_VENUE) throw fail(409, 'NOT_DUE', 'No pay-at-venue fee is due on this registration.', { paymentStatus: reg.paymentStatus });
  const [n] = await M().Reg.update({ paymentStatus: E.PAYMENT_STATUS.PAID_AT_VENUE, paidAt: clock.now(), paidMarkedBy: req.user.id }, { where: { id: reg.id, paymentStatus: E.PAYMENT_STATUS.DUE_AT_VENUE }, ...(t ? { transaction: t } : {}) });
  if (n) await audit.fromReq(req, { eventId, registrationId: reg.id, action: 'payment.mark_paid_at_venue', details: { amount: money(reg.total), role } }, t, role);
  return M().Reg.findByPk(reg.id, t ? { transaction: t } : {});
};

// POST /events/:id/registrations/:regId/mark-paid
const markPaidRoute = async (req, res) => {
  const ev = await ownEvent(req);
  const reg = await markPaid(req, ev.id, assertUuid(req.params.regId, 'registration'), 'organizer');
  notify.registrationEvent(reg, { title: 'Payment received', body: `Your fee for ${ev.title} was marked as paid at the venue.`, type: N.PAYMENT_CONFIRMED });
  res.json({ registration: { id: reg.id, status: reg.status, paymentStatus: reg.paymentStatus } });
};

/** Pay-at-venue refund handed back in cash: REFUND_PENDING -> REFUNDED (audited). */
const markVenueRefunded = async (req, eventId, regId, role) => {
  const reg = await M().Reg.findByPk(regId);
  if (!reg || String(reg.eventId) !== String(eventId)) throw fail(404, 'NOT_FOUND', 'This registration was not found.');
  if (reg.paymentMode !== E.PAYMENT_MODE.VENUE || reg.paymentStatus !== E.PAYMENT_STATUS.REFUND_PENDING) throw fail(409, 'NO_REFUND_DUE', 'No pay-at-venue refund is due on this registration.');
  const [n] = await M().Reg.update({ paymentStatus: E.PAYMENT_STATUS.REFUNDED, refundedAt: clock.now() }, { where: { id: reg.id, paymentStatus: E.PAYMENT_STATUS.REFUND_PENDING } });
  if (n) await audit.fromReq(req, { eventId, registrationId: reg.id, action: 'payment.venue_refunded', details: { amount: money(reg.refundAmount), role } }, null, role);
  return M().Reg.findByPk(reg.id);
};
const markRefundedRoute = async (req, res) => {
  const ev = await ownEvent(req);
  const reg = await markVenueRefunded(req, ev.id, assertUuid(req.params.regId, 'registration'), 'organizer');
  notify.toUsers([reg.userId], 'Refund done', `Your pay-at-venue fee for ${ev.title} was returned.`, { type: N.REFUND_DONE, registrationId: reg.id, eventId: ev.id });
  res.json({ registration: { id: reg.id, paymentStatus: reg.paymentStatus } });
};

// ── Announcements ────────────────────────────────────────────────────────────
const postAnnouncement = async (req, ev, role) => {
  if (![E.EVENT_STATUS.PUBLISHED, E.EVENT_STATUS.UNPUBLISHED, E.EVENT_STATUS.COMPLETED].includes(ev.status)) throw fail(409, 'NOT_PUBLISHED', 'Updates can be sent for published events only.');
  const s = await flag.readSettings();
  hit('announce', ev.id, { max: s.announcementsPerDay, windowMs: 24 * 60 * 60 * 1000, message: `At most ${s.announcementsPerDay} updates per event per day.` });
  const b = req.body || {};
  const title = cleanText(b.title, E.LIMITS.ANNOUNCEMENT_TITLE);
  const body = cleanText(b.body, E.LIMITS.ANNOUNCEMENT_BODY, { multiline: true });
  if (title.length < 3 || body.length < 3) throw fail(400, 'INVALID_INPUT', 'Write a title and a message.', { field: title.length < 3 ? 'title' : 'body' });
  const kind = Object.values(E.ANNOUNCEMENT_KIND).includes(String(b.kind || '').toUpperCase()) ? String(b.kind).toUpperCase() : E.ANNOUNCEMENT_KIND.UPDATE;
  const a = await M().Announcement.create({ eventId: ev.id, authorUserId: req.user.id, kind, title, body });
  await audit.fromReq(req, { eventId: ev.id, action: 'announcement.create', details: { announcementId: a.id, kind } }, null, role);
  const type = kind === 'VENUE_CHANGE' ? N.VENUE_CHANGED : kind === 'SCHEDULE_CHANGE' ? N.SCHEDULE_CHANGED : N.ANNOUNCEMENT;
  notify.eventBroadcast(ev, { title: `${ev.title}: ${title}`.slice(0, 120), body: body.slice(0, 180), type, dedupe: a.id, statuses: [R.CONFIRMED, R.PENDING_APPROVAL, R.PENDING_PAYMENT, R.WAITLISTED, R.OFFERED] });
  return a;
};
const createAnnouncement = async (req, res) => {
  const ev = await ownEvent(req);
  const a = await postAnnouncement(req, ev, 'organizer');
  res.status(201).json({ announcement: { id: a.id, kind: a.kind, title: a.title, body: a.body, createdAt: iso(a.createdAt) } });
};
const listAnnouncements = async (req, res) => {
  const ev = await ownEvent(req);
  const rows = await M().Announcement.findAll({ where: { eventId: ev.id }, order: [['createdAt', 'DESC']], limit: 100 });
  res.json({ announcements: rows.map((a) => ({ id: a.id, kind: a.kind, title: a.title, body: a.body, createdAt: iso(a.createdAt) })) });
};

/** Counts for an event (organizer stats + admin reports). */
const statsFor = async (ev) => {
  const { Reg, Ticket, Team } = M();
  const rows = await Reg.findAll({ where: { eventId: ev.id }, attributes: ['status', 'paymentMode', 'paymentStatus', 'total', 'refundAmount'] });
  const byStatus = {};
  for (const r of rows) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  const confirmed = rows.filter((r) => r.status === R.CONFIRMED);
  const collected = { VENUE: 0, WALLET: 0, ONLINE: 0 };
  for (const r of rows) {
    if (r.paymentStatus === E.PAYMENT_STATUS.PAID_AT_VENUE) collected.VENUE += money(r.total);
    if (r.paymentStatus === E.PAYMENT_STATUS.SUCCESS && r.paymentMode === E.PAYMENT_MODE.WALLET) collected.WALLET += money(r.total);
    if (r.paymentStatus === E.PAYMENT_STATUS.SUCCESS && r.paymentMode === E.PAYMENT_MODE.ONLINE) collected.ONLINE += money(r.total);
  }
  const due = confirmed.filter((r) => r.paymentStatus === E.PAYMENT_STATUS.DUE_AT_VENUE).reduce((a, r) => a + money(r.total), 0);
  const refunded = rows.filter((r) => r.paymentStatus === E.PAYMENT_STATUS.REFUNDED).reduce((a, r) => a + money(r.refundAmount), 0);
  return {
    eventId: ev.id, byStatus, total: rows.length, confirmed: confirmed.length,
    checkedIn: await Ticket.count({ where: { eventId: ev.id, status: E.TICKET_STATUS.USED } }),
    teams: ev.format === E.FORMAT.TEAM ? await Team.count({ where: { eventId: ev.id, status: { [Op.ne]: E.TEAM_STATUS.CANCELLED } } }) : undefined,
    collected, dueAtVenue: money(due), refunded: money(refunded),
  };
};
const stats = async (req, res) => res.json({ stats: await statsFor(await ownEvent(req)) });

// ── Staff ────────────────────────────────────────────────────────────────────
const grantStaff = async (req, ev, userId, role) => {
  assertUuid(userId, 'student');
  const { ctx, reasons } = await elig.checkUserForEvent(userId, { ...ev.get({ plain: true }), eligibility: {} });
  if (!ctx.user || reasons.length) throw fail(409, 'STAFF_NOT_ELIGIBLE', 'Check-in staff must be verified students of this campus.', { reason: reasons[0] });
  const existing = await M().Staff.findOne({ where: { eventId: ev.id, userId, status: E.STAFF_STATUS.ACTIVE } });
  if (existing) return existing;
  const row = await M().Staff.create({ eventId: ev.id, userId, role: 'CHECKIN', status: E.STAFF_STATUS.ACTIVE, grantedBy: req.user.id });
  await audit.fromReq(req, { eventId: ev.id, action: 'staff.grant', details: { staffId: row.id } }, null, role);
  notify.toUsers([userId], 'Check-in access', `You can now check in attendees for ${ev.title}.`, { type: 'CE_STAFF_GRANTED', eventId: ev.id });
  return row;
};
const revokeStaff = async (req, ev, staffId, role) => {
  const row = await M().Staff.findByPk(assertUuid(staffId, 'staff grant'));
  if (!row || String(row.eventId) !== String(ev.id)) throw fail(404, 'NOT_FOUND', 'This staff grant was not found.');
  if (row.status === E.STAFF_STATUS.ACTIVE) {
    await row.update({ status: E.STAFF_STATUS.REVOKED, revokedAt: clock.now() });
    await audit.fromReq(req, { eventId: ev.id, action: 'staff.revoke', details: { staffId: row.id } }, null, role);
  }
  return row;
};
const staffList = async (ev) => {
  const rows = await M().Staff.findAll({ where: { eventId: ev.id, status: E.STAFF_STATUS.ACTIVE } });
  const users = await usersById(rows.map((r) => r.userId));
  return rows.map((r) => ({ id: r.id, role: r.role, name: S.shortName((users.get(String(r.userId)) || {}).name), createdAt: iso(r.createdAt) }));
};
const listStaff = async (req, res) => res.json({ staff: await staffList(await ownEvent(req)) });
const addStaff = async (req, res) => {
  const ev = await ownEvent(req);
  const row = await grantStaff(req, ev, req.body && req.body.userId, 'organizer');
  res.status(201).json({ staff: { id: row.id, status: row.status } });
};
const removeStaff = async (req, res) => {
  const ev = await ownEvent(req);
  const row = await revokeStaff(req, ev, req.params.staffId, 'organizer');
  res.json({ staff: { id: row.id, status: row.status } });
};

// GET /events/:id/audit
const eventAudit = async (req, res) => {
  const ev = await ownEvent(req);
  const rows = await M().Audit.findAll({ where: { eventId: ev.id }, order: [['at', 'DESC']], limit: 200 });
  res.json({ audit: rows.map((r) => ({ id: r.id, action: r.action, actorRole: r.actorRole, at: iso(r.at) })) });
};

module.exports = {
  requireOrganizer, me, apply, listEvents, createEvent, getEvent, updateEvent, deleteEvent, submit, withdraw, cancelEvent,
  listSlots, createSlots, updateSlot, cancelSlot, registrations, teams, approveRegistration, rejectRegistration, decide, markPaid,
  markPaidRoute, markVenueRefunded, markRefundedRoute, createAnnouncement, listAnnouncements, postAnnouncement, statsFor, stats,
  grantStaff, revokeStaff, staffList, listStaff, addStaff, removeStaff, eventAudit, participantRows, staffRole,
};
