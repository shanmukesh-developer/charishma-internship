// ZCS PG Partner routers, mounted in server.js before /api/admin:
//   /api/pg-owner            PG owner app (protectOwner = PgOwner accounts only)
//   /api/pg-tenant           customers staying at a PG (protect): complaints
//   /api/admin/pg-owners     admins (protect + admin): owner accounts, listing links
// Owners only ever touch the listings linked to their account (services/util.js ownListing).
const express = require('express');
const rateLimit = require('express-rate-limit');
const { protect, admin } = require('../../middleware/authMiddleware');
const { accountLockout } = require('../../middleware/lockoutMiddleware');
const { skipRateLimit } = require('../../utils/loadtestBypass');
const { handler, noStore } = require('./services/util');
const { protectOwner, requirePasswordChanged } = require('./services/auth');
const A = require('./controllers/auth');
const O = require('./controllers/owner');
const T = require('./controllers/tenant');
const AD = require('./controllers/admin');

const limiter = (name, max, message) => rateLimit({
  windowMs: 15 * 60 * 1000,
  max,
  skip: (req) => skipRateLimit(req),
  message: { code: 'RATE_LIMITED', message },
  standardHeaders: true,
  legacyHeaders: false,
  ...require('../../utils/sharedRateLimit').expressStore(name),
});

// ── PG owners ───────────────────────────────────────────────────────────────
const ownerRouter = express.Router();
ownerRouter.use(noStore);
const ownerAuthLimiter = limiter('pgowner.authLimiter', Number(process.env.PG_OWNER_AUTH_MAX) || 30, 'Too many sign-in attempts. Please try again in 15 minutes.');
const o = (fn) => handler(fn, 'PG_OWNER');
// Sign-in: auth rate limit (per IP) + accountLockout (5 wrong passwords -> 15 min lock per number).
ownerRouter.post('/auth/login', ownerAuthLimiter, accountLockout, o(A.login));
ownerRouter.use(protectOwner);
// Allowed while the temporary password is still set (the app shows only the password screen then).
ownerRouter.post('/auth/refresh', o(A.refresh));
ownerRouter.post('/auth/password', ownerAuthLimiter, o(A.changePassword));
ownerRouter.get('/me', o(A.me));
ownerRouter.post('/fcm-token', o(A.saveFcmToken));
ownerRouter.post('/fcm-token/remove', o(A.removeFcmToken));
ownerRouter.post('/account/deletion-request', ownerAuthLimiter, o(A.requestDeletion));
// Everything else: own password set first.
ownerRouter.use(requirePasswordChanged);
ownerRouter.get('/home', o(O.home));
ownerRouter.get('/notifications', o(A.notifications));
ownerRouter.post('/notifications/read', o(A.markRead));
ownerRouter.get('/listings/:id', o(O.getListing));
ownerRouter.put('/listings/:id/availability', o(O.putAvailability));
ownerRouter.put('/listings/:id/mess', o(O.putMess));
ownerRouter.put('/listings/:id/info', o(O.putInfo));
ownerRouter.put('/listings/:id/house-rules', o(O.putHouseRules));
ownerRouter.put('/listings/:id/photos', o(O.putPhotos));
ownerRouter.post('/media', (req, res, next) => require('../campus/controllers/mediaController').parseUpload(req, res, next), handler(O.uploadMedia, 'PG_OWNER_MEDIA'));
ownerRouter.get('/bookings', o(O.listBookings));
ownerRouter.post('/bookings/:id/accept', o(O.acceptBooking));
ownerRouter.post('/bookings/:id/reject', o(O.rejectBooking));
ownerRouter.post('/bookings/:id/move-out', o(O.moveOut));
ownerRouter.get('/tenants', o(O.tenants));
ownerRouter.get('/rent', o(O.rent));
ownerRouter.post('/rent', o(O.recordRent));
ownerRouter.post('/rent/:id/void', o(O.voidRent));
ownerRouter.get('/complaints', o(O.listComplaints));
ownerRouter.post('/complaints/:id/reply', o(O.replyComplaint));

// ── Tenants (customers) ─────────────────────────────────────────────────────
const tenantRouter = express.Router();
tenantRouter.use(protect, noStore);
tenantRouter.get('/complaints', handler(T.myComplaints, 'PG_TENANT'));
tenantRouter.post('/complaints', handler(T.createComplaint, 'PG_TENANT'));

// ── Admin ───────────────────────────────────────────────────────────────────
const adminRouter = express.Router();
adminRouter.use(protect, admin, noStore);
const a = (fn) => handler(fn, 'PG_OWNER_ADMIN');
const adminCreateLimiter = limiter('pgowner.adminCreateLimiter', Number(process.env.PG_OWNER_ADMIN_CREATE_MAX) || 60, 'Too many accounts created. Please try again in 15 minutes.');
adminRouter.get('/', a(AD.list));
adminRouter.get('/links', a(AD.links));
adminRouter.post('/', adminCreateLimiter, a(AD.create));
adminRouter.get('/:id', a(AD.detail));
adminRouter.patch('/:id', a(AD.update));
adminRouter.post('/:id/listings', a(AD.linkListings));
adminRouter.delete('/:id/listings/:hostelId', a(AD.unlinkListing));
adminRouter.post('/:id/reset-password', adminCreateLimiter, a(AD.resetPassword));
adminRouter.post('/:id/suspend', a(AD.suspend));
adminRouter.post('/:id/unsuspend', a(AD.unsuspend));

module.exports = { ownerRouter, tenantRouter, adminRouter };
