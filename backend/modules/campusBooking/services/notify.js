// In-Campus Booking notifications. Never throws, never blocks the request (fire-and-forget, after the write).
//  Student: push + in-app Notification row (campus pushToUsers -> utils/push, category 'orders') with
//           data { type: 'CAMPUS_BOOKING', bookingId, status } (no orderId: the inbox must not open delivery
//           tracking), and an ids-only socket nudge `campusbooking:changed` { id, status } to room user_<id>.
//  Stall:   push to the stall's ZCS Campus Stall devices only (utils/storePush, tagged per booking so reminders replace
//           each other) and `campusbooking:changed` { id, status } to room restaurant_<id>.
//  Admin:   admin:changed type 'campus_booking' (ids only).
// Lock-screen text never carries the student's name, phone or the pickup code.
const realtime = require('../../../utils/realtime');
const { LIMITS } = require('../enums');

const pending = new Set();
const track = (p) => { pending.add(p); p.finally(() => pending.delete(p)); return p; };
const idle = async () => { while (pending.size) await Promise.allSettled([...pending]); };

const rs = (paise) => `₹${(Math.round(Number(paise) || 0) / 100).toFixed(Number(paise) % 100 ? 2 : 0)}`;

/** Student copy per status (board: accepted, preparing, ready, completed; plus the payment steps). */
const studentCopy = (b, stallName) => {
  const s = stallName || 'the stall';
  switch (b.status) {
    // PAYMENT_REVIEW: the student just sent the proof themselves; no push about their own action (PF-26).
    case 'ACCEPTED': return { title: 'Order accepted', body: `${s} verified your payment and accepted booking ${b.ref}.` };
    case 'PREPARING': return { title: 'Preparing your order', body: `${s} is preparing booking ${b.ref}.` };
    case 'READY': return { title: 'Order ready for pickup', body: `Booking ${b.ref} is ready at ${s}. Show your pickup code at the counter.` };
    case 'COLLECTED': return { title: 'Order collected', body: `Booking ${b.ref} was collected from ${s}. Thanks for using ZenWe.` };
    case 'REJECTED': return { title: 'Payment not verified', body: `${s} could not verify the payment for booking ${b.ref}. Send the proof again or cancel.` };
    case 'CANCELLED':
      if (b.cancelledBy === 'system' && b.cancelCode === 'REVIEW_TIMEOUT') return { title: 'Booking cancelled', body: `${s} did not check your payment for booking ${b.ref} in time, so it was cancelled. If you paid, the stall returns the amount to you. Contact ZenWe support if it does not.` };
      if (b.cancelledBy === 'system') return { title: 'Booking cancelled', body: `Booking ${b.ref} was cancelled because no payment proof arrived in time.` };
      if (b.cancelledBy === 'vendor') return { title: 'Booking cancelled by the stall', body: `${s} cancelled booking ${b.ref}${b.cancelReason ? `: ${b.cancelReason}` : ''}. If you paid, the stall returns the amount to you.` };
      return null; // the student cancelled it themselves
    default: return null;
  }
};

const vendorCopy = (b) => {
  switch (b.status) {
    case 'PAYMENT_REVIEW': return {
      title: (Number(b.proofAttempts) || 0) > 1 ? 'Payment proof sent again' : 'New booking: payment to review',
      body: `Booking ${b.ref} · ${b.itemCount} item${b.itemCount === 1 ? '' : 's'} · ${rs(b.amountPaise)}. Check your UPI app, then confirm.`,
    };
    case 'CANCELLED':
      // A booking the stall was never told about (no proof yet) is not news to it (PF-26).
      if (b.cancelledBy === 'student' && !b.proofSubmittedAt) return null;
      if (b.cancelledBy === 'student' && b.cancelReason && /checking the payment/.test(b.cancelReason)) {
        return { title: 'Booking cancelled', body: `The student cancelled booking ${b.ref} while the payment was waiting for your check. If the money reached your UPI, return it to the student.` };
      }
      if (b.cancelledBy === 'student') return { title: 'Booking cancelled', body: `The student cancelled booking ${b.ref}.` };
      if (b.cancelledBy === 'system' && b.cancelCode === 'REVIEW_TIMEOUT') {
        return { title: 'Booking cancelled', body: `Booking ${b.ref} was cancelled: the payment was not checked within ${LIMITS.reviewWindowMin} minutes. If the money reached your UPI, return it to the student.` };
      }
      return null;
    default: return null;
  }
};

const toStudent = (b, stallName) => {
  const copy = studentCopy(b, stallName);
  if (!copy) return;
  track(Promise.resolve()
    .then(() => require('../../campus/campusHelpers').pushToUsers([String(b.userId)], copy.title, copy.body,
      { type: 'CAMPUS_BOOKING', screen: 'campus_booking', bookingId: String(b.id), status: b.status }, { category: 'orders' }))
    .catch((err) => console.warn('[CAMPUS_BOOKING_PUSH_WARN]', err.message)));
};

const toVendor = (b) => {
  const copy = vendorCopy(b);
  if (!copy) return;
  track(Promise.resolve()
    .then(() => require('../../../utils/storePush').pushToStore(String(b.restaurantId), copy.title, copy.body,
      { type: 'CAMPUS_BOOKING', bookingId: String(b.id), status: b.status }, { tag: `cb-${b.id}`, apps: ['campusstall'] }))
    .catch((err) => console.warn('[CAMPUS_BOOKING_STORE_PUSH_WARN]', err.message)));
};

/** One booking changed: sockets for both sides + admin, then the pushes that status calls for. */
const bookingChanged = (b, { stallName, action = 'updated', push = true } = {}) => {
  const payload = { id: String(b.id), status: b.status };
  realtime.toUser(b.userId, 'campusbooking:changed', payload);
  realtime.toStore(b.restaurantId, 'campusbooking:changed', payload);
  realtime.notifyAdmin('campus_booking', action, b.id, { storeId: b.restaurantId });
  if (!push) return;
  toStudent(b, stallName);
  toVendor(b);
};

/**
 * PF-03: reminders while a payment waits for the stall's check (jobs.js). stage: 'remind' (stall), 'canCancel'
 * (stall again + the student may cancel now), 'admin' (admins), 'lastCall' (stall: cancels in 5 min).
 */
const reviewReminder = (b, stage, { stallName } = {}) => {
  const mins = Math.max(1, Math.round((Date.now() - new Date(b.proofSubmittedAt).getTime()) / 60000));
  const stall = (title, body) => track(Promise.resolve()
    .then(() => require('../../../utils/storePush').pushToStore(String(b.restaurantId), title, body,
      { type: 'CAMPUS_BOOKING', bookingId: String(b.id), status: b.status, reminder: '1' }, { tag: `cb-${b.id}`, apps: ['campusstall'] }))
    .catch((err) => console.warn('[CAMPUS_BOOKING_STORE_PUSH_WARN]', err.message)));
  const amount = `${b.itemCount} item${b.itemCount === 1 ? '' : 's'} · ${rs(b.amountPaise)}`;
  if (stage === 'remind' || stage === 'canCancel') {
    stall('Payment still to review', `Booking ${b.ref} · ${amount} has waited ${mins} min. Check your UPI app, then confirm or reject.`);
  }
  if (stage === 'lastCall') {
    stall('Booking about to be cancelled', `Booking ${b.ref} · ${amount}: confirm or reject the payment in the next ${Math.max(1, LIMITS.reviewWindowMin - mins)} min or it is cancelled.`);
  }
  if (stage === 'canCancel') {
    track(Promise.resolve()
      .then(() => require('../../campus/campusHelpers').pushToUsers([String(b.userId)], 'Payment still being checked',
        `${stallName || 'The stall'} has not checked your payment for booking ${b.ref} yet. You can keep waiting or cancel the booking.`,
        { type: 'CAMPUS_BOOKING', screen: 'campus_booking', bookingId: String(b.id), status: b.status }, { category: 'orders' }))
      .catch((err) => console.warn('[CAMPUS_BOOKING_PUSH_WARN]', err.message)));
  }
  if (stage === 'admin') {
    track(require('../../../utils/adminAlert').pushAdmins('Campus stall payment not checked',
      `${stallName || 'A stall'} has not checked the payment for booking ${b.ref} (${rs(b.amountPaise)}) for ${mins} min. It is cancelled at ${LIMITS.reviewWindowMin} min.`,
      { type: 'CAMPUS_BOOKING_REVIEW', bookingId: String(b.id) }).catch(() => {}));
    realtime.notifyAdmin('campus_booking', 'updated', b.id, { storeId: b.restaurantId });
  }
};

module.exports = { bookingChanged, studentCopy, vendorCopy, reviewReminder, idle, track };
