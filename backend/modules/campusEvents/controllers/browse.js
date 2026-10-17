// Discovery (/api/campus-events): status, landing sections, browse with filters / sort / cursor, event
// detail with the server-computed action, slots, availability, announcements. Only PUBLISHED events of the
// viewer's own campus are listed; drafts / submitted / rejected events are never public.
const { Op } = require('sequelize');
const E = require('../enums');
const { fail, cleanText, num, optTime, bool, iso } = require('../services/util');
const S = require('../services/serialize');
const clock = require('../services/clock');
const flag = require('../services/flag');
const elig = require('../services/eligibility');
const payments = require('../services/payments');
const { M, loadEvent, organizerContext, slotsLeftFor, byIds } = require('./common');

const R = E.REG_STATUS;

// GET /status (no feature gate: the app decides whether to show the Others chip)
const status = async (req, res) => {
  const enabled = await flag.readFlag();
  const s = await flag.readSettings();
  let organizer = null;
  let isStaff = false;
  try {
    const o = await M().Organizer.findOne({ where: { userId: req.user.id } });
    organizer = o ? { status: o.status } : null;
    isStaff = await hasCheckInAccess(req.user);
  } catch { /* table missing during boot */ }
  res.json({
    enabled,
    // isOrganizer: may create / manage events. isStaff: may open entry check-in (an ACTIVE staff grant,
    // the organizer of an approved / live / just-finished event, or an admin).
    isOrganizer: !!(organizer && organizer.status === E.ORGANIZER_STATUS.ACTIVE),
    isStaff,
    walletEnabled: enabled && (await flag.readWalletFlag()),
    onlinePayEnabled: enabled && (await payments.razorpay.configured()),
    ticketsReady: require('../services/tickets').configured(),
    organizer,
    settings: { holdMinutes: s.holdMinutes, paymentMinutes: s.paymentMinutes, maxUnpaidVenueReservations: s.maxUnpaidVenueReservations },
    categories: E.CATEGORIES.map((c) => ({ key: c, label: E.CATEGORY_LABELS[c] })),
  });
};

/** Any reason to show the Check-in shortcut (cheap: two indexed lookups). */
const hasCheckInAccess = async (user) => {
  if (String(user.role || '').toLowerCase() === 'admin') return true;
  const grant = await M().Staff.findOne({ where: { userId: user.id, status: E.STAFF_STATUS.ACTIVE }, attributes: ['id'] });
  if (grant) return true;
  const own = await M().Event.findOne({ where: { organizerUserId: user.id, status: { [Op.in]: E.CHECKIN_EVENT_STATUSES } }, attributes: ['id'] });
  return !!own;
};

const viewerCampus = async (userId) => {
  const ctx = await elig.loadContext(userId);
  return ctx;
};

const myOpenRegs = async (userId, eventIds) => {
  if (!eventIds.length) return new Map();
  const rows = await M().Reg.findAll({ where: { userId, eventId: { [Op.in]: eventIds }, status: { [Op.in]: E.OPEN_REG_STATUSES } } });
  const out = new Map();
  for (const r of rows) if (!out.has(String(r.eventId)) || r.status === R.CONFIRMED) out.set(String(r.eventId), r);
  return out;
};

const cards = async (req, events) => {
  const orgCtx = await organizerContext(events);
  const slotsLeft = await slotsLeftFor(events);
  const mine = await myOpenRegs(req.user.id, events.map((e) => e.id));
  return events.map((ev) => S.eventCard(req, ev, { ...orgCtx(ev), mine: mine.get(String(ev.id)), slotsLeft: slotsLeft.get(String(ev.id)) }));
};

const encodeCursor = (o) => Buffer.from(String(o)).toString('base64url');
const decodeCursor = (c) => {
  if (!c) return 0;
  const n = Number(Buffer.from(String(c), 'base64url').toString('utf8'));
  return Number.isInteger(n) && n >= 0 && n < 100000 ? n : 0;
};

/** Filtered PUBLISHED events of a campus. */
const queryEvents = async (campusId, q, { limit = 20, offset = 0 } = {}) => {
  const { Event } = M();
  const now = clock.now();
  const where = { campusId, status: E.EVENT_STATUS.PUBLISHED, endAt: { [Op.gt]: now } };
  const and = [];
  if (q.category) {
    const cats = String(q.category).toUpperCase().split(',').filter((c) => E.CATEGORIES.includes(c));
    if (!cats.length) throw fail(400, 'INVALID_INPUT', 'Unknown category.', { field: 'category' });
    where.category = { [Op.in]: cats };
  }
  if (q.section) {
    const sec = E.SECTIONS.find((x) => x.key === String(q.section));
    if (!sec) throw fail(400, 'INVALID_INPUT', 'Unknown section.', { field: 'section' });
    where.category = { [Op.in]: sec.categories };
  }
  const from = optTime(q.from, 'from');
  const to = optTime(q.to, 'to');
  if (from) and.push({ endAt: { [Op.gte]: from } });
  if (to) and.push({ startAt: { [Op.lte]: to } });
  if (q.price === 'free') where.priceType = E.PRICE_TYPE.FREE;
  else if (q.price === 'paid') where.priceType = E.PRICE_TYPE.PAID;
  else if (q.price) throw fail(400, 'INVALID_INPUT', 'price must be free or paid.', { field: 'price' });
  if (q.format) {
    const f = String(q.format).toUpperCase();
    if (f === 'TEAM') where.format = E.FORMAT.TEAM;
    else if (f === 'INDIVIDUAL') where.format = { [Op.in]: [E.FORMAT.INDIVIDUAL, E.FORMAT.SLOT] };
    else if (f === 'SLOT') where.format = E.FORMAT.SLOT;
    else throw fail(400, 'INVALID_INPUT', 'format must be INDIVIDUAL, SLOT or TEAM.', { field: 'format' });
  }
  if (q.entityId) where.entityId = String(q.entityId);
  if (q.organizerId) where.organizerId = String(q.organizerId);
  if (bool(q.featured)) where.featured = true;
  const deadline = q.sort === 'deadline';
  // sort=deadline lists open registrations only (a closed or not-yet-open event has no deadline to beat).
  if (q.status === 'open' || deadline) and.push({ [Op.or]: [{ regOpensAt: null }, { regOpensAt: { [Op.lte]: now } }] }, { [Op.or]: [{ regClosesAt: null }, { regClosesAt: { [Op.gt]: now } }] });
  else if (q.status === 'upcoming') and.push({ regOpensAt: { [Op.gt]: now } });
  else if (q.status === 'closed') and.push({ regClosesAt: { [Op.lte]: now } });
  const text = cleanText(q.q, 60);
  if (text) {
    const like = require('../services/locks').isPg() ? Op.iLike : Op.like;
    const pat = `%${text.replace(/[%_\\]/g, '')}%`;
    and.push({ [Op.or]: [{ title: { [like]: pat } }, { venue: { [like]: pat } }] });
  }
  if (deadline) and.push({ [Op.or]: [{ format: E.FORMAT.SLOT }, { startAt: { [Op.gt]: now } }] });
  if (and.length) where[Op.and] = and;
  // Registration without a closing time closes when the event starts (slot events: per slot) -> COALESCE.
  const closesAt = () => Event.sequelize.fn('COALESCE', Event.sequelize.col('regClosesAt'), Event.sequelize.col('startAt'));
  const order = q.sort === 'recent' ? [['publishedAt', 'DESC'], ['id', 'ASC']]
    : deadline ? [[closesAt(), 'ASC'], ['startAt', 'ASC'], ['id', 'ASC']]
      : [['startAt', 'ASC'], ['id', 'ASC']];
  let rows = await Event.findAll({ where, order, limit: bool(q.available) ? 500 : limit + 1, offset: bool(q.available) ? 0 : offset });
  if (bool(q.available)) {
    const slotsLeft = await slotsLeftFor(rows);
    rows = rows.filter((ev) => {
      if (ev.format === E.FORMAT.SLOT) return (slotsLeft.get(String(ev.id)) || 0) > 0;
      const c = S.capacityBlock(ev);
      return c.remaining > 0;
    }).slice(offset, offset + limit + 1);
  }
  return rows;
};

// GET /  ?q&category&section&from&to&price&format&available&entityId&status&sort&cursor&limit
const browse = async (req, res) => {
  const ctx = await viewerCampus(req.user.id);
  if (!ctx.campusId) return res.json({ events: [], nextCursor: null, reason: 'CAMPUS_REQUIRED', message: elig.REASON_MESSAGES.CAMPUS_REQUIRED });
  const limit = num(req.query.limit, { min: 1, max: 50, int: true, field: 'limit' }) || 20;
  const offset = decodeCursor(req.query.cursor);
  const rows = await queryEvents(ctx.campusId, req.query || {}, { limit, offset });
  const page = rows.slice(0, limit);
  res.json({ events: await cards(req, page), nextCursor: rows.length > limit ? encodeCursor(offset + limit) : null });
};

// GET /clubs   verified clubs (FriendsEntity) of my campus that have published, not-yet-ended events
const clubs = async (req, res) => {
  const ctx = await viewerCampus(req.user.id);
  const ent = require('./common').Entity();
  if (!ctx.campusId || !ent) return res.json({ clubs: [] });
  const rows = await M().Event.findAll({ where: { campusId: ctx.campusId, status: E.EVENT_STATUS.PUBLISHED, endAt: { [Op.gt]: clock.now() }, entityId: { [Op.ne]: null } }, attributes: ['entityId'], limit: 2000 });
  const counts = new Map();
  for (const r of rows) counts.set(String(r.entityId), (counts.get(String(r.entityId)) || 0) + 1);
  if (!counts.size) return res.json({ clubs: [] });
  const ents = await ent.findAll({ where: { id: { [Op.in]: [...counts.keys()] }, verified: true }, attributes: ['id', 'name', 'type', 'verified', 'status', 'campusId'] });
  res.json({
    clubs: ents
      .filter((e) => e.status !== 'suspended' && (!e.campusId || String(e.campusId) === String(ctx.campusId)))
      .map((e) => ({ id: e.id, name: e.name, type: e.type, verified: true, eventCount: counts.get(String(e.id)) || 0 }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name))),
  });
};

// GET /categories   fixed list (labels + icons + landing section)
const categories = (req, res) => res.json({ categories: E.categoryList(), sections: E.SECTIONS.map((s) => ({ key: s.key, label: s.label, categories: s.categories })) });

// GET /sections   landing: featured, upcoming, per-category sections, my counts
const sections = async (req, res) => {
  const ctx = await viewerCampus(req.user.id);
  const counts = await myCounts(req.user.id);
  if (!ctx.campusId) return res.json({ featured: [], upcoming: [], sections: [], my: counts, reason: 'CAMPUS_REQUIRED' });
  const all = await queryEvents(ctx.campusId, {}, { limit: 200, offset: 0 });
  const list = await cards(req, all);
  const byId = new Map(list.map((c) => [c.id, c]));
  res.json({
    featured: all.filter((e) => e.featured).slice(0, 10).map((e) => byId.get(e.id)),
    upcoming: all.slice(0, 10).map((e) => byId.get(e.id)),
    sections: E.SECTIONS.map((s) => ({ key: s.key, label: s.label, events: all.filter((e) => s.categories.includes(e.category)).slice(0, 10).map((e) => byId.get(e.id)) })).filter((s) => s.events.length),
    my: counts,
  });
};

const myCounts = async (userId) => {
  const { Reg, Ticket } = M();
  const [registrations, tickets] = await Promise.all([
    Reg.count({ where: { userId, status: { [Op.in]: E.OPEN_REG_STATUSES } } }),
    Ticket.count({ where: { userId, status: E.TICKET_STATUS.ACTIVE } }),
  ]);
  return { registrations, tickets };
};

/** The single primary action for the viewer, computed on the server. */
const computeCta = (ev, { reasons, myReg, myTeam, pendingInvite, slotsLeft }) => {
  const a = (action, label, enabled = true, extra = {}) => ({ action, label, enabled, ...extra });
  if (ev.status === E.EVENT_STATUS.CANCELLED) return a('CANCELLED', 'Event cancelled', false);
  if (myReg) {
    if (myReg.status === R.CONFIRMED) return a('VIEW_TICKET', 'View my ticket', true, { registrationId: myReg.id });
    if (myReg.status === R.PENDING_PAYMENT) return a('COMPLETE_PAYMENT', 'Complete payment', true, { registrationId: myReg.id });
    if (myReg.status === R.HELD) return a('CONFIRM_BOOKING', 'Confirm booking', true, { registrationId: myReg.id });
    if (myReg.status === R.PENDING_APPROVAL) return a('PENDING_APPROVAL', 'Waiting for organizer approval', false, { registrationId: myReg.id });
    if (myReg.status === R.WAITLISTED) return a('ON_WAITLIST', 'You are on the waitlist', false, { registrationId: myReg.id });
    if (myReg.status === R.OFFERED) return a('ACCEPT_OFFER', 'A place opened: confirm it', true, { registrationId: myReg.id });
  }
  const state = S.registrationState(ev, { slotsLeft });
  if (state === 'COMPLETED') return a('COMPLETED', 'Event is over', false);
  if (state === 'NOT_OPEN') return a('NOT_OPEN', 'Registration opens soon', false, { opensAt: iso(ev.regOpensAt) });
  if (state === 'CLOSED') return a('REGISTRATION_CLOSED', 'Registration closed', false);
  if (ev.format === E.FORMAT.TEAM && myTeam) return a(myTeam.isCaptain ? 'MANAGE_TEAM' : 'VIEW_TEAM', myTeam.isCaptain ? 'Manage my team' : 'View my team', true, { teamId: myTeam.id });
  if (reasons.length) return a('NOT_ELIGIBLE', elig.REASON_MESSAGES[reasons[0]] || 'You are not eligible for this event', false, { reasons });
  if (ev.format === E.FORMAT.TEAM && pendingInvite) return a('JOIN_TEAM', 'Respond to team invitation', true, { invitationId: pendingInvite.id });
  if (state === 'FULL') return ev.waitlistEnabled ? a('JOIN_WAITLIST', 'Join waitlist') : a('EVENT_FULL', 'Event full', false);
  if (ev.format === E.FORMAT.TEAM) return a('REGISTER_TEAM', 'Register a team');
  if (ev.format === E.FORMAT.SLOT) return a('BOOK_SLOT', 'Book a slot');
  return a('REGISTER_NOW', 'Register now');
};

/** Event visible to a student: PUBLISHED / COMPLETED / CANCELLED on their campus (ended ones only if registered). */
const loadVisible = async (req, id) => {
  const ev = await loadEvent(id);
  const ctx = await elig.loadContext(req.user.id);
  const visibleStatuses = [E.EVENT_STATUS.PUBLISHED, E.EVENT_STATUS.COMPLETED, E.EVENT_STATUS.CANCELLED];
  if (!visibleStatuses.includes(ev.status) || (ev.campusId && String(ev.campusId) !== String(ctx.campusId))) {
    if (String(ev.organizerUserId) !== String(req.user.id)) throw fail(404, 'NOT_FOUND', 'This event was not found.');
  }
  if (ev.status !== E.EVENT_STATUS.PUBLISHED && String(ev.organizerUserId) !== String(req.user.id)) {
    const has = await M().Reg.findOne({ where: { eventId: ev.id, userId: req.user.id }, attributes: ['id'] });
    const member = has ? null : await M().Member.findOne({ where: { eventId: ev.id, userId: req.user.id }, attributes: ['id'] });
    if (!has && !member) throw fail(404, 'NOT_FOUND', 'This event was not found.');
  }
  return { ev, ctx };
};

const myTeamFor = async (eventId, userId) => {
  const { Member, Team } = M();
  const m = await Member.findOne({ where: { eventId, userId, status: E.MEMBER_STATUS.ACCEPTED }, order: [['createdAt', 'DESC']] });
  if (!m) return null;
  const team = await Team.findByPk(m.teamId);
  if (!team || team.status === E.TEAM_STATUS.CANCELLED) return null;
  return { id: team.id, name: team.name, status: team.status, isCaptain: String(team.captainUserId) === String(userId), registrationId: team.registrationId };
};

// GET /:id
const detail = async (req, res) => {
  const { ev, ctx } = await loadVisible(req, req.params.id);
  const orgCtx = await organizerContext([ev]);
  const slotsLeft = (await slotsLeftFor([ev])).get(String(ev.id));
  const mine = (await myOpenRegs(req.user.id, [ev.id])).get(String(ev.id)) || null;
  const myTeam = ev.format === E.FORMAT.TEAM ? await myTeamFor(ev.id, req.user.id) : null;
  let teamReg = null;
  if (myTeam && myTeam.registrationId) teamReg = await M().Reg.findByPk(myTeam.registrationId);
  const pendingInvite = ev.format === E.FORMAT.TEAM ? await M().Member.findOne({ where: { eventId: ev.id, userId: req.user.id, status: E.MEMBER_STATUS.INVITED, expiresAt: { [Op.gt]: clock.now() } } }) : null;
  const reasons = elig.eventReasons(ctx, ev);
  const effectiveReg = mine || (teamReg && E.OPEN_REG_STATUSES.includes(teamReg.status) ? teamReg : null);
  const cta = computeCta(ev, { reasons, myReg: effectiveReg, myTeam, pendingInvite, slotsLeft });
  res.json({
    event: S.eventDetail(req, ev, {
      ...orgCtx(ev), mine, slotsLeft, cta, eligibilityReasons: reasons, paymentModes: await payments.enabledModes(ev),
      myRegistration: effectiveReg ? { id: effectiveReg.id, code: effectiveReg.code, status: effectiveReg.status, type: effectiveReg.type } : null,
      myTeam,
    }),
  });
};

// GET /:id/slots   (dates -> sessions grouped by IST day)
const slots = async (req, res) => {
  const { ev } = await loadVisible(req, req.params.id);
  if (ev.format !== E.FORMAT.SLOT) return res.json({ slots: [], days: [] });
  const rows = await M().Slot.findAll({ where: { eventId: ev.id, status: 'OPEN' }, order: [['startAt', 'ASC']] });
  const mine = await M().Reg.findAll({ where: { eventId: ev.id, userId: req.user.id, status: { [Op.in]: E.OPEN_REG_STATUSES } }, attributes: ['id', 'slotId', 'status'] });
  const mineBySlot = new Map(mine.map((r) => [String(r.slotId), r]));
  const list = rows.map((s) => ({ ...S.slotPublic(ev, s), myRegistration: mineBySlot.has(String(s.id)) ? { id: mineBySlot.get(String(s.id)).id, status: mineBySlot.get(String(s.id)).status } : null }));
  const { istYmd } = require('../../../utils/istTime');
  const days = [];
  for (const s of list) {
    const d = istYmd(new Date(s.startAt));
    let day = days.find((x) => x.date === d);
    if (!day) { day = { date: d, slots: [] }; days.push(day); }
    day.slots.push(s);
  }
  res.json({ slots: list, days, maxBookingsPerStudent: Number(ev.maxBookingsPerStudent) || 1, myBookings: mine.length });
};

// GET /:id/availability   (counts only, cheap poll)
const availability = async (req, res) => {
  const { ev } = await loadVisible(req, req.params.id);
  const out = { eventId: ev.id, registrationState: null, capacity: S.capacityBlock(ev) };
  if (ev.format === E.FORMAT.SLOT) {
    const rows = await M().Slot.findAll({ where: { eventId: ev.id, status: 'OPEN' }, order: [['startAt', 'ASC']] });
    out.slots = rows.map((s) => { const p = S.slotPublic(ev, s); return { id: p.id, remaining: p.remaining, capacity: p.capacity, state: p.state }; });
    out.registrationState = S.registrationState(ev, { slotsLeft: out.slots.filter((s) => s.state === 'OPEN').length });
  } else out.registrationState = S.registrationState(ev);
  res.json(out);
};

// GET /:id/announcements   registrants, team members and the organizer only
const announcements = async (req, res) => {
  const ev = await loadEvent(req.params.id);
  const uid = req.user.id;
  const isOrg = String(ev.organizerUserId) === String(uid) || String(req.user.role || '').toLowerCase() === 'admin';
  if (!isOrg) {
    const reg = await M().Reg.findOne({ where: { eventId: ev.id, userId: uid }, attributes: ['id'] });
    const mem = reg ? null : await M().Member.findOne({ where: { eventId: ev.id, userId: uid, status: E.MEMBER_STATUS.ACCEPTED }, attributes: ['id'] });
    if (!reg && !mem) throw fail(404, 'NOT_FOUND', 'This event was not found.');
  }
  const rows = await M().Announcement.findAll({ where: { eventId: ev.id }, order: [['createdAt', 'DESC']], limit: 50 });
  res.json({ announcements: rows.map((a) => ({ id: a.id, kind: a.kind, title: a.title, body: a.body, createdAt: iso(a.createdAt) })) });
};

module.exports = { status, clubs, categories, hasCheckInAccess, browse, sections, detail, slots, availability, announcements, computeCta, loadVisible, myCounts, byIds };
