// After-commit side effects of registration state changes: notifications (CE_* types) + immediate refund
// attempts. Called by controllers and the lifecycle job with the rows a lock pass returned.
const E = require('../enums');
const notify = require('./notify');
const payments = require('./payments');

const R = E.REG_STATUS;
const N = E.NOTIFY;

const title = (event) => (event && event.title ? String(event.title).slice(0, 60) : 'your event');

/** A registration reached `reg.status` (fresh create, confirm, approval, payment). */
const registered = (reg, event) => {
  const t = title(event);
  if (reg.status === R.CONFIRMED) {
    const team = reg.type === E.REG_TYPE.TEAM;
    notify.registrationNotice(reg, {
      title: team ? 'Team registered 🎉' : 'Registration confirmed 🎟️',
      body: `${team ? 'Your team is in for' : 'You are in for'} ${t}. Your ticket is ready in My Tickets.`,
      type: team ? N.TEAM_REGISTERED : N.REGISTRATION_CONFIRMED,
    });
  } else if (reg.status === R.PENDING_APPROVAL) {
    notify.registrationNotice(reg, { title: 'Registration received', body: `The organizer of ${t} will review it. Your place is kept meanwhile.`, type: N.REGISTRATION_PENDING_APPROVAL });
  } else if (reg.status === R.WAITLISTED) {
    notify.registrationNotice(reg, { title: 'You are on the waitlist', body: `${t} is full. We will tell you if a place opens.`, type: N.WAITLISTED });
  } else {
    notify.registrationNotice(reg, {});
  }
};

const promoted = (list, event) => {
  for (const reg of list || []) {
    const t = title(event);
    if (reg.status === R.OFFERED) {
      notify.registrationNotice(reg, { title: 'A place opened for you ⏳', body: `Confirm your place for ${t} before the offer expires.`, type: N.WAITLIST_OFFER });
    } else {
      notify.registrationNotice(reg, {
        title: 'Off the waitlist 🎉',
        body: reg.status === R.CONFIRMED ? `You got a place for ${t}. Your ticket is ready.` : `You got a place for ${t}, waiting for organizer approval.`,
        type: N.WAITLIST_PROMOTED,
      });
    }
  }
};

const expired = (list, event) => {
  for (const reg of list || []) {
    const from = reg.getDataValue ? reg.getDataValue('_from') : null;
    const t = title(event);
    if (from === R.PENDING_PAYMENT) notify.registrationNotice(reg, { title: 'Payment time ran out', body: `Your place for ${t} was released because the payment did not complete.`, type: N.PAYMENT_EXPIRED });
    else if (from === R.OFFERED) notify.registrationNotice(reg, { title: 'Waitlist offer expired', body: `The place for ${t} went to the next person on the waitlist.`, type: N.OFFER_EXPIRED });
    else notify.registrationNotice(reg, { title: 'Booking hold expired', body: `Your held place for ${t} was released because it was not confirmed in time.`, type: N.HOLD_EXPIRED });
  }
};

const swept = (sw, event) => {
  if (!sw) return;
  expired(sw.expired, event);
  promoted(sw.promoted, event);
};

/** Ended registration: tell the student, try the refund now (the job retries failures). */
const ended = (reg, event, { by = 'user', reason } = {}) => {
  const t = title(event);
  if (reg.status === R.REJECTED) {
    notify.registrationNotice(reg, { title: 'Registration not approved', body: `The organizer of ${t} could not accept your registration${reason ? `: ${String(reason).slice(0, 120)}` : '.'}`, type: N.REGISTRATION_REJECTED });
  } else if (by !== 'user') {
    notify.registrationNotice(reg, { title: 'Registration cancelled', body: `Your registration for ${t} was cancelled${reason ? `: ${String(reason).slice(0, 120)}` : '.'}`, type: N.REGISTRATION_CANCELLED });
  } else notify.registrationNotice(reg, {});
  if (reg.paymentStatus === E.PAYMENT_STATUS.REFUND_PENDING) refundNow(reg);
};

const refundNow = (reg) => {
  notify.track(Promise.resolve().then(async () => {
    const amt = await payments.processRefund(reg.id);
    if (amt > 0) notify.toUsers([reg.userId], 'Refund done', `₹${amt} was refunded${reg.paymentMode === E.PAYMENT_MODE.WALLET ? ' to your ZenWe Wallet' : ' to your payment method'}.`, { type: N.REFUND_DONE, registrationId: reg.id, eventId: reg.eventId });
  }).catch((err) => console.warn('[CAMPUS_EVENTS_REFUND_WARN]', err.message)));
};

module.exports = { registered, promoted, expired, swept, ended, refundNow };
