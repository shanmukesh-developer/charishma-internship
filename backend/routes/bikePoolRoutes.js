const express = require('express');
const router = express.Router();
const { protect, admin } = require('../middleware/authMiddleware');
const { getBikePoolModel } = require('../models/BikePool');
const { getUserModel } = require('../models/User');
const { Op } = require('sequelize');

// Create a new bike pool post
router.post('/posts', protect, async (req, res) => {
  const { creatorRole, origin, destination, departureTime, estimatedFuelCost, vehicleInfo, notes } = req.body;

  if (!creatorRole || !origin || !destination || !departureTime) {
    return res.status(400).json({ message: 'Role, origin, destination, and departure time are required.' });
  }

  try {
    const BikePool = getBikePoolModel();
    const User = getUserModel();
    const currentUser = await User.findByPk(req.user.id);

    if (!currentUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    const fuelCost = parseFloat(estimatedFuelCost) || 0;
    if (fuelCost < 0 || fuelCost > 500) {
      return res.status(400).json({ message: 'Estimated fuel cost must be between ₹0 and ₹500.' });
    }
    const splitAmount = fuelCost / 2;

    const newPost = await BikePool.create({
      creatorId: currentUser.id,
      creatorRole,
      origin,
      destination,
      departureTime: new Date(departureTime),
      estimatedFuelCost: fuelCost,
      splitAmount,
      vehicleInfo: creatorRole === 'rider' ? vehicleInfo : null,
      genderPreference: currentUser.genderPreference || 'Any',
      notes,
      status: 'Available',
      paymentStatus: 'Unpaid'
    });

    res.status(201).json(newPost);
  } catch (err) {
    console.error('[BIKEPOOL_CREATE_ERROR]', err);
    res.status(500).json({ message: 'Failed to create bike pool post.', error: err.message });
  }
});

// List available bike pools
router.get('/posts', protect, async (req, res) => {
  try {
    const BikePool = getBikePoolModel();
    const User = getUserModel();

    const currentUser = await User.findByPk(req.user.id);
    if (!currentUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    const availablePools = await BikePool.findAll({
      where: {
        status: 'Available',
        creatorId: { [Op.ne]: currentUser.id }
      },
      include: [
        {
          model: User,
          as: 'creator',
          attributes: ['id', 'name', 'phone', 'gender', 'genderPreference', 'profileImage']
        }
      ],
      order: [['departureTime', 'ASC']]
    });

    // Enforce safety/gender matching rules in memory for high fidelity filtering
    const filteredPools = availablePools.filter(pool => {
      const creator = pool.creator;
      if (!creator) return false;

      const creatorGender = creator.gender || 'Prefer not to say';
      const creatorPref = creator.genderPreference || 'Any';
      const userGender = currentUser.gender || 'Prefer not to say';
      const userPref = currentUser.genderPreference || 'Any';

      // Rule 1: If creator wants Same Gender Only, genders must match
      if (creatorPref === 'Same Gender Only' && creatorGender !== userGender) {
        return false;
      }

      // Rule 2: If current user wants Same Gender Only, genders must match
      if (userPref === 'Same Gender Only' && creatorGender !== userGender) {
        return false;
      }

      return true;
    });

    res.json(filteredPools);
  } catch (err) {
    console.error('[BIKEPOOL_LIST_ERROR]', err);
    res.status(500).json({ message: 'Failed to fetch available pools.', error: err.message });
  }
});

// Join a bike pool post
router.post('/posts/:id/join', protect, async (req, res) => {
  try {
    const BikePool = getBikePoolModel();
    const User = getUserModel();
    const { id } = req.params;

    const pool = await BikePool.findByPk(id, {
      include: [{ model: User, as: 'creator', attributes: ['id', 'gender', 'genderPreference', 'walletBalance'] }]
    });

    if (!pool) {
      return res.status(404).json({ message: 'Bike pool listing not found.' });
    }

    if (pool.status !== 'Available') {
      return res.status(400).json({ message: 'This ride is no longer available.' });
    }

    if (pool.creatorId === req.user.id) {
      return res.status(400).json({ message: 'You cannot join your own ride.' });
    }

    const currentUser = await User.findByPk(req.user.id);
    if (!currentUser) {
      return res.status(404).json({ message: 'User not found.' });
    }

    // Gender Matching Checks
    const creatorGender = pool.creator.gender || 'Prefer not to say';
    const creatorPref = pool.creator.genderPreference || 'Any';
    const userGender = currentUser.gender || 'Prefer not to say';
    const userPref = currentUser.genderPreference || 'Any';

    if ((creatorPref === 'Same Gender Only' || userPref === 'Same Gender Only') && creatorGender !== userGender) {
      return res.status(400).json({ message: 'Safety check failed: Gender preferences mismatch.' });
    }

    // Wallet Balance Check for Passenger
    const isCurrentUserPassenger = pool.creatorRole === 'rider';
    const passengerBalance = isCurrentUserPassenger ? currentUser.walletBalance : pool.creator.walletBalance;

    if (passengerBalance < pool.splitAmount) {
      const targetUser = isCurrentUserPassenger ? 'You have' : 'The poster has';
      return res.status(400).json({ 
        message: `${targetUser} insufficient wallet balance (₹${pool.splitAmount} required) to pool together.` 
      });
    }

    pool.coRiderId = currentUser.id;
    pool.status = 'Matched';
    await pool.save();

    res.json({ message: 'Successfully matched!', pool });
  } catch (err) {
    console.error('[BIKEPOOL_JOIN_ERROR]', err);
    res.status(500).json({ message: 'Failed to join ride pool.', error: err.message });
  }
});

// Complete ride & split petrol bill
router.post('/posts/:id/complete', protect, async (req, res) => {
  try {
    const BikePool = getBikePoolModel();
    const User = getUserModel();
    const { id } = req.params;

    const pool = await BikePool.findByPk(id);

    if (!pool) {
      return res.status(404).json({ message: 'Bike pool listing not found.' });
    }

    if (pool.status !== 'Matched') {
      return res.status(400).json({ message: 'Only matched rides can be completed.' });
    }

    if (pool.creatorId !== req.user.id && pool.coRiderId !== req.user.id) {
      return res.status(403).json({ message: 'You are not a participant in this ride.' });
    }

    // Identify roles
    let riderId, passengerId;
    if (pool.creatorRole === 'rider') {
      riderId = pool.creatorId;
      passengerId = pool.coRiderId;
    } else {
      riderId = pool.coRiderId;
      passengerId = pool.creatorId;
    }

    const splitCost = pool.splitAmount;

    try {
      const { getSequelize } = require('../config/db');
      const sequelize = getSequelize();

      await sequelize.transaction(async (t) => {
        // Re-fetch users inside transaction with a row lock (FOR UPDATE)
        const freshPassenger = await User.findByPk(passengerId, { transaction: t, lock: true });
        const freshRider = await User.findByPk(riderId, { transaction: t, lock: true });

        if (!freshPassenger || !freshRider) {
          throw new Error('Rider or passenger account not found.');
        }

        if (freshPassenger.walletBalance < splitCost) {
          throw new Error(`Insufficient wallet balance for Passenger (needs ₹${splitCost}, has ₹${freshPassenger.walletBalance}).`);
        }

        // Perform updates atomically
        freshPassenger.walletBalance = Math.max(0, freshPassenger.walletBalance - splitCost);
        freshRider.walletBalance = (freshRider.walletBalance || 0) + splitCost;

        await freshPassenger.save({ transaction: t });
        await freshRider.save({ transaction: t });

        // Mark completed
        pool.status = 'Completed';
        pool.paymentStatus = 'Paid';
        await pool.save({ transaction: t });
      });

      // Fetch fresh states to return in response
      const updatedRider = await User.findByPk(riderId);
      const updatedPassenger = await User.findByPk(passengerId);

      res.json({
        message: 'Ride completed successfully and petrol cost split completed!',
        pool,
        walletBalance: req.user.id === riderId ? updatedRider.walletBalance : updatedPassenger.walletBalance
      });
    } catch (txErr) {
      return res.status(400).json({ message: txErr.message || 'Transaction failed.' });
    }
  } catch (err) {
    console.error('[BIKEPOOL_COMPLETE_ERROR]', err);
    res.status(500).json({ message: 'Failed to complete ride splitting.', error: err.message });
  }
});

// Cancel or unmatch a pool
router.post('/posts/:id/cancel', protect, async (req, res) => {
  try {
    const BikePool = getBikePoolModel();
    const { id } = req.params;

    const pool = await BikePool.findByPk(id);

    if (!pool) {
      return res.status(404).json({ message: 'Bike pool listing not found.' });
    }

    if (pool.creatorId !== req.user.id && pool.coRiderId !== req.user.id) {
      return res.status(403).json({ message: 'You are not authorized to cancel this pool.' });
    }

    if (pool.status === 'Completed') {
      return res.status(400).json({ message: 'Cannot cancel a completed ride.' });
    }

    // If cancelled before match, delete or mark cancelled
    if (pool.status === 'Available') {
      pool.status = 'Cancelled';
      await pool.save();
      return res.json({ message: 'Listing cancelled successfully.', pool });
    }

    // If already matched, unmatch and set back to Available, clearing coRiderId
    if (pool.status === 'Matched') {
      pool.coRiderId = null;
      pool.status = 'Available';
      await pool.save();
      return res.json({ message: 'Matched co-rider removed. Ride is available again.', pool });
    }
  } catch (err) {
    console.error('[BIKEPOOL_CANCEL_ERROR]', err);
    res.status(500).json({ message: 'Failed to cancel pool.', error: err.message });
  }
});

// Retrieve user's rides (My active/completed/cancelled rides)
router.get('/my-rides', protect, async (req, res) => {
  try {
    const BikePool = getBikePoolModel();
    const User = getUserModel();

    const myRides = await BikePool.findAll({
      where: {
        [Op.or]: [
          { creatorId: req.user.id },
          { coRiderId: req.user.id }
        ]
      },
      include: [
        {
          model: User,
          as: 'creator',
          attributes: ['id', 'name', 'phone', 'gender', 'profileImage']
        },
        {
          model: User,
          as: 'coRider',
          attributes: ['id', 'name', 'phone', 'gender', 'profileImage']
        }
      ],
      order: [['createdAt', 'DESC']]
    });

    res.json(myRides);
  } catch (err) {
    console.error('[BIKEPOOL_MYRIDES_ERROR]', err);
    res.status(500).json({ message: 'Failed to fetch your rides.', error: err.message });
  }
});

// ─── Admin Moderation Routes ────────────────────────────────
router.post('/admin/:id/force-cancel', protect, admin, async (req, res) => {
  try {
    const BikePool = getBikePoolModel();
    const pool = await BikePool.findByPk(req.params.id);
    if (!pool) return res.status(404).json({ message: 'Pool not found.' });
    if (pool.status === 'Completed' || pool.status === 'Cancelled') {
      return res.status(400).json({ message: 'Cannot cancel a completed or already cancelled ride.' });
    }
    pool.status = 'Cancelled';
    await pool.save();
    res.json({ message: 'Listing forcibly cancelled by Admin.', pool });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/admin/:id/mark-paid', protect, admin, async (req, res) => {
  try {
    const BikePool = getBikePoolModel();
    const pool = await BikePool.findByPk(req.params.id);
    if (!pool) return res.status(404).json({ message: 'Pool not found.' });
    pool.paymentStatus = 'Paid';
    await pool.save();
    res.json({ message: 'Listing forcibly marked as Paid by Admin.', pool });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Admin All Pools
router.get('/admin/all', protect, admin, async (req, res) => {
  try {
    const BikePool = getBikePoolModel();
    const User = getUserModel();
    const pools = await BikePool.findAll({
      include: [
        { model: User, as: 'creator', attributes: ['id', 'name', 'phone', 'gender'] },
        { model: User, as: 'coRider', attributes: ['id', 'name', 'phone'] }
      ],
      order: [['createdAt', 'DESC']]
    });
    res.json(pools);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
