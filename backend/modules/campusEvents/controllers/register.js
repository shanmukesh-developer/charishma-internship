// Student registrations (/api/campus-events): register (individual / slot), hold -> confirm -> release,
// cancel, waitlist offers, My Registrations, My Tickets, online payment order + status. Prices, capacity,
// eligibility and payment state always come from the server.
const { Op } = require('sequelize');
const E = require('../enums');
const { fail, assertUuid, hit, iso, money, toPaise } = require('../services/util');
const { readIdempotencyKey } = require('../../../utils/idempotency');
const S = require('../services/serialize');
const clock = require('../services/clock');
const cap = require('../services/capacity');
const tickets = require('../services/tickets');
const payments = require('../services/payments');
const elig = require('../services/eligibility');
const V = require('../services/validate');
const outcomes = require('../services/outcomes');
const audit = require('../services/audit');
const { M, loadEvent, byIds, usersById } = require('./common');

const R = E.REG_STATUS;
const P = E.PAYMENT_STATUS;

const loadSlot = async (event, slotId) => {
  if (event.format !== E.FORMAT.SLOT) {
    if (slotId) throw fail(400, 'INVALID_INPUT', 'This event has no slots.', { field: 'slotId' });
    return null;
  }
  if (!slotId) throw fail(400, 'INVALID_INPUT', 'Pick a slot first.', { field: 'slotId' });
  assertUuid(slotId, 'slot');
  const slot = await M().Slot.findByPk(slotId);
  if (!slot || String(slot.eventId) !== String(event.id)) throw fail(404, 'NOT_FOUND', 'This slot was not found.');
  return slot;
};

/** Eligibility + answers + rules + price + payment mode, all before the lock (no writes). */
const prepare = async (req, event, slot, body, { needAnswers = true } = {}) => {
  const ctx = await elig.loadContext(req.user.id);
  elig.assertEventEligible(ctx, event);
  const answers = needAnswers ? V.cleanAnswers(event.questions, body.answers) : null;
  const rulesVersion = needAnswers ? V.checkRules(event, body) : null;
  const price = payments.priceFor(event, slot);
  const paymentMode = await payments.pickMode(event, body.paymentMode, price.total);
  return { ctx, answers, rulesVersion, price, paymentMode };
};

/** Same retry key from this user: replay a live registration, refuse an ended one. */
const replay = async (userId, key, eventId) => {
  if (!key) return null;
  const prior = await M().Reg.findOne({ where: { userId, idempotencyKey: key } });
  if (!prior) return null;
  if (String(prior.eventId) !== String(eventId)) throw fail(409, 'IDEMPOTENCY_KEY_REUSED', 'This retry key was already used for another event.', { registrationId: prior.id });
  if (!E.OPEN_REG_STATUSES.includes(prior.status)) throw fail(409, 'IDEMPOTENCY_KEY_REUSED', 'That earlier attempt has ended. Please try again.', { registrationId: prior.id, status: prior.status });
  return prior;
};

const assertNoDuplicate = async (t, event, slot, userId) => {
  const { Reg } = M();
  const key = slot ? slot.id : event.id;
  const dup = await Reg.findOne({ where: { userId, capacityKey: key, teamId: null, status: { [Op.in]: E.OPEN_REG_STATUSES } }, transaction: t });
  if (dup) throw fail(409, 'ALREADY_REGISTERED', slot ? 'You already booked this slot.' : 'You are already registered for this event.', { registrationId: dup.id, status: dup.status });
  if (event.format === E.FORMAT.SLOT) {
    const n = await Reg.count({ where: { userId, eventId: event.id, teamId: null, status: { [Op.in]: E.OPEN_REG_STATUSES } }, transaction: t });
    const max = Number(event.maxBookingsPerStudent) || 1;
    if (n >= max) throw fail(409, 'BOOKING_LIMIT', `You can book at most ${max} slot${max === 1 ? '' : 's'} for this activity.`, { limit: max });
  }
};

const regPayload = async (req, reg, extra = {}) => {
  const { Event, Slot, Team, Ticket } = M();
  const [event, slot, team, tks] = await Promise.all([
    extra.event || Event.findByPk(reg.eventId), reg.slotId ? Slot.findByPk(reg.slotId) : null, reg.teamId ? Team.findByPk(reg.teamId) : null,
    Ticket.findAll({ where: { registrationId: reg.id }, order: [['createdAt', 'ASC']] }),
  ]);
  const can = await cancelInfo(reg, event, slot, req.user.id, tks);
  const visible = tks.filter((tk) => tk.kind === E.TICKET_KIND.TEAM || String(tk.userId) === String(req.user.id) || String(reg.userId) === String(req.user.id));
  return S.registrationOwn(req, reg, { event, slot, team, tickets: visible, viewerId: req.user.id, ...can });
};

const cancelInfo = async (reg, event, slot, viewerId, tks) => {
  if (String(reg.userId) !== String(viewerId) || !E.OPEN_REG_STATUSES.includes(reg.status) || (tks || []).some((x) => x.status === E.TICKET_STATUS.USED)) return { canCancel: false };
  try {
    await cap.assertUserCanCancel(event, reg, slot);
    return { canCancel: true };
  } catch (err) {
    return { canCancel: false, cancelUntil: err.extra && err.extra.cancelUntil };
  }
};

const sendRegistration = async (req, res, status, reg, out = {}) => res.status(status).json({ registration: await regPayload(req, reg), ...out });

const doRegister = async (req, res, { holdOnly }) => {
  hit('register', req.user.id);
  tickets.assertConfigured();
  const event = await loadEvent(req.params.id);
  if (event.format === E.FORMAT.TEAM) throw fail(400, 'TEAM_EVENT', 'This is a team event. Create or join a team to register.');
  const body = req.body || {};
  const slot = await loadSlot(event, req.params.slotId || body.slotId);
  const key = readIdempotencyKey(req, body.idempotencyKey);
  const prior = await replay(req.user.id, key, event.id);
  if (prior) return sendRegistration(req, res, 200, prior, { replay: true });
  cap.assertOpen(event, slot);
  const prep = await prepare(req, event, slot, body, { needAnswers: !holdOnly });
  const out = await cap.inLock(event.id, async (t, ev) => {
    const sl = slot ? await M().Slot.findByPk(slot.id, { transaction: t }) : null;
    cap.assertOpen(ev, sl);
    if (key) {
      const p = await M().Reg.findOne({ where: { userId: req.user.id, idempotencyKey: key }, transaction: t });
      if (p) return { reg: p, replay: true };
    }
    await assertNoDuplicate(t, ev, sl, req.user.id);
    if (prep.paymentMode === E.PAYMENT_MODE.VENUE) await payments.assertVenueQuota(req.user.id, t);
    const r = await cap.allocate(t, {
      event: ev, slot: sl, userId: req.user.id, type: sl ? E.REG_TYPE.SLOT : E.REG_TYPE.INDIVIDUAL, answers: prep.answers,
      rulesVersion: prep.rulesVersion, paymentMode: prep.paymentMode, price: prep.price, idempotencyKey: key || null, holdOnly,
      joinWaitlist: body.joinWaitlist,
    });
    return r;
  });
  outcomes.swept(out.swept, out.event);
  if (out.replay) return sendRegistration(req, res, 200, out.reg, { replay: true });
  if (!holdOnly) outcomes.registered(out.reg, out.event);
  return sendRegistration(req, res, 201, out.reg, { waitlisted: !!out.waitlisted, held: !!out.held });
};

// POST /:id/register   { slotId?, answers, acceptRules, rulesVersion, paymentMode?, joinWaitlist?, idempotencyKey? }
const register = (req, res) => doRegister(req, res, { holdOnly: false });
// POST /:id/slots/:slotId/hold   (slot picker: holds the place for holdMinutes; answers come at confirm)
const hold = (req, res) => doRegister(req, res, { holdOnly: true });

const loadOwn = async (req, { allowTeamMember = false } = {}) => {
  const id = assertUuid(req.params.id, 'registration');
  const reg = await M().Reg.findByPk(id);
  if (!reg) throw fail(404, 'NOT_FOUND', 'This registration was not found.');
  if (String(reg.userId) === String(req.user.id)) return reg;
  if (allowTeamMember && reg.teamId) {
    const m = await M().Member.findOne({ where: { teamId: reg.teamId, userId: req.user.id, status: E.MEMBER_STATUS.ACCEPTED }, attributes: ['id'] });
    if (m) return reg;
  }
  throw fail(404, 'NOT_FOUND', 'This registration was not found.');
};

// POST /registrations/:id/confirm   { answers, acceptRules, rulesVersion, paymentMode? }  (HELD -> next state)
const confirm = async (req, res) => {
  hit('register', req.user.id);
  tickets.assertConfigured();
  const reg0 = await loadOwn(req);
  if (reg0.status !== R.HELD) {
    if (E.OPEN_REG_STATUSES.includes(reg0.status)) return sendRegistration(req, res, 200, reg0, { replay: true });
    throw fail(410, 'HOLD_EXPIRED', 'Your hold has ended. Please book again.', { status: reg0.status });
  }
  const event = await loadEvent(reg0.eventId);
  const slot = reg0.slotId ? await M().Slot.findByPk(reg0.slotId) : null;
  const prep = await prepare(req, event, slot, req.body || {});
  let expiredNow = false;
  const out = await cap.inLock(event.id, async (t, ev) => {
    const reg = await M().Reg.findByPk(reg0.id, { transaction: t });
    if (!reg || reg.status !== R.HELD) { expiredNow = true; return { reg }; }
    if (prep.paymentMode === E.PAYMENT_MODE.VENUE) await payments.assertVenueQuota(req.user.id, t);
    await reg.update({ answers: prep.answers, questionsSnapshot: V.questionsSnapshot(ev.questions), rulesVersion: prep.rulesVersion, rulesAcceptedAt: clock.now(), paymentMode: prep.paymentMode, amount: prep.price.amount, extras: prep.price.extras, total: prep.price.total }, { transaction: t });
    await cap.finalize(ev, reg, t);
    return { reg };
  });
  outcomes.swept(out.swept, out.event);
  if (expiredNow) throw fail(410, 'HOLD_EXPIRED', 'Your hold expired and the place was released. Please book again.');
  outcomes.registered(out.reg, out.event);
  return sendRegistration(req, res, 200, out.reg);
};

// POST /registrations/:id/release   (give a HELD place back)
const release = async (req, res) => {
  const reg0 = await loadOwn(req);
  if (reg0.status !== R.HELD) return sendRegistration(req, res, 200, reg0);
  const out = await cap.inLock(reg0.eventId, async (t, ev) => {
    const reg = await M().Reg.findByPk(reg0.id, { transaction: t });
    if (reg.status !== R.HELD) return { reg };
    return cap.endRegistration(t, ev, reg, { by: 'user', reason: 'Released' });
  });
  outcomes.swept(out.swept, out.event);
  outcomes.promoted(out.promoted, out.event);
  return sendRegistration(req, res, 200, out.reg);
};

/** Shared cancel (student / captain). Window enforced for confirmed places. */
const cancelOwn = async (req, reg0, reason) => {
  if (!E.OPEN_REG_STATUSES.includes(reg0.status)) throw fail(409, 'NOT_CANCELLABLE', 'This registration is already closed.', { status: reg0.status });
  const event = await loadEvent(reg0.eventId);
  const slot = reg0.slotId ? await M().Slot.findByPk(reg0.slotId) : null;
  await cap.assertUserCanCancel(event, reg0, slot);
  const used = await M().Ticket.findOne({ where: { registrationId: reg0.id, status: E.TICKET_STATUS.USED }, attributes: ['id'] });
  if (used) throw fail(409, 'ALREADY_CHECKED_IN', 'You already checked in, so this registration cannot be cancelled.');
  const pct = await payments.refundPct(event, 'user');
  const out = await cap.inLock(event.id, async (t, ev) => {
    const reg = await M().Reg.findByPk(reg0.id, { transaction: t });
    if (!E.OPEN_REG_STATUSES.includes(reg.status)) throw fail(409, 'NOT_CANCELLABLE', 'This registration is already closed.', { status: reg.status });
    const r = await cap.endRegistration(t, ev, reg, { by: 'user', reason, pct });
    await audit.fromReq(req, { eventId: ev.id, registrationId: reg.id, teamId: reg.teamId, action: 'registration.cancel', details: { by: 'user', pct, refund: r.reg.refundAmount } }, t, 'user');
    return r;
  });
  outcomes.swept(out.swept, out.event);
  outcomes.ended(out.reg, out.event, { by: 'user' });
  outcomes.promoted(out.promoted, out.event);
  return out.reg;
};

// POST /registrations/:id/cancel   { reason? }
const cancel = async (req, res) => {
  const reg0 = await loadOwn(req);
  const reg = await cancelOwn(req, reg0, req.body && req.body.reason ? String(req.body.reason).slice(0, 300) : null);
  return sendRegistration(req, res, 200, reg);
};

// POST /registrations/:id/accept-offer   { paymentMode? }   (OFFERED -> pay / confirm)
const acceptOffer = async (req, res) => {
  tickets.assertConfigured();
  const reg0 = await loadOwn(req);
  if (reg0.status !== R.OFFERED) {
    if (E.LIVE_REG_STATUSES.includes(reg0.status)) return sendRegistration(req, res, 200, reg0, { replay: true });
    throw fail(410, 'OFFER_EXPIRED', 'This waitlist offer has ended.', { status: reg0.status });
  }
  const event = await loadEvent(reg0.eventId);
  const mode = await payments.pickMode(event, (req.body && req.body.paymentMode) || reg0.paymentMode, money(reg0.total));
  let gone = false;
  const out = await cap.inLock(event.id, async (t, ev) => {
    const reg = await M().Reg.findByPk(reg0.id, { transaction: t });
    if (reg.status !== R.OFFERED) { gone = true; return { reg }; }
    await reg.update({ paymentMode: mode }, { transaction: t });
    await cap.finalize(ev, reg, t);
    return { reg };
  });
  outcomes.swept(out.swept, out.event);
  if (gone) throw fail(410, 'OFFER_EXPIRED', 'This waitlist offer expired and went to the next person.');
  outcomes.registered(out.reg, out.event);
  return sendRegistration(req, res, 200, out.reg);
};

// POST /registrations/:id/decline-offer
const declineOffer = async (req, res) => {
  const reg0 = await loadOwn(req);
  if (reg0.status !== R.OFFERED) throw fail(409, 'NOT_OFFERED', 'There is no open offer on this registration.');
  const out = await cap.inLock(reg0.eventId, async (t, ev) => {
    const reg = await M().Reg.findByPk(reg0.id, { transaction: t });
    if (reg.status !== R.OFFERED) throw fail(409, 'NOT_OFFERED', 'There is no open offer on this registration.');
    return cap.endRegistration(t, ev, reg, { by: 'user', reason: 'Offer declined' });
  });
  outcomes.swept(out.swept, out.event);
  outcomes.promoted(out.promoted, out.event);
  return sendRegistration(req, res, 200, out.reg);
};

// POST /registrations/:id/request-refund   (retries a pending refund now)
const requestRefund = async (req, res) => {
  const reg = await loadOwn(req);
  if (reg.paymentStatus !== P.REFUND_PENDING) throw fail(409, 'NO_REFUND_DUE', reg.paymentStatus === P.REFUNDED ? 'This registration was already refunded.' : 'No refund is due on this registration.');
  if (reg.paymentMode === E.PAYMENT_MODE.VENUE) return res.json({ message: 'The organizer returns pay-at-venue fees at the venue desk. They have been told.', registration: await regPayload(req, reg) });
  const amt = await payments.processRefund(reg.id);
  const fresh = await M().Reg.findByPk(reg.id);
  return res.json({ refunded: amt, registration: await regPayload(req, fresh) });
};

const TABS = {
  upcoming: (now) => ({ status: { [Op.in]: [R.CONFIRMED] }, _future: now }),
  pending: () => ({ status: { [Op.in]: [R.HELD, R.PENDING_PAYMENT, R.PENDING_APPROVAL, R.OFFERED] } }),
  waitlisted: () => ({ status: R.WAITLISTED }),
  completed: (now) => ({ status: R.CONFIRMED, _past: now }),
  cancelled: () => ({ status: { [Op.in]: E.ENDED_REG_STATUSES } }),
};

// GET /my/registrations?tab=upcoming|pending|waitlisted|completed|cancelled   (team registrations included for members)
const mine = async (req, res) => {
  const tab = String(req.query.tab || 'upcoming');
  if (!Object.hasOwn(TABS, tab)) throw fail(400, 'INVALID_INPUT', 'tab must be upcoming, pending, waitlisted, completed or cancelled.', { field: 'tab' });
  const now = clock.now();
  const { _future, _past, ...where } = TABS[tab](now);
  const teamIds = (await M().Member.findAll({ where: { userId: req.user.id, status: E.MEMBER_STATUS.ACCEPTED }, attributes: ['teamId'] })).map((m) => m.teamId);
  const rows = await M().Reg.findAll({
    where: { ...where, [Op.or]: [{ userId: req.user.id }, ...(teamIds.length ? [{ teamId: { [Op.in]: teamIds } }] : [])] },
    order: [['createdAt', 'DESC']], limit: 200,
  });
  const events = await byIds(M().Event, rows.map((r) => r.eventId));
  const slots = await byIds(M().Slot, rows.map((r) => r.slotId));
  const filtered = rows.filter((r) => {
    const ev = events.get(String(r.eventId));
    if (!ev) return false;
    const end = r.slotId && slots.get(String(r.slotId)) ? slots.get(String(r.slotId)).endAt : ev.endAt;
    if (_future) return new Date(end).getTime() > now.getTime() && ev.status !== E.EVENT_STATUS.COMPLETED;
    if (_past) return new Date(end).getTime() <= now.getTime() || ev.status === E.EVENT_STATUS.COMPLETED;
    return true;
  });
  const out = [];
  for (const r of filtered.slice(0, 100)) out.push(await regPayload(req, r, { event: events.get(String(r.eventId)) }));
  res.json({ tab, registrations: out });
};

// GET /registrations/:id
const detail = async (req, res) => {
  const reg = await loadOwn(req, { allowTeamMember: true });
  res.json({ registration: await regPayload(req, reg) });
};

const ticketVisible = async (tk, userId) => {
  if (String(tk.userId) === String(userId)) return true;
  if (tk.kind === E.TICKET_KIND.TEAM && tk.teamId) {
    return !!(await M().Member.findOne({ where: { teamId: tk.teamId, userId, status: E.MEMBER_STATUS.ACCEPTED }, attributes: ['id'] }));
  }
  return false;
};

const ticketPayload = async (req, tk) => {
  const { Event, Slot, Reg, Team } = M();
  const [event, slot, reg, team] = await Promise.all([Event.findByPk(tk.eventId), tk.slotId ? Slot.findByPk(tk.slotId) : null, Reg.findByPk(tk.registrationId), tk.teamId ? Team.findByPk(tk.teamId) : null]);
  const holder = tk.userId ? (await usersById([tk.userId])).get(String(tk.userId)) : null;
  return S.ticketOwn(req, tk, { event, slot, reg, team, holderName: holder && holder.name, token: tickets.tokenFor(tk) });
};

// GET /my/tickets?status=active|all
const myTickets = async (req, res) => {
  const teamIds = (await M().Member.findAll({ where: { userId: req.user.id, status: E.MEMBER_STATUS.ACCEPTED }, attributes: ['teamId'] })).map((m) => m.teamId);
  const where = { [Op.or]: [{ userId: req.user.id }, ...(teamIds.length ? [{ teamId: { [Op.in]: teamIds }, kind: E.TICKET_KIND.TEAM }] : [])] };
  if (req.query.status !== 'all') where.status = { [Op.in]: [E.TICKET_STATUS.ACTIVE, E.TICKET_STATUS.USED] };
  const rows = await M().Ticket.findAll({ where, order: [['createdAt', 'DESC']], limit: 100 });
  const out = [];
  for (const tk of rows) out.push(await ticketPayload(req, tk));
  res.json({ tickets: out, ticketsReady: tickets.configured() });
};

// GET /tickets/:id
const ticketDetail = async (req, res) => {
  const id = assertUuid(req.params.id, 'ticket');
  const tk = await M().Ticket.findByPk(id);
  if (!tk || !(await ticketVisible(tk, req.user.id))) throw fail(404, 'NOT_FOUND', 'This ticket was not found.');
  tickets.assertConfigured();
  res.json({ ticket: await ticketPayload(req, tk) });
};

// POST /registrations/:id/pay/razorpay-order   (503 PAYMENT_NOT_CONFIGURED until Razorpay is set up)
const createOrder = async (req, res) => {
  await payments.razorpay.assertConfigured();
  const reg = await loadOwn(req);
  if (reg.paymentMode !== E.PAYMENT_MODE.ONLINE || reg.status !== R.PENDING_PAYMENT) throw fail(409, 'NOT_AWAITING_PAYMENT', 'This registration is not waiting for an online payment.', { status: reg.status });
  if (reg.paymentExpiresAt && new Date(reg.paymentExpiresAt).getTime() <= clock.nowMs()) throw fail(410, 'PAYMENT_EXPIRED', 'The payment time ran out. Please register again.');
  const Pay = M().Payment;
  let pay = await Pay.findOne({ where: { registrationId: reg.id, status: E.PAY_ROW_STATUS.CREATED }, order: [['createdAt', 'DESC']] });
  if (!pay) {
    const amountPaise = toPaise(reg.total);
    const order = await payments.razorpay.createOrder({ amountPaise, receipt: reg.code, notes: { registrationId: reg.id, eventId: reg.eventId } });
    if (order.amount !== amountPaise) throw fail(502, 'PAYMENT_PROVIDER_ERROR', 'The payment amount did not match. Please try again.');
    pay = await Pay.create({ registrationId: reg.id, eventId: reg.eventId, userId: reg.userId, provider: E.PAYMENT_PROVIDER.RAZORPAY, amountPaise, currency: 'INR', status: E.PAY_ROW_STATUS.CREATED, providerOrderId: order.id });
  }
  res.json({ provider: 'RAZORPAY', keyId: payments.razorpay.keys().keyId, orderId: pay.providerOrderId, amountPaise: pay.amountPaise, currency: pay.currency, payBy: iso(reg.paymentExpiresAt), registrationId: reg.id, note: 'The registration is confirmed only after Razorpay tells ZCS the payment was captured.' });
};

// GET /registrations/:id/payment   (status poll; the app's success screen is never proof)
const paymentStatus = async (req, res) => {
  const reg = await loadOwn(req);
  res.json({ registrationId: reg.id, status: reg.status, payment: S.paymentBlock(reg), confirmed: reg.status === R.CONFIRMED });
};

module.exports = { register, hold, confirm, release, cancel, cancelOwn, acceptOffer, declineOffer, requestRefund, mine, detail, myTickets, ticketDetail, createOrder, paymentStatus, regPayload };
