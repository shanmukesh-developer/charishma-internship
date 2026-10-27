// Campus Events lifecycle job (every 60 s, 'campusEvents.lifecycle' in jobs/index.js through
// utils/jobs.runExclusive, quietWhenIdle). runCampusEventJobs(now) is exported for tests.
//  1. expired holds / payment windows / waitlist offers -> EXPIRED, freed places -> waitlist (per event, in the lock)
//  2. APPROVED at publishAt -> PUBLISHED
//  3. PUBLISHED after endAt -> COMPLETED
//  4. team invitations past expiresAt -> EXPIRED
//  5. reminders 24 h and 1 h before the start (event or slot), each sent once (sent-at columns)
//  6. registration deadline notice (24 h before regClosesAt) to captains of unsubmitted teams + open offers, once
//  7. REFUND_PENDING (wallet / online) -> retried exactly-once via payments.processRefund
//  8. retention: answers of events that ended more than retentionDays ago are erased (once per event)
// Cheap when idle: a few indexed lookups and out (the case while the feature is off and unused).
const { Op } = require('sequelize');
const { getModel } = require('./index');
const E = require('./enums');
const clock = require('./services/clock');

const R = E.REG_STATUS;
const ES = E.EVENT_STATUS;
const HOUR = 60 * 60 * 1000;

const runCampusEventJobs = async (now = clock.now()) => {
  const Event = getModel('CeEvent');
  const Reg = getModel('CeRegistration');
  const Member = getModel('CeTeamMember');
  if (!Event || !Reg || !Member) return { skipped: true };
  const flag = require('./services/flag');
  const s = await flag.readSettings();
  const cutoff = new Date(now.getTime() - s.retentionDays * 24 * HOUR);
  const busy = await Event.findOne({ where: { status: { [Op.in]: [ES.APPROVED, ES.PUBLISHED] } }, attributes: ['id'] })
    || await Reg.findOne({ where: { [Op.or]: [{ status: { [Op.in]: [R.HELD, R.PENDING_PAYMENT, R.OFFERED] } }, { paymentStatus: E.PAYMENT_STATUS.REFUND_PENDING }] }, attributes: ['id'] })
    || await Member.findOne({ where: { status: E.MEMBER_STATUS.INVITED }, attributes: ['id'] })
    || await Event.findOne({ where: { status: { [Op.in]: [ES.COMPLETED, ES.CANCELLED] }, retentionPurgedAt: null, endAt: { [Op.lte]: cutoff } }, attributes: ['id'] });
  if (!busy) return { idle: true };

  const cap = require('./services/capacity');
  const notify = require('./services/notify');
  const outcomes = require('./services/outcomes');
  const payments = require('./services/payments');
  const audit = require('./services/audit');
  const Slot = getModel('CeSlot');
  const Team = getModel('CeTeam');
  const N = E.NOTIFY;
  const out = { expired: 0, promoted: 0, published: 0, completed: 0, invitationsExpired: 0, reminders24: 0, reminders1: 0, deadlineNotices: 0, refunds: 0, purged: 0, errors: 0 };
  const safe = async (fn) => {
    try { await fn(); } catch (err) { out.errors++; console.warn('[CAMPUS_EVENTS_JOB_WARN]', err.message); }
  };

  // 1. Expiries (+ waitlist promotion) per event.
  const stale = await Reg.findAll({
    where: { [Op.or]: [{ status: R.HELD, holdExpiresAt: { [Op.lte]: now } }, { status: R.PENDING_PAYMENT, paymentExpiresAt: { [Op.lte]: now } }, { status: R.OFFERED, offerExpiresAt: { [Op.lte]: now } }] },
    attributes: ['eventId'], limit: 1000,
  });
  for (const eventId of [...new Set(stale.map((r) => String(r.eventId)))]) {
    await safe(async () => {
      const r = await cap.inLock(eventId, async () => ({}));
      out.expired += r.swept.expired.length;
      out.promoted += r.swept.promoted.length;
      outcomes.swept(r.swept, r.event);
    });
  }

  // 2. Scheduled publish.
  const due = await Event.findAll({ where: { status: ES.APPROVED, publishAt: { [Op.lte]: now } }, limit: 200 });
  for (const ev of due) {
    await safe(async () => {
      const [n] = await Event.update({ status: ES.PUBLISHED, publishedAt: now }, { where: { id: ev.id, status: ES.APPROVED } });
      if (!n) return;
      out.published++;
      await audit.write({ eventId: ev.id, action: 'event.publish_scheduled', details: {} });
      notify.toOrganizer(ev, 'Your event is live 🎉', `${ev.title} is now visible to students.`, N.EVENT_PUBLISHED);
      notify.eventChanged(ev.id);
    });
  }

  // 3. Completed.
  const ended = await Event.findAll({ where: { status: ES.PUBLISHED, endAt: { [Op.lte]: now } }, attributes: ['id', 'title', 'organizerUserId', 'status'], limit: 200 });
  for (const ev of ended) {
    await safe(async () => {
      const r = await cap.inLock(ev.id, async (t, e) => {
        if (e.status !== ES.PUBLISHED) return { done: false };
        await e.update({ status: ES.COMPLETED, completedAt: now }, { transaction: t });
        // Places that never completed (holds, unpaid, offers, waitlist) end with the event.
        const open = await Reg.findAll({ where: { eventId: e.id, status: { [Op.in]: [R.HELD, R.PENDING_PAYMENT, R.OFFERED, R.WAITLISTED, R.PENDING_APPROVAL] } }, transaction: t });
        const closed = [];
        for (const reg of open) closed.push((await cap.endRegistration(t, e, reg, { status: R.EXPIRED, by: 'system', pct: 100 })).reg);
        return { done: true, closed };
      });
      if (r.done) {
        out.completed++;
        for (const reg of r.closed) if (reg.paymentStatus === E.PAYMENT_STATUS.REFUND_PENDING) outcomes.refundNow(reg);
        notify.eventChanged(ev.id);
      }
    });
  }

  // 4. Invitations.
  const [inv] = await Member.update({ status: E.MEMBER_STATUS.EXPIRED }, { where: { status: E.MEMBER_STATUS.INVITED, expiresAt: { [Op.lte]: now } } });
  out.invitationsExpired += inv || 0;

  // 5. Reminders (event level for INDIVIDUAL / TEAM, slot level for SLOT).
  const confirmedOnly = [R.CONFIRMED];
  const remind = async (kind) => {
    const col = kind === 24 ? 'reminder24SentAt' : 'reminder1SentAt';
    const lead = kind * HOUR;
    const lower = kind === 24 ? new Date(now.getTime() + HOUR) : now; // the 1 h reminder covers the last hour
    const evs = await Event.findAll({ where: { status: ES.PUBLISHED, format: { [Op.ne]: E.FORMAT.SLOT }, [col]: null, startAt: { [Op.lte]: new Date(now.getTime() + lead), [Op.gt]: lower } }, limit: 200 });
    for (const ev of evs) {
      await safe(async () => {
        const [n] = await Event.update({ [col]: now }, { where: { id: ev.id, [col]: null } });
        if (!n) return;
        out[kind === 24 ? 'reminders24' : 'reminders1']++;
        notify.eventBroadcast(ev, { title: kind === 24 ? `Tomorrow: ${ev.title}` : `Starting soon: ${ev.title}`, body: `${kind === 24 ? 'Starts within 24 hours' : 'Starts within the hour'} at ${ev.venue || 'the venue'}. Keep your ticket ready.`, type: kind === 24 ? N.REMINDER_24H : N.REMINDER_1H, statuses: confirmedOnly });
      });
    }
    const slots = await Slot.findAll({ where: { status: 'OPEN', [col]: null, startAt: { [Op.lte]: new Date(now.getTime() + lead), [Op.gt]: lower } }, limit: 500 });
    for (const sl of slots) {
      await safe(async () => {
        const ev = await Event.findByPk(sl.eventId);
        if (!ev || ev.status !== ES.PUBLISHED) return;
        const [n] = await Slot.update({ [col]: now }, { where: { id: sl.id, [col]: null } });
        if (!n) return;
        out[kind === 24 ? 'reminders24' : 'reminders1']++;
        notify.eventBroadcast(ev, { title: kind === 24 ? `Tomorrow: ${ev.title}` : `Your slot starts soon: ${ev.title}`, body: `${sl.label || 'Your slot'} at ${ev.venue || 'the venue'}. Keep your ticket ready.`, type: kind === 24 ? N.REMINDER_24H : N.REMINDER_1H, statuses: confirmedOnly, slotId: sl.id, dedupe: `${sl.id}:${kind}` });
      });
    }
  };
  await remind(24);
  await remind(1);

  // 6. Registration deadline notices (once per event).
  const closing = await Event.findAll({ where: { status: ES.PUBLISHED, deadlineNoticeSentAt: null, regClosesAt: { [Op.lte]: new Date(now.getTime() + 24 * HOUR), [Op.gt]: now } }, limit: 200 });
  for (const ev of closing) {
    await safe(async () => {
      const [n] = await Event.update({ deadlineNoticeSentAt: now }, { where: { id: ev.id, deadlineNoticeSentAt: null } });
      if (!n) return;
      const captains = ev.format === E.FORMAT.TEAM ? (await Team.findAll({ where: { eventId: ev.id, status: E.TEAM_STATUS.FORMING }, attributes: ['captainUserId'] })).map((t) => t.captainUserId) : [];
      const offered = (await Reg.findAll({ where: { eventId: ev.id, status: { [Op.in]: [R.OFFERED, R.HELD, R.PENDING_PAYMENT] } }, attributes: ['userId'] })).map((r) => r.userId);
      const who = [...new Set([...captains, ...offered].map(String))];
      if (!who.length) return;
      out.deadlineNotices++;
      notify.toUsers(who, 'Registration closes soon ⏰', `${ev.title}: registration closes within 24 hours. Finish your ${ev.format === E.FORMAT.TEAM ? 'team registration' : 'booking'}.`, { type: N.DEADLINE_SOON, eventId: ev.id });
    });
  }

  // 7. Refund retries.
  const pending = await Reg.findAll({ where: { paymentStatus: E.PAYMENT_STATUS.REFUND_PENDING, paymentMode: { [Op.in]: [E.PAYMENT_MODE.WALLET, E.PAYMENT_MODE.ONLINE] }, refundAttempts: { [Op.lt]: 50 } }, attributes: ['id', 'userId', 'eventId', 'paymentMode'], limit: 200 });
  for (const r of pending) {
    await safe(async () => {
      const amt = await payments.processRefund(r.id);
      if (amt > 0) {
        out.refunds++;
        notify.toUsers([r.userId], 'Refund done', `₹${amt} was refunded${r.paymentMode === E.PAYMENT_MODE.WALLET ? ' to your ZCS Wallet' : ''}.`, { type: N.REFUND_DONE, registrationId: r.id, eventId: r.eventId });
      }
    });
  }

  // 8. Retention purge of answers (privacy).
  const old = await Event.findAll({ where: { status: { [Op.in]: [ES.COMPLETED, ES.CANCELLED] }, retentionPurgedAt: null, endAt: { [Op.lte]: cutoff } }, attributes: ['id'], limit: 100 });
  for (const ev of old) {
    await safe(async () => {
      await Reg.update({ answers: null }, { where: { eventId: ev.id } });
      await Event.update({ retentionPurgedAt: now }, { where: { id: ev.id } });
      await audit.write({ eventId: ev.id, action: 'retention.purge_answers', details: { days: s.retentionDays } });
      out.purged++;
    });
  }
  return out;
};

module.exports = { runCampusEventJobs };
