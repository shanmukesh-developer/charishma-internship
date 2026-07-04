const express = require('express');
const router = express.Router();
const { protect, admin } = require('../middleware/authMiddleware');
const { getBikePoolModel } = require('../models/BikePool');
const { getUserModel } = require('../models/User');
const { Op } = require('sequelize');

const { getPoolRequestModel } = require('../models/PoolRequest');

// Create a new bike pool post
router.post('/posts', protect, async (req, res) => {
  const { creatorRole, origin, destination, departureTime, rideVibe, vehicleType, availableSeats, autoApprove, stopovers, vehicleInfo, notes } = req.body;

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

    const newPost = await BikePool.create({
      creatorId: currentUser.id,
      creatorRole,
      origin,
      destination,
      departureTime: new Date(departureTime),
      estimatedFuelCost: 0,
      splitAmount: 0,
      vehicleType: vehicleType || 'Bike',
      availableSeats: availableSeats || 1,
      autoApprove: autoApprove || false,
      stopovers: stopovers || [],
      rideVibe: rideVibe || 'Any',
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
      include: [{ model: User, as: 'creator', attributes: ['id', 'gender', 'genderPreference', 'karmaPoints'] }]
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

    // Wallet Balance Check Removed. Free Community Ride!
    
    const PoolRequest = getPoolRequestModel();

    // Check if already requested
    const existingRequest = await PoolRequest.findOne({ where: { poolId: pool.id, passengerId: currentUser.id } });
    if (existingRequest) {
      return res.status(400).json({ message: 'You have already requested to join this ride.' });
    }

    if (pool.autoApprove) {
      await PoolRequest.create({
        poolId: pool.id,
        passengerId: currentUser.id,
        status: 'Approved'
      });
      pool.availableSeats = Math.max(0, pool.availableSeats - 1);
      if (pool.availableSeats === 0) {
        pool.status = 'Matched';
      }
      // Legacy support for coRiderId mapping
      if (!pool.coRiderId) pool.coRiderId = currentUser.id;
      await pool.save();
      return res.json({ message: 'Successfully joined ride! (Auto-Approved)', pool });
    } else {
      await PoolRequest.create({
        poolId: pool.id,
        passengerId: currentUser.id,
        status: 'Pending'
      });
      return res.json({ message: 'Request sent to host for approval.', pool });
    }
  } catch (err) {
    console.error('[BIKEPOOL_JOIN_ERROR]', err);
    res.status(500).json({ message: 'Failed to join ride pool.', error: err.message });
  }
});

// Approve a join request
router.post('/posts/:id/requests/:requestId/approve', protect, async (req, res) => {
  try {
    const BikePool = getBikePoolModel();
    const PoolRequest = getPoolRequestModel();
    
    const pool = await BikePool.findByPk(req.params.id);
    if (!pool) return res.status(404).json({ message: 'Pool not found.' });
    if (pool.creatorId !== req.user.id) return res.status(403).json({ message: 'Unauthorized' });
    if (pool.availableSeats <= 0) return res.status(400).json({ message: 'No seats left.' });

    const request = await PoolRequest.findByPk(req.params.requestId);
    if (!request || request.poolId !== pool.id) return res.status(404).json({ message: 'Request not found.' });

    request.status = 'Approved';
    await request.save();

    pool.availableSeats -= 1;
    if (pool.availableSeats === 0) {
      pool.status = 'Matched';
    }
    if (!pool.coRiderId) pool.coRiderId = request.passengerId; // Legacy support
    await pool.save();

    res.json({ message: 'Request approved.', pool });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Reject a join request
router.post('/posts/:id/requests/:requestId/reject', protect, async (req, res) => {
  try {
    const BikePool = getBikePoolModel();
    const PoolRequest = getPoolRequestModel();
    
    const pool = await BikePool.findByPk(req.params.id);
    if (!pool) return res.status(404).json({ message: 'Pool not found.' });
    if (pool.creatorId !== req.user.id) return res.status(403).json({ message: 'Unauthorized' });

    const request = await PoolRequest.findByPk(req.params.requestId);
    if (!request || request.poolId !== pool.id) return res.status(404).json({ message: 'Request not found.' });

    request.status = 'Rejected';
    await request.save();

    res.json({ message: 'Request rejected.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Complete ride
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

    const PoolRequest = getPoolRequestModel();

    // The person calling this must be the creator (only they can complete a multi-passenger ride)
    if (pool.creatorId !== req.user.id) {
      return res.status(403).json({ message: 'Only the creator can complete the ride.' });
    }

    const karmaReward = 50; // 50 Karma points for eco-friendly ride

    try {
      const { getSequelize } = require('../config/db');
      const sequelize = getSequelize();

      await sequelize.transaction(async (t) => {
        const freshCreator = await User.findByPk(pool.creatorId, { transaction: t, lock: true });
        freshCreator.karmaPoints = (freshCreator.karmaPoints || 0) + karmaReward;
        await freshCreator.save({ transaction: t });

        // Get all approved requests
        const approvedRequests = await PoolRequest.findAll({
          where: { poolId: pool.id, status: 'Approved' },
          transaction: t
        });

        for (const req of approvedRequests) {
          const passenger = await User.findByPk(req.passengerId, { transaction: t, lock: true });
          if (passenger) {
            passenger.karmaPoints = (passenger.karmaPoints || 0) + karmaReward;
            await passenger.save({ transaction: t });
          }
        }

        // Mark completed
        pool.status = 'Completed';
        pool.paymentStatus = 'Paid';
        await pool.save({ transaction: t });
      });

      const updatedCreator = await User.findByPk(pool.creatorId);

      res.json({
        message: 'Ride completed successfully! Everyone earned +50 Karma Points 🍃!',
        pool,
        karmaPoints: updatedCreator.karmaPoints
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
