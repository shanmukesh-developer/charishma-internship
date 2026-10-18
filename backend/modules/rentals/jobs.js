// Rentals background job (every 2 minutes, scheduled in jobs/index.js like the order auto-cancel job):
//  - REQUESTED past respondBy (2 h or the pickup time)      -> EXPIRED, renter + owner told
//  - ACCEPTED never handed over by the end of the booking   -> EXPIRED (no-show), both told
//  - RETURNED not closed by the owner within 24 h            -> COMPLETED (no extra charges)
//  - reminders: 60 min before pickup / return, and once when a return is overdue
//  - C7: extra charges the renter / borrower did not answer within the window -> AUTO_ACCEPTED
// Every transition is a conditional UPDATE (WHERE status = old), so a concurrent owner action wins cleanly.
const { Op } = require('sequelize');
const { getModel } = require('./index');
const E = require('./enums');
const notify = require('./services/notify');

const B = E.BOOKING_STATUS;
const CH = E.CHARGES_STATUS;
// C7 wording: RENT (commercial plate) -> owner / renter; BORROW (private plate) -> lender / borrower.
const W = (b) => E.wordsFor(b.rentalMode === E.RENTAL_MODES.RENT ? E.RENTAL_MODES.RENT : E.RENTAL_MODES.BORROW);
const REMIND_MS = 60 * 60 * 1000;
const fmt = (d) => new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });

const runRentalJobs = async (now = new Date()) => {
  const Booking = getModel('RentalBooking');
  if (!Booking) return { skipped: true };
  const out = { expired: 0, noShow: 0, autoCompleted: 0, startReminders: 0, returnReminders: 0, lateNotices: 0, chargesAutoAccepted: 0 };

  // 1. Unanswered requests.
  const stale = await Booking.findAll({ where: { status: B.REQUESTED, respondBy: { [Op.lte]: now } }, limit: 200 });
  for (const b of stale) {
    const [n] = await Booking.update({ status: B.EXPIRED, expiredAt: now }, { where: { id: b.id, status: B.REQUESTED } });
    if (!n) continue;
    out.expired++;
    b.status = B.EXPIRED;
    notify.booking(b, { to: 'renter', title: `${W(b).Request} expired`, body: `The ${W(b).giver} did not answer in time for ${b.vehicleTitle}. Try another vehicle.`, type: 'RENTAL_EXPIRED' });
    notify.push(b.ownerId, `${W(b).Request} expired`, `You did not answer the request for ${b.vehicleTitle} in time.`, { type: 'RENTAL_EXPIRED', bookingId: b.id, screen: 'rental_booking' });
  }

  // 2. Confirmed but never picked up before the booking ended.
  const noShow = await Booking.findAll({ where: { status: B.ACCEPTED, endAt: { [Op.lte]: now } }, limit: 200 });
  for (const b of noShow) {
    const [n] = await Booking.update({ status: B.EXPIRED, expiredAt: now }, { where: { id: b.id, status: B.ACCEPTED } });
    if (!n) continue;
    out.noShow++;
    b.status = B.EXPIRED;
    notify.booking(b, { to: 'both', title: `${W(b).booking === 'rental' ? 'Rental' : 'Borrowing'} expired`, body: `${b.vehicleTitle} was never picked up. Report a problem from the booking if needed.`, type: 'RENTAL_EXPIRED' });
  }

  // 3. Returned but not closed by the owner.
  const returned = await Booking.findAll({ where: { status: B.RETURNED, returnedAt: { [Op.lte]: new Date(now.getTime() - E.LIMITS.AUTO_COMPLETE_MS) } }, limit: 200 });
  for (const b of returned) {
    const [n] = await Booking.update(
      { status: B.COMPLETED, completedAt: now, extraCharges: 0, finalAmount: Number(b.rentAmount) || 0, extraBreakdown: { auto: true }, chargesStatus: CH.NONE, chargesClaimed: 0 },
      { where: { id: b.id, status: B.RETURNED } },
    );
    if (!n) continue;
    out.autoCompleted++;
    await getModel('RentalListing').increment('tripCount', { by: 1, where: { id: b.listingId } });
    b.status = B.COMPLETED;
    notify.booking(b, { to: 'both', title: 'Trip completed ⭐', body: `Rate your trip with ${b.vehicleTitle}.`, type: 'RENTAL_COMPLETED' });
  }

  // 4. Reminders.
  const soon = new Date(now.getTime() + REMIND_MS);
  const starting = await Booking.findAll({ where: { status: B.ACCEPTED, reminderStartSentAt: null, startAt: { [Op.lte]: soon, [Op.gt]: now } }, limit: 200 });
  for (const b of starting) {
    const [n] = await Booking.update({ reminderStartSentAt: now }, { where: { id: b.id, reminderStartSentAt: null } });
    if (!n) continue;
    out.startReminders++;
    notify.push([b.renterId, b.ownerId], 'Pickup soon 🔑', `${b.vehicleTitle} pickup at ${fmt(b.startAt)}. ${W(b).Taker}: keep your pickup PIN ready.`, { type: 'RENTAL_REMINDER', bookingId: b.id, screen: 'rental_booking' });
  }
  const ending = await Booking.findAll({ where: { status: B.ACTIVE, reminderReturnSentAt: null, endAt: { [Op.lte]: soon, [Op.gt]: now } }, limit: 200 });
  for (const b of ending) {
    const [n] = await Booking.update({ reminderReturnSentAt: now }, { where: { id: b.id, reminderReturnSentAt: null } });
    if (!n) continue;
    out.returnReminders++;
    notify.push([b.renterId, b.ownerId], 'Return due soon', `${b.vehicleTitle} is due back at ${fmt(b.endAt)}.`, { type: 'RENTAL_REMINDER', bookingId: b.id, screen: 'rental_booking' });
  }
  const late = await Booking.findAll({ where: { status: B.ACTIVE, lateNoticeSentAt: null, endAt: { [Op.lte]: now } }, limit: 200 });
  for (const b of late) {
    const [n] = await Booking.update({ lateNoticeSentAt: now }, { where: { id: b.id, lateNoticeSentAt: null } });
    if (!n) continue;
    out.lateNotices++;
    notify.push(b.renterId, 'Return overdue ⏰', `${b.vehicleTitle} was due back at ${fmt(b.endAt)}. Please return it now or call the ${W(b).giver}.`, { type: 'RENTAL_LATE', bookingId: b.id, screen: 'rental_booking' });
    notify.push(b.ownerId, 'Return overdue', `${b.vehicleTitle} has not been returned yet. You can report a late return from the booking.`, { type: 'RENTAL_LATE', bookingId: b.id, screen: 'rental_booking' });
  }

  // 5. C7: extra charges not answered within the window count as accepted.
  const dueCharges = await Booking.findAll({ where: { chargesStatus: CH.PENDING, chargesRespondBy: { [Op.lte]: now } }, limit: 200 });
  for (const b of dueCharges) {
    if (!(await require('./controllers/bookings').autoAcceptCharges(b, null, now))) continue;
    out.chargesAutoAccepted++;
    notify.booking(b, { to: 'both', title: 'Extra charges accepted', body: `No answer within the time limit, so the ₹${b.chargesClaimed} extra charges for ${b.vehicleTitle} are now final.`, type: 'RENTAL_CHARGES' });
  }
  return out;
};

// Scheduled every 2 minutes (first run 40 s after boot) by jobs/index.js through utils/jobs.runExclusive.
module.exports = { runRentalJobs };
