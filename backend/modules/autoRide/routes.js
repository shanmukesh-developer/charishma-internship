// Zenvy Auto-Ride routers, mounted in server.js before /api/admin:
//   /api/auto-ride            customers (protect = Zenvy User accounts only)
//   /api/auto-ride/driver     Zenvy Auto Driver app (protectDriver = AutoDriver accounts only)
//   /api/admin/auto-ride      admins (protect + admin)
// While AUTO_RIDE_ENABLED is off: customers may still read / cancel their own bookings and requests;
// browse, holds, confirmations, full-auto requests and driver publish / accept -> 403 FEATURE_OFF.
// Driver onboarding and every admin endpoint keep working.
const express = require('express');
const rateLimit = require('express-rate-limit');
const { protect, admin } = require('../../middleware/authMiddleware');
const { accountLockout } = require('../../middleware/lockoutMiddleware');
const { skipRateLimit } = require('../../utils/loadtestBypass');
const { handler, noStore } = require('./services/util');
const { requireCustomer } = require('./services/flag');
const { protectDriver } = require('./services/driverAuth');
const C = require('./controllers/customer');
const DA = require('./controllers/driverAuth');
const DP = require('./controllers/driverProfile');
const DT = require('./controllers/driverTrips');
const A = require('./controllers/admin');

// ── Drivers (registered first: '/driver/*' must never fall into the customer router) ───────────
const driverRouter = express.Router();
driverRouter.use(noStore);
const driverAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.AUTO_DRIVER_AUTH_MAX) || 30,
  skip: (req) => skipRateLimit(req),
  message: { code: 'RATE_LIMITED', message: 'Too many sign-in attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  ...require('../../utils/sharedRateLimit').expressStore('autoride.driverAuthLimiter'),
});
driverRouter.post('/auth/register', driverAuthLimiter, handler(DA.register, 'AUTORIDE_DRIVER_REGISTER'));
driverRouter.post('/auth/login', driverAuthLimiter, accountLockout, handler(DA.login, 'AUTORIDE_DRIVER_LOGIN'));
driverRouter.use(protectDriver);
// C9: in-app account deletion: /account/deletion-check, /account/delete-otp, /account/delete.
driverRouter.use('/account', require('../../routes/partnerAccountRoutes').driverRouter);
driverRouter.post('/auth/refresh', handler(DA.refresh, 'AUTORIDE_DRIVER'));
driverRouter.post('/auth/password', driverAuthLimiter, handler(DA.changePassword, 'AUTORIDE_DRIVER'));
driverRouter.post('/fcm-token', handler(DA.saveFcmToken, 'AUTORIDE_DRIVER'));
driverRouter.post('/fcm-token/remove', handler(DA.removeFcmToken, 'AUTORIDE_DRIVER'));
driverRouter.get('/me', handler(DP.me, 'AUTORIDE_DRIVER'));
driverRouter.patch('/me/profile', handler(DP.updateProfile, 'AUTORIDE_DRIVER'));
driverRouter.put('/me/documents', handler(DP.putDocuments, 'AUTORIDE_DRIVER'));
driverRouter.post('/me/submit', handler(DP.submit, 'AUTORIDE_DRIVER'));
driverRouter.post('/media', (req, res, next) => require('../campus/controllers/mediaController').parseUpload(req, res, next), handler(DP.uploadMedia, 'AUTORIDE_DRIVER_MEDIA'));
driverRouter.post('/online', handler(DP.setOnline, 'AUTORIDE_DRIVER'));
driverRouter.get('/home', handler(DP.home, 'AUTORIDE_DRIVER'));
driverRouter.get('/earnings', handler(DP.earningsRoute, 'AUTORIDE_DRIVER'));
driverRouter.get('/vehicles', handler(DP.listVehicles, 'AUTORIDE_DRIVER'));
driverRouter.post('/vehicles', handler(DP.createVehicle, 'AUTORIDE_DRIVER'));
driverRouter.patch('/vehicles/:id', handler(DP.updateVehicle, 'AUTORIDE_DRIVER'));
driverRouter.get('/routes', handler(DP.routes, 'AUTORIDE_DRIVER'));
driverRouter.get('/notifications', handler(DP.notifications, 'AUTORIDE_DRIVER'));
driverRouter.post('/notifications/read', handler(DP.markRead, 'AUTORIDE_DRIVER'));
driverRouter.post('/incidents', handler(DP.reportIncident, 'AUTORIDE_DRIVER'));
driverRouter.post('/sos', handler(DP.sos, 'AUTORIDE_DRIVER_SOS'));
driverRouter.get('/settings', handler(DP.settings, 'AUTORIDE_DRIVER'));
driverRouter.get('/pickup-points/:id/queue', handler(DP.pickupQueue, 'AUTORIDE_DRIVER'));
driverRouter.get('/trips', handler(DT.list, 'AUTORIDE_DRIVER_TRIPS'));
driverRouter.post('/trips', handler(DT.create, 'AUTORIDE_DRIVER_TRIPS'));
driverRouter.get('/trips/:id', handler(DT.detail, 'AUTORIDE_DRIVER_TRIPS'));
driverRouter.patch('/trips/:id', handler(DT.update, 'AUTORIDE_DRIVER_TRIPS'));
driverRouter.delete('/trips/:id', handler(DT.removeDraft, 'AUTORIDE_DRIVER_TRIPS'));
driverRouter.post('/trips/:id/publish', handler(DT.publish, 'AUTORIDE_DRIVER_PUBLISH'));
driverRouter.post('/trips/:id/actions/:action', handler(DT.action, 'AUTORIDE_DRIVER_ACTION'));
driverRouter.get('/trips/:id/bookings', handler(DT.bookings, 'AUTORIDE_DRIVER_TRIPS'));
driverRouter.get('/trips/:id/seats', handler(DT.seats, 'AUTORIDE_DRIVER_TRIPS'));
driverRouter.post('/trips/:id/check-in', handler(DT.checkIn, 'AUTORIDE_DRIVER_CHECKIN'));
driverRouter.post('/trips/:id/bookings/:bookingId/no-show', handler(DT.noShow, 'AUTORIDE_DRIVER_TRIPS'));
driverRouter.get('/private-requests', handler(DT.privateRequests, 'AUTORIDE_DRIVER_PRIVATE'));
driverRouter.post('/private-requests/:id/accept', handler(DT.acceptPrivate, 'AUTORIDE_DRIVER_PRIVATE'));
driverRouter.post('/private-requests/:id/decline', handler(DT.declinePrivate, 'AUTORIDE_DRIVER_PRIVATE'));

// ── Customers ───────────────────────────────────────────────────────────────
const router = express.Router();
router.use(protect, noStore);
const on = requireCustomer();
const own = requireCustomer({ allowWhenOff: true });

router.get('/status', own, handler(C.status, 'AUTORIDE_STATUS'));
router.get('/settings/public', own, handler(C.settingsPublic, 'AUTORIDE_STATUS'));
router.get('/routes', on, handler(C.routes, 'AUTORIDE_ROUTES'));
router.get('/pickup-points', on, handler(C.pickupPoints, 'AUTORIDE_PICKUPS'));
router.get('/pickup-points/:id/queue', on, handler(C.pickupQueue, 'AUTORIDE_QUEUE'));
router.get('/trips', on, handler(C.browse, 'AUTORIDE_BROWSE'));
router.get('/trips/:id', on, handler(C.detail, 'AUTORIDE_TRIP'));
router.get('/trips/:id/seats', on, handler(C.seats, 'AUTORIDE_SEATS'));
router.post('/trips/:id/holds', on, handler(C.createHold, 'AUTORIDE_HOLD'));
router.post('/trips/:id/private-requests', on, handler(C.createPrivate, 'AUTORIDE_PRIVATE'));
router.post('/bookings/:id/confirm', on, handler(C.confirmBooking, 'AUTORIDE_CONFIRM'));
router.post('/bookings/:id/release', own, handler(C.releaseBooking, 'AUTORIDE_RELEASE'));
router.post('/bookings/:id/cancel', own, handler(C.cancelBooking, 'AUTORIDE_CANCEL'));
router.post('/bookings/:id/incident', own, handler(C.reportIncident, 'AUTORIDE_INCIDENT'));
router.get('/bookings', own, handler(C.myBookings, 'AUTORIDE_BOOKINGS'));
router.get('/bookings/:id', own, handler(C.bookingDetail, 'AUTORIDE_BOOKING'));
router.get('/private-requests', own, handler(C.myPrivate, 'AUTORIDE_PRIVATE'));
router.get('/private-requests/:id', own, handler(C.privateDetail, 'AUTORIDE_PRIVATE'));
router.post('/private-requests/:id/cancel', own, handler(C.cancelPrivate, 'AUTORIDE_PRIVATE'));

// ── Admin ───────────────────────────────────────────────────────────────────
const adminRouter = express.Router();
adminRouter.use(protect, admin, noStore);
const a = (fn) => handler(fn, 'AUTORIDE_ADMIN');
adminRouter.get('/summary', a(A.summary));
adminRouter.get('/drivers', a(A.drivers));
// Plan B sign-up: the admin creates the driver account (phone + temporary password), no SMS needed.
const adminCreateDriverLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.AUTO_ADMIN_CREATE_DRIVER_MAX) || 60,
  skip: (req) => skipRateLimit(req),
  message: { code: 'RATE_LIMITED', message: 'Too many accounts created. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  ...require('../../utils/sharedRateLimit').expressStore('autoride.adminCreateDriverLimiter'),
});
adminRouter.post('/drivers', adminCreateDriverLimiter, a(A.createDriver));
adminRouter.get('/drivers/:id', a(A.driverDetail));
adminRouter.post('/drivers/:id/verify', a(A.verifyDriver));
adminRouter.post('/drivers/:id/reject', a(A.rejectDriver));
adminRouter.post('/drivers/:id/suspend', a(A.suspendDriver));
adminRouter.post('/drivers/:id/unsuspend', a(A.unsuspendDriver));
adminRouter.get('/vehicles', a(A.vehicles));
adminRouter.get('/vehicles/:id', a(A.vehicleDetail));
adminRouter.post('/vehicles/:id/approve', a(A.approveVehicle));
adminRouter.post('/vehicles/:id/reject', a(A.rejectVehicle));
adminRouter.post('/vehicles/:id/suspend', a(A.suspendVehicle));
adminRouter.get('/routes', a(A.listRoutes));
adminRouter.post('/routes', a(A.createRoute));
adminRouter.patch('/routes/:id', a(A.updateRoute));
adminRouter.post('/routes/:id/pickup-points', a(A.createPickup));
adminRouter.patch('/pickup-points/:id', a(A.updatePickup));
adminRouter.get('/trips', a(A.trips));
adminRouter.get('/trips/:id', a(A.tripDetail));
adminRouter.post('/trips/:id/cancel', a(A.cancelTrip));
adminRouter.get('/queues', a(A.queues));
adminRouter.get('/bookings', a(A.bookings));
adminRouter.post('/bookings/:id/cancel', a(A.cancelBooking));
adminRouter.post('/bookings/:id/refund', a(A.retryRefund));
adminRouter.get('/private-requests', a(A.privateRequests));
adminRouter.get('/incidents', a(A.incidents));
adminRouter.post('/incidents/:id/status', a(A.updateIncident));
adminRouter.get('/fares', a(A.fares));
adminRouter.get('/settings', a(A.getSettings));
adminRouter.put('/settings', a(A.putSettings));
adminRouter.get('/audit', a(A.auditLog));

module.exports = { router, driverRouter, adminRouter };
