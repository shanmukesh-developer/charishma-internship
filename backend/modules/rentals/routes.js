// /api/rentals/* (students) and /api/admin/rentals/* (admins). Mounted in server.js.
const express = require('express');
const { protect, admin } = require('../../middleware/authMiddleware');
const { handler } = require('./services/util');
const { requireRentals } = require('./services/eligibility');
const L = require('./controllers/listings');
const B = require('./controllers/bookings');
const Lic = require('./controllers/licence');
const A = require('./controllers/admin');

const noStore = (req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); };

// ── Students ────────────────────────────────────────────────────────────────
const router = express.Router();
router.use(protect, noStore);

const signedIn = requireRentals({ signedInOnly: true });
const eligible = requireRentals();
// Trips already agreed keep working while the feature switch is off.
const partyOnly = requireRentals({ signedInOnly: true, allowWhenOff: true });

router.get('/eligibility', handler(L.eligibility, 'RENTALS_ELIGIBILITY'));

router.get('/listings', signedIn, handler(L.browse, 'RENTALS_BROWSE'));
router.get('/listings/:id', signedIn, handler(L.detail, 'RENTALS_DETAIL'));
router.get('/listings/:id/quote', signedIn, handler(L.getQuote, 'RENTALS_QUOTE'));
router.post('/listings', eligible, handler(L.create, 'RENTALS_LISTING_CREATE'));
router.patch('/listings/:id', eligible, handler(L.update, 'RENTALS_LISTING_UPDATE'));
router.post('/listings/:id/submit', eligible, handler(L.submit, 'RENTALS_LISTING_SUBMIT'));
router.post('/listings/:id/pause', partyOnly, handler(L.pause, 'RENTALS_LISTING_PAUSE'));
router.post('/listings/:id/resume', eligible, handler(L.resume, 'RENTALS_LISTING_RESUME'));
router.delete('/listings/:id', partyOnly, handler(L.remove, 'RENTALS_LISTING_DELETE'));
router.get('/my/listings', partyOnly, handler(L.myListings, 'RENTALS_MY_LISTINGS'));

router.get('/licence', partyOnly, handler(Lic.getMine, 'RENTALS_LICENCE'));
router.put('/licence', eligible, handler(Lic.upsert, 'RENTALS_LICENCE_PUT'));

router.post('/bookings', eligible, handler(B.create, 'RENTALS_BOOKING_CREATE'));
router.get('/bookings', partyOnly, handler(B.list, 'RENTALS_BOOKINGS'));
router.get('/bookings/:id', partyOnly, handler(B.getOne, 'RENTALS_BOOKING'));
router.post('/bookings/:id/accept', eligible, handler(B.accept, 'RENTALS_ACCEPT'));
router.post('/bookings/:id/decline', partyOnly, handler(B.decline, 'RENTALS_DECLINE'));
router.post('/bookings/:id/cancel', partyOnly, handler(B.cancel, 'RENTALS_CANCEL'));
router.post('/bookings/:id/handover', partyOnly, handler(B.handover, 'RENTALS_HANDOVER'));
router.post('/bookings/:id/return', partyOnly, handler(B.markReturned, 'RENTALS_RETURN'));
router.post('/bookings/:id/complete', partyOnly, handler(B.complete, 'RENTALS_COMPLETE'));
router.post('/bookings/:id/rate', partyOnly, handler(B.rate, 'RENTALS_RATE'));
router.post('/bookings/:id/report', partyOnly, handler(B.report, 'RENTALS_REPORT'));
// C7 safety: per-booking terms (older app builds), pickup / return condition, extra-charges answer.
router.post('/bookings/:id/terms', partyOnly, handler(B.acceptTerms, 'RENTALS_TERMS'));
router.post('/bookings/:id/condition', partyOnly, handler(B.condition, 'RENTALS_CONDITION'));
router.post('/bookings/:id/charges', partyOnly, handler(B.respondCharges, 'RENTALS_CHARGES'));

// ── Admin ───────────────────────────────────────────────────────────────────
const adminRouter = express.Router();
adminRouter.use(protect, admin, noStore);
adminRouter.get('/summary', handler(A.summary, 'RENTALS_ADMIN'));
adminRouter.get('/listings', handler(A.listings, 'RENTALS_ADMIN'));
adminRouter.get('/listings/:id', handler(A.listingDetail, 'RENTALS_ADMIN'));
adminRouter.post('/listings/:id/approve', handler(A.approve, 'RENTALS_ADMIN'));
adminRouter.post('/listings/:id/reject', handler(A.reject, 'RENTALS_ADMIN'));
adminRouter.get('/licences', handler(A.licences, 'RENTALS_ADMIN'));
adminRouter.post('/licences/:id/verify', handler(A.verifyLicence, 'RENTALS_ADMIN'));
adminRouter.post('/licences/:id/reject', handler(A.rejectLicence, 'RENTALS_ADMIN'));
adminRouter.get('/bookings', handler(A.bookings, 'RENTALS_ADMIN'));
adminRouter.get('/reports', handler(A.reports, 'RENTALS_ADMIN'));
adminRouter.post('/reports/:id/status', handler(A.updateReport, 'RENTALS_ADMIN'));
adminRouter.get('/disputes', handler(A.disputes, 'RENTALS_ADMIN'));
adminRouter.post('/disputes/:id/resolve', handler(A.resolveDispute, 'RENTALS_ADMIN'));
adminRouter.get('/settings', handler(A.getSettings, 'RENTALS_ADMIN'));
adminRouter.put('/settings', handler(A.putSettings, 'RENTALS_ADMIN'));

module.exports = { router, adminRouter };
