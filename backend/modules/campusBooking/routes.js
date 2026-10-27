// /api/campus-booking/* (students), /api/campus-booking/vendor/* (ZCS Vendor stalls) and
// /api/admin/campus-booking/* (admins). Mounted in server.js (vendor router first, admin before /api/admin).
const express = require('express');
const { protect, admin, studentOnly } = require('../../middleware/authMiddleware');
const { handler } = require('./services/util');
const St = require('./controllers/student');
const V = require('./controllers/vendor');
const A = require('./controllers/admin');

const noStore = (req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); };

// ── Students ────────────────────────────────────────────────────────────────
const router = express.Router();
router.use(protect, studentOnly, noStore);
router.get('/home', handler(St.home, 'CAMPUS_BOOKING_HOME'));
router.get('/stalls', handler(St.listStalls, 'CAMPUS_BOOKING_STALLS'));
router.get('/stalls/:id', handler(St.stallDetail, 'CAMPUS_BOOKING_STALL'));
router.post('/bookings', handler(St.create, 'CAMPUS_BOOKING_CREATE'));
router.get('/bookings', handler(St.listMine, 'CAMPUS_BOOKING_MINE'));
router.get('/bookings/:id', handler(St.getMine, 'CAMPUS_BOOKING_ONE'));
router.post('/bookings/:id/proof', handler(St.submitProof, 'CAMPUS_BOOKING_PROOF'));
router.post('/bookings/:id/cancel', handler(St.cancel, 'CAMPUS_BOOKING_CANCEL'));

// ── Stalls (ZCS Vendor app) ─────────────────────────────────────────────────
const vendorRouter = express.Router();
vendorRouter.use(protect, V.storeOnly, noStore);
vendorRouter.get('/summary', handler(V.summary, 'CAMPUS_BOOKING_VENDOR'));
vendorRouter.get('/bookings', handler(V.list, 'CAMPUS_BOOKING_VENDOR'));
vendorRouter.get('/bookings/:id', handler(V.getOne, 'CAMPUS_BOOKING_VENDOR'));
vendorRouter.post('/bookings/:id/confirm-payment', handler(V.confirmPayment, 'CAMPUS_BOOKING_VENDOR'));
vendorRouter.post('/bookings/:id/reject-payment', handler(V.rejectPayment, 'CAMPUS_BOOKING_VENDOR'));
vendorRouter.post('/bookings/:id/preparing', handler(V.markPreparing, 'CAMPUS_BOOKING_VENDOR'));
vendorRouter.post('/bookings/:id/ready', handler(V.markReady, 'CAMPUS_BOOKING_VENDOR'));
vendorRouter.post('/bookings/:id/collect', handler(V.collect, 'CAMPUS_BOOKING_VENDOR'));
vendorRouter.post('/bookings/:id/cancel', handler(V.cancel, 'CAMPUS_BOOKING_VENDOR'));
vendorRouter.get('/earnings', handler(V.earnings, 'CAMPUS_BOOKING_VENDOR'));
vendorRouter.get('/settings', handler(V.getSettings, 'CAMPUS_BOOKING_VENDOR'));
vendorRouter.put('/settings', handler(V.updateSettings, 'CAMPUS_BOOKING_VENDOR'));

// ── Admin ───────────────────────────────────────────────────────────────────
const adminRouter = express.Router();
adminRouter.use(protect, admin, noStore);
adminRouter.get('/bookings', handler(A.listBookings, 'CAMPUS_BOOKING_ADMIN'));
adminRouter.get('/bookings/:id', handler(A.getBooking, 'CAMPUS_BOOKING_ADMIN'));
adminRouter.get('/stores', handler(A.listStores, 'CAMPUS_BOOKING_ADMIN'));
adminRouter.get('/stores/:id', handler(A.getStore, 'CAMPUS_BOOKING_ADMIN'));
adminRouter.put('/stores/:id', handler(A.updateStore, 'CAMPUS_BOOKING_ADMIN'));

module.exports = { router, vendorRouter, adminRouter };
