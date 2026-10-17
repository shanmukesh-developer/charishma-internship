// Entry check-in (/api/campus-events/check-in): the event's organizer, admins and granted CeEventStaff only.
// validate -> read-only verdict; confirm -> atomic single-use admission. Order of checks (first match wins):
//   INVALID (bad signature / version / unknown code) -> WRONG_EVENT -> CANCELLED (ticket or registration)
//   -> UNPAID / PENDING (registration not confirmed) -> NOT_YET_VALID / EXPIRED (entry window)
//   -> ALREADY_USED -> VALID (+ paymentDue when the fee is collected at the venue).
// confirm: UPDATE CeTickets SET status='USED' WHERE id AND status='ACTIVE' AND tokenVersion (one winner) +
// a CeCheckIn CONFIRM/VALID row (unique index ce_checkin_admitted backstop) in one transaction; a fee due at
// the venue must be collected in the same call (collectPayment: true, audited). Every attempt is logged.
// Staff see first name + initial, team, ticket code and slot only. Online only (v1): no offline mode, an
// unreachable server means "Cannot verify, do not admit".
const E = require('../enums');
const { fail, assertUuid, hit, iso, normalizeTicketCode, money, isUniqueError } = require('../services/util');
const S = require('../services/serialize');
const clock = require('../services/clock');
const tickets = require('../services/tickets');
const cap = require('../services/capacity');
const audit = require('../services/audit');
const notify = require('../services/notify');
const { tx } = require('../services/locks');
const { M, loadEvent, usersById, staffRole } = require('./common');

const C = E.CHECKIN_RESULT;
const R = E.REG_STATUS;

const loadStaffEvent = async (req, eventId) => {
  const ev = await loadEvent(assertUuid(eventId, 'event'));
  const role = await staffRole(req.user, ev);
  if (!role) throw fail(403, 'NOT_EVENT_STAFF', 'You are not check-in staff for this event.');
  return { ev, role };
};

/** Finds the ticket for a QR token or a typed code. null = INVALID. */
const findTicket = async (body) => {
  const Ticket = M().Ticket;
  if (body.token) {
    const p = tickets.parseToken(String(body.token));
    if (!p) return { ticket: null, method: 'QR' };
    const tk = await Ticket.findByPk(p.id);
    if (!tk || Number(tk.tokenVersion) !== p.ver) return { ticket: null, method: 'QR' };
    return { ticket: tk, method: 'QR' };
  }
  const code = normalizeTicketCode(body.code);
  if (code.length !== 10) return { ticket: null, method: 'CODE' };
  return { ticket: await Ticket.findOne({ where: { ticketCode: code } }), method: 'CODE' };
};

/** The verdict for a ticket at this event right now (no writes). */
const verdict = async (ev, tk) => {
  if (!tk) return { result: C.INVALID };
  if (String(tk.eventId) !== String(ev.id)) return { result: C.WRONG_EVENT, ticket: tk };
  const reg = await M().Reg.findByPk(tk.registrationId);
  const slot = tk.slotId ? await M().Slot.findByPk(tk.slotId) : null;
  const base = { ticket: tk, reg, slot };
  if ([E.TICKET_STATUS.CANCELLED, E.TICKET_STATUS.VOID].includes(tk.status) || !reg || E.ENDED_REG_STATUSES.includes(reg.status) || ev.status === E.EVENT_STATUS.CANCELLED) return { result: C.CANCELLED, ...base };
  if (reg.status !== R.CONFIRMED) return { result: reg.status === R.PENDING_PAYMENT ? C.UNPAID : C.PENDING, ...base };
  const now = clock.nowMs();
  const opens = cap.startOf(ev, slot).getTime() - (Number(ev.entryOpensBeforeMin) || 0) * 60 * 1000;
  if (now < opens) return { result: C.NOT_YET_VALID, entryOpensAt: new Date(opens).toISOString(), ...base };
  if (now > cap.endOf(ev, slot).getTime()) return { result: C.EXPIRED, ...base };
  if (tk.status === E.TICKET_STATUS.USED) return { result: C.ALREADY_USED, ...base };
  return { result: C.VALID, paymentDue: reg.paymentStatus === E.PAYMENT_STATUS.DUE_AT_VENUE ? money(reg.total) : 0, ...base };
};

const log = (row) => M().CheckIn.create({ ...row, at: clock.now() }).catch((err) => console.warn('[CAMPUS_EVENTS_CHECKIN_LOG_WARN]', err.message));

const view = async (ev, v) => {
  if (!v.ticket) return null;
  const tk = v.ticket;
  const team = tk.teamId ? await M().Team.findByPk(tk.teamId) : null;
  const holder = tk.userId ? (await usersById([tk.userId])).get(String(tk.userId)) : null;
  return S.staffView(tk, { reg: v.reg, team, slot: v.slot, holderName: holder && holder.name, event: String(tk.eventId) === String(ev.id) ? ev : null });
};

const reply = async (ev, v, extra = {}) => ({
  result: v.result,
  label: E.CHECKIN_LABELS[v.result],
  admit: v.result === C.VALID && !(v.paymentDue > 0 && !extra.collected),
  ...(v.paymentDue ? { paymentDue: v.paymentDue } : {}),
  ...(v.entryOpensAt ? { entryOpensAt: v.entryOpensAt } : {}),
  ticket: v.result === C.WRONG_EVENT || v.result === C.INVALID ? null : await view(ev, v),
  ...extra,
});

// POST /validate   { eventId, token | code }
const validate = async (req, res) => {
  hit('check_in', req.user.id);
  const body = req.body || {};
  const { ev } = await loadStaffEvent(req, body.eventId);
  tickets.assertConfigured();
  const { ticket, method } = await findTicket(body);
  const v = await verdict(ev, ticket);
  await log({ eventId: ev.id, ticketId: ticket ? ticket.id : null, registrationId: v.reg ? v.reg.id : null, staffUserId: req.user.id, action: 'VALIDATE', method, result: v.result });
  res.json(await reply(ev, v));
};

// POST /confirm   { eventId, token | code, collectPayment? }
const confirm = async (req, res) => {
  hit('check_in', req.user.id);
  const body = req.body || {};
  const { ev, role } = await loadStaffEvent(req, body.eventId);
  tickets.assertConfigured();
  const { ticket, method } = await findTicket(body);
  const v = await verdict(ev, ticket);
  const base = { eventId: ev.id, ticketId: ticket ? ticket.id : null, registrationId: v.reg ? v.reg.id : null, staffUserId: req.user.id, action: 'CONFIRM', method };
  if (v.result !== C.VALID) {
    await log({ ...base, result: v.result });
    return res.status(409).json({ code: v.result, message: E.CHECKIN_LABELS[v.result], ...(await reply(ev, v)) });
  }
  const collect = body.collectPayment === true || body.collectPayment === 'true';
  if (v.paymentDue > 0 && !collect) {
    await log({ ...base, result: C.PAYMENT_DUE });
    return res.status(409).json({ code: C.PAYMENT_DUE, message: `Collect ₹${v.paymentDue} before admitting, then confirm with collectPayment.`, ...(await reply(ev, { ...v, result: C.PAYMENT_DUE })) });
  }
  let admitted = false;
  try {
    admitted = await tx(async (t) => {
      const [n] = await M().Ticket.update({ status: E.TICKET_STATUS.USED, usedAt: clock.now(), usedBy: req.user.id }, { where: { id: ticket.id, status: E.TICKET_STATUS.ACTIVE, tokenVersion: ticket.tokenVersion }, transaction: t });
      if (!n) return false;
      await M().CheckIn.create({ ...base, result: C.VALID, collectedPayment: v.paymentDue > 0, at: clock.now() }, { transaction: t });
      if (v.paymentDue > 0) await require('./organizer').markPaid(req, ev.id, v.reg.id, role === 'admin' ? 'admin' : (role === 'organizer' ? 'organizer' : 'staff'), t);
      await M().Event.increment('checkedInCount', { by: 1, where: { id: ev.id }, transaction: t });
      return true;
    });
  } catch (err) {
    if (!isUniqueError(err)) throw err;
    admitted = false;
  }
  if (!admitted) {
    const fresh = await M().Ticket.findByPk(ticket.id);
    const again = await verdict(ev, fresh);
    const result = again.result === C.VALID ? C.ALREADY_USED : again.result;
    await log({ ...base, result });
    return res.status(409).json({ code: result, message: E.CHECKIN_LABELS[result], ...(await reply(ev, { ...again, result })) });
  }
  const fresh = await M().Ticket.findByPk(ticket.id);
  const reg = await M().Reg.findByPk(v.reg.id);
  notify.nudge([reg.userId], 'ticket', fresh.id, fresh.status);
  notify.admin('updated', ev.id);
  res.json(await reply(ev, { ...v, ticket: fresh, reg, paymentDue: 0 }, { admitted: true, collected: v.paymentDue > 0 ? v.paymentDue : 0, admit: true }));
};

// GET /events   (events I can check in for: organizer, staff, admin -> live ones)
const myEvents = async (req, res) => {
  const { Op } = require('sequelize');
  const isAdmin = String(req.user.role || '').toLowerCase() === 'admin';
  const staff = await M().Staff.findAll({ where: { userId: req.user.id, status: E.STAFF_STATUS.ACTIVE }, attributes: ['eventId'] });
  // APPROVED = approved but scheduled (publishAt in the future): staff can be set up and test the gate early.
  const where = { status: { [Op.in]: E.CHECKIN_EVENT_STATUSES }, endAt: { [Op.gt]: new Date(clock.nowMs() - 24 * 60 * 60 * 1000) } };
  if (!isAdmin) where[Op.or] = [{ organizerUserId: req.user.id }, { id: { [Op.in]: staff.map((s) => s.eventId) } }];
  const rows = await M().Event.findAll({ where, order: [['startAt', 'ASC']], limit: 100 });
  res.json({ events: rows.map((ev) => ({ id: ev.id, title: ev.title, startAt: iso(ev.startAt), endAt: iso(ev.endAt), venue: ev.venue, format: ev.format, status: ev.status, publishAt: iso(ev.publishAt), checkedIn: ev.checkedInCount || 0, confirmed: ev.unitsConfirmed || 0 })) });
};

// GET /events/:id/recent   (last admissions / attempts, staff-limited view)
const recent = async (req, res) => {
  const { ev } = await loadStaffEvent(req, req.params.id);
  const rows = await M().CheckIn.findAll({ where: { eventId: ev.id }, order: [['at', 'DESC']], limit: 50 });
  const tks = await require('./common').byIds(M().Ticket, rows.map((r) => r.ticketId));
  res.json({
    checkIns: rows.map((r) => ({ id: r.id, action: r.action, result: r.result, method: r.method, at: iso(r.at), ticketCode: tks.get(String(r.ticketId)) ? tks.get(String(r.ticketId)).ticketCode : null, collectedPayment: !!r.collectedPayment })),
    note: 'Check-in needs a connection. If the server cannot be reached, do not admit: ask the student to wait.',
  });
};

module.exports = { validate, confirm, myEvents, recent, verdict, findTicket, audit };
