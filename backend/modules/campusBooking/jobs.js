// In-Campus Booking lifecycle (jobs/index.js 'campusBooking.lifecycle', every 2 min): a booking that never got
// payment proof (PAYMENT_PENDING for 20 min) or a new proof after a rejection (REJECTED for 2 h) is cancelled
// by the system, with a push to the student; a payment the stall never checks (PAYMENT_REVIEW) is reminded and then
// cancelled (below). Once the stall accepts a booking only the stall changes it. One indexed lookup when idle.
const { Op } = require('sequelize');
const { LIMITS } = require('./enums');
const { getModel } = require('./index');

// PF-03 (6 Nov 2026): a payment under review (PAYMENT_REVIEW) used to wait forever when the stall never looked; the
// student could not cancel and nobody was told. Minutes since the proof (LIMITS): reviewRemindMin -> stall reminder;
// reviewStudentCancelMin -> stall reminder + the student is told they may cancel; reviewAdminAlertMin -> admins;
// reviewWindowMin - 5 -> stall last call; reviewWindowMin -> cancelled by the system (cancelCode REVIEW_TIMEOUT), the
// student and the stall told that the stall returns any money that reached it (ZCS never holds the money).
// One reminder per stage per proof (memory; a restart re-sends at most the current stage).
const REVIEW_STAGES = () => [
  { key: 'remind', atMin: LIMITS.reviewRemindMin },
  { key: 'canCancel', atMin: LIMITS.reviewStudentCancelMin },
  { key: 'admin', atMin: LIMITS.reviewAdminAlertMin },
  { key: 'lastCall', atMin: LIMITS.reviewWindowMin - 5 },
];
const reviewSent = new Map(); // `${bookingId}:${proofSubmittedAt ms}` -> stages already sent

const runCampusBookingJobs = async ({ now = new Date() } = {}) => {
  const Booking = getModel('CampusBooking');
  if (!Booking) return { skipped: true };
  const B = require('./services/bookings');
  const notify = require('./services/notify');
  const out = { expiredUnpaid: 0, expiredRejected: 0, expiredReview: 0, reviewReminders: 0 };
  const rows = await Booking.findAll({
    where: {
      [Op.or]: [
        { status: 'PAYMENT_PENDING', createdAt: { [Op.lt]: new Date(now.getTime() - LIMITS.paymentWindowMin * 60000) } },
        { status: 'REJECTED', rejectedAt: { [Op.lt]: new Date(now.getTime() - LIMITS.rejectedWindowMin * 60000) } },
        { status: 'PAYMENT_REVIEW', proofSubmittedAt: { [Op.lt]: new Date(now.getTime() - LIMITS.reviewRemindMin * 60000) } },
      ],
    },
    limit: 200,
  });
  const live = new Set();
  if (!rows.length) { reviewSent.clear(); return { idle: true, ...out }; }
  const stallNames = new Map();
  const stallName = async (id) => {
    if (!stallNames.has(String(id))) {
      const { getRestaurantModel } = require('../../models/Restaurant');
      const st = await getRestaurantModel().findByPk(id, { attributes: ['id', 'name'] }).catch(() => null);
      stallNames.set(String(id), st ? st.name : null);
    }
    return stallNames.get(String(id));
  };
  for (const b of rows) {
    try {
      const was = b.status;
      if (was === 'PAYMENT_REVIEW') {
        const ageMin = (now.getTime() - new Date(b.proofSubmittedAt).getTime()) / 60000;
        const key = `${b.id}:${new Date(b.proofSubmittedAt).getTime()}`;
        live.add(key);
        if (ageMin >= LIMITS.reviewWindowMin) {
          const fresh = await B.cancel(b, 'system', {}, now);
          out.expiredReview++;
          reviewSent.delete(key);
          notify.bookingChanged(fresh, { stallName: await stallName(b.restaurantId) });
          continue;
        }
        const done = reviewSent.get(key) || 0;
        let due = 0;
        REVIEW_STAGES().forEach((st, i) => { if (ageMin >= st.atMin) due = i + 1; });
        if (due > done) {
          reviewSent.set(key, due);
          notify.reviewReminder(b, REVIEW_STAGES()[due - 1].key, { stallName: await stallName(b.restaurantId) });
          // Reaching "the student may cancel": their open booking screen refreshes (canCancel turns true).
          if (REVIEW_STAGES()[due - 1].key === 'canCancel') notify.bookingChanged(b, { push: false });
          out.reviewReminders++;
        }
        continue;
      }
      const fresh = await B.cancel(b, 'system', {}, now);
      if (was === 'REJECTED') out.expiredRejected++; else out.expiredUnpaid++;
      notify.bookingChanged(fresh);
    } catch (err) {
      if (err && err.code !== 'CHANGED' && err.code !== 'BAD_TRANSITION') console.warn('[CAMPUS_BOOKING_JOB_WARN]', err.message);
    }
  }
  for (const k of reviewSent.keys()) if (!live.has(k)) reviewSent.delete(k);
  return out;
};

const _resetReviewReminders = () => reviewSent.clear();

module.exports = { runCampusBookingJobs, _resetReviewReminders };
