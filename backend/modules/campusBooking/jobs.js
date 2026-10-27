// In-Campus Booking lifecycle (jobs/index.js 'campusBooking.lifecycle', every 2 min): a booking that never got
// payment proof (PAYMENT_PENDING for 20 min) or a new proof after a rejection (REJECTED for 2 h) is cancelled
// by the system, with a push to the student. Nothing else is automatic: once the stall reviews or accepts a
// booking only the stall (or the student, before acceptance) changes it. One indexed lookup when idle.
const { Op } = require('sequelize');
const { LIMITS } = require('./enums');
const { getModel } = require('./index');

const runCampusBookingJobs = async ({ now = new Date() } = {}) => {
  const Booking = getModel('CampusBooking');
  if (!Booking) return { skipped: true };
  const B = require('./services/bookings');
  const notify = require('./services/notify');
  const out = { expiredUnpaid: 0, expiredRejected: 0 };
  const rows = await Booking.findAll({
    where: {
      [Op.or]: [
        { status: 'PAYMENT_PENDING', createdAt: { [Op.lt]: new Date(now.getTime() - LIMITS.paymentWindowMin * 60000) } },
        { status: 'REJECTED', rejectedAt: { [Op.lt]: new Date(now.getTime() - LIMITS.rejectedWindowMin * 60000) } },
      ],
    },
    limit: 200,
  });
  if (!rows.length) return { idle: true, ...out };
  for (const b of rows) {
    try {
      const was = b.status;
      const fresh = await B.cancel(b, 'system', {}, now);
      if (was === 'REJECTED') out.expiredRejected++; else out.expiredUnpaid++;
      notify.bookingChanged(fresh);
    } catch (err) {
      if (err && err.code !== 'CHANGED' && err.code !== 'BAD_TRANSITION') console.warn('[CAMPUS_BOOKING_JOB_WARN]', err.message);
    }
  }
  return out;
};

module.exports = { runCampusBookingJobs };
