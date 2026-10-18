// Capacity engine. Every unit-changing write runs inside withEventLock(eventId) (in-process FIFO + write
// transaction + Postgres row lock on the event) with the partial unique indexes underneath, and the
// whole lock pass is retried (retryOnConflict) if another process won a unit / code first.
//  capacityKey = slotId (SLOT events) or eventId (INDIVIDUAL seats, TEAM places = maxTeams).
//  Each live registration (HELD, PENDING_PAYMENT, PENDING_APPROVAL, CONFIRMED, OFFERED) owns the lowest
//  free unitNo in 1..capacity; counters are recomputed from the rows inside the same transaction.
//  Stale holds / payment windows / waitlist offers are expired lazily at the start of every lock pass
//  (and by the lifecycle job); freed units go to the waitlist FIFO (waitlistAt) before any newcomer.
//  Free / pay-at-venue registrations are confirmed at once (or PENDING_APPROVAL, keeping the unit, when
//  the organizer approves registrations); Wallet debits inside the transaction; ONLINE waits in
//  PENDING_PAYMENT for a verified webhook. Waitlist promotion: FREE / venue -> confirmed directly,
//  Wallet / online -> OFFERED for waitlistOfferMinutes, then the next person.
const { Op } = require('sequelize');
const { getModel } = require('../index');
const E = require('../enums');
const { fail, money, newRegCode, isUniqueError } = require('./util');
const clock = require('./clock');
const { withEventLock, retryOnConflict } = require('./locks');
const tickets = require('./tickets');
const payments = require('./payments');
const flag = require('./flag');
const { questionsSnapshot } = require('./validate');

const R = E.REG_STATUS;
const P = E.PAYMENT_STATUS;
const PM = E.PAYMENT_MODE;

const M = () => ({ Event: getModel('CeEvent'), Slot: getModel('CeSlot'), Reg: getModel('CeRegistration'), Team: getModel('CeTeam'), Member: getModel('CeTeamMember') });

const capacityOf = (event, slot) => {
  if (slot) return Math.max(0, Number(slot.capacity) || 0);
  if (event.format === E.FORMAT.TEAM) return Math.max(0, Number(event.maxTeams) || 0);
  return Math.max(0, Number(event.capacity) || 0);
};
const startOf = (event, slot) => new Date((slot && slot.startAt) || event.startAt);
const endOf = (event, slot) => new Date((slot && slot.endAt) || event.endAt);

/** Registration window + status checks (event row read inside the lock). */
const assertOpen = (event, slot, now = clock.nowMs()) => {
  if (!event || ![E.EVENT_STATUS.PUBLISHED].includes(event.status)) {
    if (event && event.status === E.EVENT_STATUS.CANCELLED) throw fail(409, 'EVENT_CANCELLED', 'This event was cancelled.');
    if (event && event.status === E.EVENT_STATUS.COMPLETED) throw fail(409, 'REGISTRATION_CLOSED', 'This event is over.');
    throw fail(404, 'NOT_FOUND', 'This event was not found.');
  }
  if (event.regOpensAt && new Date(event.regOpensAt).getTime() > now) throw fail(409, 'REGISTRATION_NOT_OPEN', 'Registration has not opened yet.', { opensAt: new Date(event.regOpensAt).toISOString() });
  if (event.regClosesAt && new Date(event.regClosesAt).getTime() <= now) throw fail(409, 'REGISTRATION_CLOSED', 'Registration is closed.');
  if (startOf(event, slot).getTime() <= now) throw fail(409, 'REGISTRATION_CLOSED', slot ? 'This slot has already started.' : 'This event has already started.');
  if (slot && slot.status !== 'OPEN') throw fail(409, 'SLOT_CLOSED', 'This slot is not available.');
};

const uniqueRegCode = async (t) => {
  const { Reg } = M();
  for (let i = 0; i < 5; i++) {
    const c = newRegCode();
    if (!(await Reg.findOne({ where: { code: c }, attributes: ['id'], transaction: t }))) return c;
  }
  return newRegCode();
};

/** Expires stale HELD / PENDING_PAYMENT / OFFERED rows of this event (inside t). */
const expireStale = async (event, t) => {
  const { Reg } = M();
  const now = clock.now();
  const stale = await Reg.findAll({
    where: {
      eventId: event.id,
      [Op.or]: [
        { status: R.HELD, holdExpiresAt: { [Op.lte]: now } },
        { status: R.PENDING_PAYMENT, paymentExpiresAt: { [Op.lte]: now } },
        { status: R.OFFERED, offerExpiresAt: { [Op.lte]: now } },
      ],
    },
    transaction: t,
  });
  const done = [];
  for (const r of stale) {
    const from = r.status;
    const cols = { status: R.EXPIRED, expiredAt: now };
    if (from === R.PENDING_PAYMENT) cols.paymentStatus = P.TIMEOUT;
    if (from === R.OFFERED && r.paymentStatus === P.NONE) cols.paymentStatus = P.NONE;
    const [n] = await Reg.update(cols, { where: { id: r.id, status: from }, transaction: t });
    if (n) { Object.assign(r, cols); r.setDataValue('_from', from); done.push(r); }
    if (n && r.teamId) await M().Team.update({ status: E.TEAM_STATUS.FORMING, registrationId: null }, { where: { id: r.teamId, registrationId: r.id }, transaction: t });
  }
  return done;
};

const liveUnits = async (key, t) => {
  const rows = await M().Reg.findAll({ where: { capacityKey: key, status: { [Op.in]: E.LIVE_REG_STATUSES } }, attributes: ['unitNo'], transaction: t });
  return new Set(rows.map((r) => Number(r.unitNo)));
};
const lowestFree = async (key, cap, t) => {
  const used = await liveUnits(key, t);
  for (let i = 1; i <= cap; i++) if (!used.has(i)) return i;
  return null;
};

/** Counters on the event + its slots from the rows (inside t). Throws if capacity would be exceeded. */
const recount = async (event, t) => {
  const { Reg, Slot, Event } = M();
  const rows = await Reg.findAll({ where: { eventId: event.id, status: { [Op.in]: [...E.LIVE_REG_STATUSES, R.WAITLISTED] } }, attributes: ['status', 'slotId', 'capacityKey'], transaction: t });
  const by = new Map();
  for (const r of rows) {
    const k = String(r.capacityKey);
    const c = by.get(k) || { live: 0, confirmed: 0, waiting: 0 };
    if (r.status === R.WAITLISTED) c.waiting++;
    else { c.live++; if (r.status === R.CONFIRMED) c.confirmed++; }
    by.set(k, c);
  }
  if (event.format === E.FORMAT.SLOT) {
    const slots = await Slot.findAll({ where: { eventId: event.id }, transaction: t });
    let live = 0; let conf = 0; let wait = 0;
    for (const s of slots) {
      const c = by.get(String(s.id)) || { live: 0, confirmed: 0, waiting: 0 };
      if (c.live > capacityOf(event, s) && s.status === 'OPEN') throw fail(500, 'CAPACITY_INVARIANT', 'Capacity check failed. Please try again.');
      live += c.live; conf += c.confirmed; wait += c.waiting;
      if (s.unitsLive !== c.live || s.unitsConfirmed !== c.confirmed || s.waitlistCount !== c.waiting) {
        await Slot.update({ unitsLive: c.live, unitsConfirmed: c.confirmed, waitlistCount: c.waiting }, { where: { id: s.id }, transaction: t });
      }
    }
    await Event.update({ unitsLive: live, unitsConfirmed: conf, waitlistCount: wait }, { where: { id: event.id }, transaction: t });
    Object.assign(event, { unitsLive: live, unitsConfirmed: conf, waitlistCount: wait });
    return;
  }
  const c = by.get(String(event.id)) || { live: 0, confirmed: 0, waiting: 0 };
  if (c.live > capacityOf(event, null) && event.status === E.EVENT_STATUS.PUBLISHED) throw fail(500, 'CAPACITY_INVARIANT', 'Capacity check failed. Please try again.');
  await Event.update({ unitsLive: c.live, unitsConfirmed: c.confirmed, waitlistCount: c.waiting }, { where: { id: event.id }, transaction: t });
  Object.assign(event, { unitsLive: c.live, unitsConfirmed: c.confirmed, waitlistCount: c.waiting });
};

/**
 * Moves a registration that owns a unit to its next state by payment mode (inside t). Mutates reg.
 * Returns the new status. CONFIRMED issues tickets in the same transaction.
 */
const finalize = async (event, reg, t) => {
  const s = await flag.readSettings();
  const now = clock.now();
  const cols = {};
  const total = money(reg.total);
  if (!(total > 0) || reg.paymentMode === PM.NONE) {
    cols.paymentMode = PM.NONE; cols.paymentStatus = P.NONE;
    cols.status = event.approvalRequired ? R.PENDING_APPROVAL : R.CONFIRMED;
  } else if (reg.paymentMode === PM.VENUE) {
    cols.paymentStatus = P.DUE_AT_VENUE;
    cols.status = event.approvalRequired ? R.PENDING_APPROVAL : R.CONFIRMED;
  } else if (reg.paymentMode === PM.WALLET) {
    const debited = await payments.debitWallet(reg.userId, total, t, { type: 'EVENT_REGISTRATION', id: reg.id });
    cols.walletDebited = debited; cols.paymentStatus = P.SUCCESS; cols.paidAt = now;
    cols.status = event.approvalRequired ? R.PENDING_APPROVAL : R.CONFIRMED;
  } else if (reg.paymentMode === PM.ONLINE) {
    cols.status = R.PENDING_PAYMENT; cols.paymentStatus = P.PENDING;
    cols.paymentExpiresAt = new Date(now.getTime() + s.paymentMinutes * 60 * 1000);
  } else {
    throw fail(400, 'INVALID_INPUT', 'Unknown payment mode.');
  }
  cols.holdExpiresAt = null; cols.offerExpiresAt = null;
  if (cols.status === R.CONFIRMED) cols.confirmedAt = now;
  await reg.update(cols, { transaction: t });
  if (reg.status === R.CONFIRMED) await tickets.issueFor(reg, event, t);
  return reg.status;
};

/** Fills free units of `key` from its waitlist (FIFO). Returns the promoted rows (inside t). */
const promote = async (event, key, t) => {
  if (!event.waitlistEnabled || event.status !== E.EVENT_STATUS.PUBLISHED) return [];
  // Without a ticket secret (production misconfiguration) nobody can be confirmed: leave the waitlist as is
  // instead of failing the whole lock pass (expiries must still go through).
  if (!tickets.configured()) return [];
  const { Reg, Slot } = M();
  const slot = String(key) === String(event.id) ? null : await Slot.findByPk(key, { transaction: t });
  if (slot && slot.status !== 'OPEN') return [];
  if (startOf(event, slot).getTime() <= clock.nowMs()) return [];
  const cap = capacityOf(event, slot);
  const s = await flag.readSettings();
  const out = [];
  for (let guard = 0; guard < 500; guard++) {
    const unit = await lowestFree(key, cap, t);
    if (!unit) break;
    const next = await Reg.findOne({ where: { capacityKey: key, status: R.WAITLISTED }, order: [['waitlistAt', 'ASC'], ['createdAt', 'ASC']], transaction: t });
    if (!next) break;
    const needsOffer = money(next.total) > 0 && [PM.WALLET, PM.ONLINE].includes(next.paymentMode);
    if (needsOffer) {
      const minutes = Number(event.waitlistOfferMinutes) || s.waitlistOfferMinutes;
      await next.update({ status: R.OFFERED, unitNo: unit, offerExpiresAt: new Date(clock.nowMs() + minutes * 60 * 1000) }, { transaction: t });
    } else {
      await next.update({ unitNo: unit }, { transaction: t });
      await finalize(event, next, t);
    }
    if (next.teamId) await M().Team.update({ status: E.TEAM_STATUS.SUBMITTED, registrationId: next.id }, { where: { id: next.teamId }, transaction: t });
    out.push(next);
  }
  return out;
};

/** Expire + promote every pool of an event (inside t). */
const sweep = async (event, t) => {
  const expired = await expireStale(event, t);
  // Only pools that just freed a unit or have people waiting need a promotion pass.
  const keys = new Set(expired.map((r) => String(r.capacityKey)));
  const waiting = await M().Reg.findAll({ where: { eventId: event.id, status: R.WAITLISTED }, attributes: ['capacityKey'], group: ['capacityKey'], transaction: t });
  waiting.forEach((w) => keys.add(String(w.capacityKey)));
  const promoted = [];
  for (const k of keys) promoted.push(...await promote(event, k, t));
  if (expired.length || promoted.length) await recount(event, t);
  return { expired, promoted };
};

/**
 * Takes a unit (or a waitlist place) for a new registration inside the event lock.
 * input: { event, slot, userId, teamId, type, answers, rulesVersion, paymentMode, price, idempotencyKey,
 *          holdOnly, joinWaitlist }
 */
const allocate = async (t, input) => {
  const { event, slot } = input;
  const { Reg } = M();
  const s = await flag.readSettings();
  const key = slot ? slot.id : event.id;
  const cap = capacityOf(event, slot);
  const now = clock.now();
  const base = {
    code: await uniqueRegCode(t), eventId: event.id, slotId: slot ? slot.id : null, teamId: input.teamId || null, capacityKey: key,
    type: input.type, userId: input.userId, answers: input.answers || null,
    questionsSnapshot: input.answers ? questionsSnapshot(event.questions) : null, rulesAcceptedAt: input.rulesVersion ? now : null,
    rulesVersion: input.rulesVersion || null, amount: input.price.amount, extras: input.price.extras, total: input.price.total,
    paymentMode: input.paymentMode, paymentStatus: P.NONE, idempotencyKey: input.idempotencyKey || null,
  };
  const unit = await lowestFree(key, cap, t);
  if (!unit) {
    if (event.waitlistEnabled && input.joinWaitlist !== false) {
      const reg = await Reg.create({ ...base, status: R.WAITLISTED, unitNo: null, waitlistAt: now }, { transaction: t });
      return { reg, waitlisted: true };
    }
    const code = event.format === E.FORMAT.TEAM ? 'EVENT_FULL' : (slot ? 'SLOT_FULL' : 'EVENT_FULL');
    throw fail(409, code, slot ? 'This slot is full.' : (event.format === E.FORMAT.TEAM ? 'All team places are taken.' : 'This event is full.'), { waitlistEnabled: !!event.waitlistEnabled });
  }
  if (input.holdOnly) {
    const reg = await Reg.create({ ...base, status: R.HELD, unitNo: unit, holdExpiresAt: new Date(now.getTime() + s.holdMinutes * 60 * 1000) }, { transaction: t });
    return { reg, held: true };
  }
  const reg = await Reg.create({ ...base, status: R.HELD, unitNo: unit, holdExpiresAt: new Date(now.getTime() + s.holdMinutes * 60 * 1000) }, { transaction: t });
  await finalize(event, reg, t);
  return { reg };
};

/** Runs fn(t, event) in the event lock with the lazy sweep first; retried on unique races. */
const inLock = (eventId, fn) => retryOnConflict(() => withEventLock(eventId, async (t, event) => {
  const swept = await sweep(event, t);
  const result = await fn(t, event, swept);
  await recount(event, t);
  return { ...result, swept, event };
}));

/** Ends a registration (cancel / reject) inside t: unit freed, tickets cancelled, waitlist promoted. */
const endRegistration = async (t, event, reg, { status = R.CANCELLED, by = 'user', reason = null, pct = 100 } = {}) => {
  const now = clock.now();
  const cols = { status, ...payments.endColumns(reg, pct) };
  if (status === R.CANCELLED) Object.assign(cols, { cancelledAt: now, cancelledBy: by, cancelReason: reason ? String(reason).slice(0, 500) : null });
  if (status === R.REJECTED) cols.rejectedReason = reason ? String(reason).slice(0, 500) : null;
  if (status === R.EXPIRED) cols.expiredAt = now;
  const from = reg.status;
  const [n] = await M().Reg.update(cols, { where: { id: reg.id, status: from }, transaction: t });
  if (!n) throw Object.assign(new Error('registration changed'), { code: 'CE_RETRY' });
  Object.assign(reg, cols);
  await tickets.cancelFor(reg.id, t);
  if (reg.teamId) await M().Team.update({ status: E.TEAM_STATUS.FORMING, registrationId: null }, { where: { id: reg.teamId, registrationId: reg.id }, transaction: t });
  const promoted = E.LIVE_REG_STATUSES.includes(from) ? await promote(event, reg.capacityKey, t) : [];
  return { reg, promoted };
};

/** Cancellation window check for a student's own cancellation. */
const assertUserCanCancel = async (event, reg, slot) => {
  if (reg.status !== R.CONFIRMED && reg.status !== R.PENDING_APPROVAL) return;
  const s = await flag.readSettings();
  const pol = event.cancellationPolicy && typeof event.cancellationPolicy === 'object' ? event.cancellationPolicy : {};
  const hours = Number.isFinite(Number(pol.userCancelUntilHours)) && pol.userCancelUntilHours !== null && pol.userCancelUntilHours !== '' ? Number(pol.userCancelUntilHours) : s.defaultUserCancelUntilHours;
  const deadline = startOf(event, slot).getTime() - hours * 60 * 60 * 1000;
  if (clock.nowMs() > deadline) {
    throw fail(409, 'CANCEL_WINDOW_CLOSED', hours > 0 ? `Cancellations close ${hours} hour${hours === 1 ? '' : 's'} before the start.` : 'This registration can no longer be cancelled.', { cancelUntil: new Date(deadline).toISOString() });
  }
};

const isUnique = isUniqueError;

module.exports = {
  capacityOf, startOf, endOf, assertOpen, expireStale, lowestFree, recount, finalize, promote, sweep, allocate, inLock, endRegistration,
  assertUserCanCancel, isUnique,
};
