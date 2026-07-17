const express = require('express');
const router = express.Router();
const appConfigController = require('../controllers/appConfigController');
const { protect } = require('../middleware/authMiddleware');

// Get global app configuration (public, used by web & mobile)
router.get('/', appConfigController.getConfig);

// Update global app configuration (admin only)
router.put('/', protect, appConfigController.updateConfig);

module.exports = router;
