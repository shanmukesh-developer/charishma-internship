const express = require('express');
const router = express.Router();
const appConfigController = require('../controllers/appConfigController');
const { protect, admin } = require('../middleware/authMiddleware');

// Get global app configuration (public, used by web & mobile)
// Short server cache + ETag; PUT below publishes 'config', which clears it (utils/realtime).
// A signed-in live admin always reads the database (no-store): the dashboard reads the banner list,
// edits it and PUTs the whole list back, so a cached copy (up to 60 s old, or from another cluster
// worker whose cache was not cleared) could wipe a banner added moments earlier.
const { cacheGet, liveAdminBypass } = require('../utils/responseCache');
router.get('/', cacheGet('config', { ttlMs: 60 * 1000, bypass: liveAdminBypass }), appConfigController.getConfig);

// C3 force-update: one app's version policy (public, no auth). ?app=customer|rider|restaurant|vendor|autodriver
// Cached 30 s per app; an admin change (PUT /api/admin/app-versions) publishes 'config', which clears it.
router.get('/app-version', cacheGet('config', { ttlMs: 30 * 1000 }), require('../controllers/appVersionController').getPublicAppVersion);

// Update global app configuration (admin only)
router.put('/', protect, admin, appConfigController.updateConfig);

// Add/update or remove ONE Home banner atomically (store "Home banner" toggle, store hide/delete).
router.post('/banners', protect, admin, appConfigController.upsertBanner);
router.delete('/banners', protect, admin, appConfigController.removeBanner);

module.exports = router;
