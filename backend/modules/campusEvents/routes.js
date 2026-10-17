// Zenvy Campus Events routers, mounted in server.js (all before /api/admin and before the customer router):
//   POST /api/campus-events/webhooks/razorpay  raw-body webhook (mounted separately, before express.json)
//   /api/campus-events/organizer              organizer workflow (protect; ACTIVE CeOrganizer except me/apply)
//   /api/campus-events/check-in               organizer / admin / granted staff (protect)
//   /api/campus-events                        students (protect)
//   /api/admin/campus-events                  admins (protect + admin)
// While CAMPUS_EVENTS_ENABLED is off: browse, register, holds, teams and organizer submit -> 403 FEATURE_OFF;
// own registrations / tickets / cancel, check-in, organizer drafts and every admin endpoint keep working.
const express = require('express');
const { protect, admin } = require('../../middleware/authMiddleware');
const { handler, noStore } = require('./services/util');
const { requireOn } = require('./services/flag');
const B = require('./controllers/browse');
const Rg = require('./controllers/register');
const T = require('./controllers/teams');
const O = require('./controllers/organizer');
const CI = require('./controllers/checkIn');
const A = require('./controllers/admin');
const PAY = require('./controllers/payments');

const on = requireOn();
const own = requireOn({ allowWhenOff: true });
const h = (fn, tag = 'CAMPUS_EVENTS') => handler(fn, tag);

// ── Organizer ───────────────────────────────────────────────────────────────
const organizerRouter = express.Router();
organizerRouter.use(protect, noStore, own);
organizerRouter.get('/me', h(O.me));
organizerRouter.post('/apply', h(O.apply));
organizerRouter.use(O.requireOrganizer);
organizerRouter.get('/events', h(O.listEvents));
organizerRouter.post('/events', h(O.createEvent));
organizerRouter.get('/events/:id', h(O.getEvent));
organizerRouter.patch('/events/:id', h(O.updateEvent));
organizerRouter.delete('/events/:id', h(O.deleteEvent));
organizerRouter.post('/events/:id/submit', h(O.submit));
organizerRouter.post('/events/:id/withdraw', h(O.withdraw));
organizerRouter.post('/events/:id/cancel', h(O.cancelEvent));
organizerRouter.get('/events/:id/slots', h(O.listSlots));
organizerRouter.post('/events/:id/slots', h(O.createSlots));
organizerRouter.patch('/events/:id/slots/:slotId', h(O.updateSlot));
organizerRouter.post('/events/:id/slots/:slotId/cancel', h(O.cancelSlot));
organizerRouter.get('/events/:id/registrations', h(O.registrations));
organizerRouter.get('/events/:id/teams', h(O.teams));
organizerRouter.post('/events/:id/registrations/:regId/approve', h(O.approveRegistration));
organizerRouter.post('/events/:id/registrations/:regId/reject', h(O.rejectRegistration));
organizerRouter.post('/events/:id/registrations/:regId/mark-paid', h(O.markPaidRoute));
organizerRouter.post('/events/:id/registrations/:regId/mark-refunded', h(O.markRefundedRoute));
organizerRouter.get('/events/:id/announcements', h(O.listAnnouncements));
organizerRouter.post('/events/:id/announcements', h(O.createAnnouncement));
organizerRouter.get('/events/:id/stats', h(O.stats));
organizerRouter.get('/events/:id/staff', h(O.listStaff));
organizerRouter.post('/events/:id/staff', h(O.addStaff));
organizerRouter.post('/events/:id/staff/:staffId/revoke', h(O.removeStaff));
organizerRouter.get('/events/:id/audit', h(O.eventAudit));

// ── Check-in ────────────────────────────────────────────────────────────────
const checkInRouter = express.Router();
checkInRouter.use(protect, noStore, own);
checkInRouter.post('/validate', h(CI.validate, 'CAMPUS_EVENTS_CHECKIN'));
checkInRouter.post('/confirm', h(CI.confirm, 'CAMPUS_EVENTS_CHECKIN'));
checkInRouter.get('/events', h(CI.myEvents, 'CAMPUS_EVENTS_CHECKIN'));
checkInRouter.get('/events/:id/recent', h(CI.recent, 'CAMPUS_EVENTS_CHECKIN'));

// ── Students ────────────────────────────────────────────────────────────────
const router = express.Router();
router.use(protect, noStore);
router.get('/status', own, h(B.status));
router.get('/sections', on, h(B.sections));
router.get('/clubs', on, h(B.clubs));
router.get('/categories', own, h(B.categories));
router.get('/my/registrations', own, h(Rg.mine));
router.get('/my/tickets', own, h(Rg.myTickets));
router.get('/my/teams', own, h(T.myTeams));
router.get('/team-invitations', own, h(T.myInvitations));
router.post('/team-invitations/:id/respond', on, h(T.respond));
router.get('/team-join/preview', on, h(T.joinPreview));
router.post('/team-join', on, h(T.joinByLink));
router.get('/registrations/:id', own, h(Rg.detail));
router.post('/registrations/:id/confirm', on, h(Rg.confirm));
router.post('/registrations/:id/release', own, h(Rg.release));
router.post('/registrations/:id/cancel', own, h(Rg.cancel));
router.post('/registrations/:id/accept-offer', on, h(Rg.acceptOffer));
router.post('/registrations/:id/decline-offer', own, h(Rg.declineOffer));
router.post('/registrations/:id/request-refund', own, h(Rg.requestRefund));
router.post('/registrations/:id/pay/razorpay-order', on, h(Rg.createOrder));
router.get('/registrations/:id/payment', own, h(Rg.paymentStatus));
router.get('/tickets/:id', own, h(Rg.ticketDetail));
router.get('/teams/:teamId', own, h(T.getTeam));
router.get('/teams/:teamId/history', own, h(T.history));
router.post('/teams/:teamId/invitations', on, h(T.invite));
router.post('/teams/:teamId/join-link', on, h(T.joinLink));
router.post('/teams/:teamId/join-link/revoke', own, h(T.revokeJoinLink));
router.post('/teams/:teamId/members/:memberId/remove', own, h(T.removeMember));
router.post('/teams/:teamId/leave', own, h(T.leave));
router.post('/teams/:teamId/captain', own, h(T.transferCaptain));
router.post('/teams/:teamId/submit', on, h(T.submit));
router.post('/teams/:teamId/cancel', own, h(T.cancelTeam));
router.get('/', on, h(B.browse));
router.get('/:id', on, h(B.detail));
router.get('/:id/slots', on, h(B.slots));
router.get('/:id/availability', on, h(B.availability));
router.get('/:id/announcements', own, h(B.announcements));
router.post('/:id/register', on, h(Rg.register));
router.post('/:id/slots/:slotId/hold', on, h(Rg.hold));
router.post('/:id/slots/:slotId/book', on, h(Rg.register));
router.post('/:id/teams', on, h(T.createTeam));

// ── Admin ───────────────────────────────────────────────────────────────────
const adminRouter = express.Router();
adminRouter.use(protect, admin, noStore);
const a = (fn) => handler(fn, 'CAMPUS_EVENTS_ADMIN');
adminRouter.get('/summary', a(A.summary));
adminRouter.get('/categories', a(B.categories));
adminRouter.get('/users', a(A.searchUsers));
adminRouter.get('/review-queue', a(A.reviewQueue));
adminRouter.get('/pending', a(A.reviewQueue));
adminRouter.get('/events', a(A.events));
adminRouter.get('/events/:id', a(A.eventDetail));
adminRouter.patch('/events/:id', a(A.editEvent));
adminRouter.post('/events/:id/approve', a(A.approve));
adminRouter.post('/events/:id/reject', a(A.reject));
adminRouter.post('/events/:id/request-changes', a(A.requestChanges));
adminRouter.post('/events/:id/unpublish', a(A.unpublish));
adminRouter.post('/events/:id/republish', a(A.republish));
adminRouter.post('/events/:id/cancel', a(A.cancelEvent));
adminRouter.post('/events/:id/feature', a(A.feature));
adminRouter.post('/events/:id/changes/approve', a(A.approveChanges));
adminRouter.post('/events/:id/changes/reject', a(A.rejectChanges));
adminRouter.get('/events/:id/registrations', a(A.eventRegistrations));
adminRouter.post('/events/:id/staff', a(A.addStaff));
adminRouter.post('/events/:id/staff/:staffId/revoke', a(A.removeStaff));
adminRouter.get('/registrations', a(A.registrations));
adminRouter.post('/registrations/:id/cancel', a(A.cancelRegistration));
adminRouter.post('/registrations/:id/refund', a(A.refund));
adminRouter.post('/registrations/:id/mark-paid', a(A.markPaid));
adminRouter.post('/registrations/:id/approve', a(A.approveRegistration));
adminRouter.post('/registrations/:id/reject', a(A.rejectRegistration));
adminRouter.get('/payments', a(A.paymentsList));
adminRouter.get('/organizers', a(A.organizers));
adminRouter.post('/organizers', a(A.createOrganizer));
adminRouter.post('/organizers/bulk-grant', a(A.bulkGrant));
adminRouter.post('/organizers/:id/approve', a(A.approveOrganizer));
adminRouter.post('/organizers/:id/reject', a(A.rejectOrganizer));
adminRouter.post('/organizers/:id/suspend', a(A.suspendOrganizer));
adminRouter.post('/organizers/:id/reinstate', a(A.reinstateOrganizer));
adminRouter.post('/organizers/:id/revoke', a(A.revokeOrganizer));
adminRouter.get('/staff', a(A.staff));
adminRouter.post('/tickets/:id/void', a(A.voidTicket));
adminRouter.post('/tickets/:id/reissue', a(A.reissueTicket));
adminRouter.get('/settings', a(A.getSettings));
adminRouter.put('/settings', a(A.putSettings));
adminRouter.get('/reports', a(A.reports));
adminRouter.get('/audit', a(A.auditLog));

/** Raw-body Razorpay webhook (server.js mounts it with express.raw before express.json). */
const razorpayWebhook = (req, res) => PAY.razorpayWebhook(req, res);
const WEBHOOK_PATH = '/api/campus-events/webhooks/razorpay';

module.exports = { router, organizerRouter, checkInRouter, adminRouter, razorpayWebhook, WEBHOOK_PATH };
