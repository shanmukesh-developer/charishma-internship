const express = require('express');
const router = express.Router();
const { protect, admin } = require('../middleware/authMiddleware');
const { getBikePoolModel } = require('../models/BikePool');
const { getUserModel } = require('../models/User');
const { Op } = require('sequelize');

const { getPoolRequestModel } = require('../models/PoolRequest');
const { sendServerError } = require('../utils/httpErrors');
// Push + inbox row to the other side of a Co-Ride action (never blocks the reply; failures are logged there).
const notify = (userIds, title, body, data) => { void require('../services/coRideTemplates').pushUsers(userIds, title, body, { screen: 'coride', ...data }); };
// Pushes a passenger can trigger again and again (join -> withdraw -> join, join -> leave on an auto-approve ride) reach
// the host once per passenger, ride and kind in NOTIFY_ONCE_MS; the request list in My rides always shows the current
// state. In memory: after a restart at most one more push.
const NOTIFY_ONCE_MS = 10 * 60 * 1000;
const notifiedAt = new Map();
const notifyOnce = (key, userIds, title, body, data, now = Date.now()) => {
  const last = notifiedAt.get(key);
  if (last && now - last < NOTIFY_ONCE_MS) return false;
  notifiedAt.set(key, now);
  if (notifiedAt.size > 5000) for (const [k, t] of notifiedAt) if (now - t >= NOTIFY_ONCE_MS) notifiedAt.delete(k);
  notify(userIds, title, body, data);
  return true;
};
const firstName = (u) => String((u && u.name) || '').trim().split(/\s+/)[0] || 'A student';
// A ride that left this long ago takes no more approvals (it stays open only until the host marks it complete).
const APPROVE_AFTER_DEPARTURE_MS = 30 * 60 * 1000;
const { isFemale, rodeTogetherBefore, WOMEN_ONLY_HOST_MSG, WOMEN_ONLY_JOIN_MSG } = require('../utils/coRide');
const rateLimit = require('express-rate-limit');

// Non-UUID ids answer 404 instead of a Postgres error (B23).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
router.param('id', (req, res, next, id) => (UUID_RE.test(String(id || '')) ? next() : res.status(404).json({ message: 'Bike pool listing not found.' })));
router.param('requestId', (req, res, next, id) => (UUID_RE.test(String(id || '')) ? next() : res.status(404).json({ message: 'Request not found.' })));
// Bounded lists (B23): ?limit (max 100) & ?offset.
const pageOf = (req, dflt = 50) => ({
  limit: Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || dflt)),
  offset: Math.max(0, parseInt(req.query.offset, 10) || 0),
});
const POOL_ROLES = ['rider', 'passenger'];
const VEHICLE_TYPES = ['Bike', 'Car', 'Auto', 'Scooter'];
const cleanStr = (v, max) => String(v).replace(/[<>]/g, '').trim().slice(0, max);

// Atomic seat claim: decrements only while a seat is left and the ride is open.
const takeSeat = async (poolId) => {
  const BikePool = getBikePoolModel();
  const { literal } = require('sequelize');
  const [n] = await BikePool.update(
    { availableSeats: literal('"availableSeats" - 1') },
    { where: { id: poolId, status: 'Available', availableSeats: { [Op.gt]: 0 } } }
  );
  return n === 1;
};
// After a seat is taken: mark the ride Matched when full and fill the legacy coRiderId.
const finishSeatTaken = async (poolId, passengerId) => {
  const BikePool = getBikePoolModel();
  await BikePool.update({ status: 'Matched' }, { where: { id: poolId, status: 'Available', availableSeats: { [Op.lte]: 0 } } });
  await BikePool.update({ coRiderId: passengerId }, { where: { id: poolId, coRiderId: null } });
};

// Create a new bike pool post
router.post('/posts', protect, async (req, res) => {
  const { creatorRole, origin, destination, departureTime, rideVibe, vehicleType, availableSeats, autoApprove, stopovers, vehicleInfo, notes, isRecurring, recurringDays, estimatedFuelCost, womenOnly, autoAcceptKnown } = req.body;

  if (!creatorRole || !origin || !destination || !departureTime) {
    return res.status(400).json({ message: 'Role, origin, destination, and departure time are required.' });
  }
  // Input validation (B23): enums, plain text, bounded lists and numbers.
  if (!POOL_ROLES.includes(creatorRole)) return res.status(400).json({ message: 'Role must be rider or passenger.' });
  if (typeof origin !== 'string' || typeof destination !== 'string' || !origin.trim() || !destination.trim()) {
    return res.status(400).json({ message: 'Origin and destination must be text.' });
  }
  if (vehicleType != null && vehicleType !== '' && !VEHICLE_TYPES.includes(vehicleType)) return res.status(400).json({ message: `Vehicle must be one of ${VEHICLE_TYPES.join(', ')}.` });
  // The app sends labels like 'Silent Ride 🤫': short text, not a fixed list.
  if (rideVibe != null && (typeof rideVibe !== 'string' || rideVibe.length > 30)) return res.status(400).json({ message: 'Ride vibe must be short text.' });
  if (notes != null && typeof notes !== 'string') return res.status(400).json({ message: 'Notes must be text.' });
  if (vehicleInfo != null && (typeof vehicleInfo !== 'string' || vehicleInfo.length > 120)) return res.status(400).json({ message: 'Vehicle details must be text under 120 characters.' });
  if (stopovers != null && (!Array.isArray(stopovers) || stopovers.length > 5 || stopovers.some((x) => typeof x !== 'string' || x.length > 80))) {
    return res.status(400).json({ message: 'Add at most 5 stopovers, each under 80 characters.' });
  }
  if (recurringDays != null && (!Array.isArray(recurringDays) || recurringDays.length > 7 || recurringDays.some((x) => typeof x !== 'string' && typeof x !== 'number'))) {
    return res.status(400).json({ message: 'Recurring days must be a list of weekdays.' });
  }
  const fuel = estimatedFuelCost === undefined || estimatedFuelCost === null || estimatedFuelCost === '' ? 0 : Number(estimatedFuelCost);
  if (!Number.isFinite(fuel) || fuel < 0 || fuel > 5000) return res.status(400).json({ message: 'Fuel cost must be between ₹0 and ₹5000.' });
  const departure = new Date(departureTime);
  if (Number.isNaN(departure.getTime()) || departure.getTime() < Date.now() - 5 * 60 * 1000) {
    return res.status(400).json({ message: 'Pick a departure time that is still ahead.' });
  }
  const seats = availableSeats === undefined || availableSeats === null || availableSeats === '' ? 1 : Number(availableSeats);
  if (!Number.isInteger(seats) || seats < 1 || seats > 6) {
    return res.status(400).json({ message: 'Seats must be between 1 and 6.' });
  }
  if (String(origin).length > 120 || String(destination).length > 120 || (notes && String(notes).length > 300)) {
    return res.status(400).json({ message: 'Please keep places under 120 characters and notes under 300.' });
  }
  if (womenOnly != null && typeof womenOnly !== 'boolean') return res.status(400).json({ message: 'womenOnly must be true or false.' });
  if (autoAcceptKnown != null && typeof autoAcceptKnown !== 'boolean') return res.status(400).json({ message: 'autoAcceptKnown must be true or false.' });

  try {
    const BikePool = getBikePoolModel();
    const User = getUserModel();
    const currentUser = await User.findByPk(req.user.id);

    if (!currentUser) {
      return res.status(404).json({ message: 'User not found' });
    }
    // Women-only rides: only a host whose profile gender is Female may post one.
    if (womenOnly === true && !isFemale(currentUser)) {
      return res.status(403).json({ code: 'WOMEN_ONLY_HOST', message: WOMEN_ONLY_HOST_MSG });
    }

    const newPost = await BikePool.create({
      creatorId: currentUser.id,
      creatorRole,
      origin: cleanStr(origin, 120),
      destination: cleanStr(destination, 120),
      departureTime: departure,
      estimatedFuelCost: Math.round(fuel * 100) / 100,
      splitAmount: 0,
      vehicleType: vehicleType || 'Bike',
      availableSeats: seats,
      autoApprove: autoApprove === true,
      autoAcceptKnown: autoAcceptKnown === true,
      womenOnly: womenOnly === true,
      isRecurring: isRecurring === true,
      recurringDays: Array.isArray(recurringDays) ? recurringDays.map((d) => String(d).slice(0, 10)) : [],
      stopovers: Array.isArray(stopovers) ? stopovers.map((x) => cleanStr(x, 80)).filter(Boolean) : [],
      rideVibe: rideVibe ? cleanStr(rideVibe, 30) : 'Any',
      vehicleInfo: creatorRole === 'rider' && vehicleInfo ? cleanStr(vehicleInfo, 120) : null,
      genderPreference: currentUser.genderPreference || 'Any',
      notes: notes ? cleanStr(notes, 300) : null,
      status: 'Available',
      paymentStatus: 'Unpaid'
    });

    res.status(201).json(newPost);
  } catch (err) {
    console.error('[BIKEPOOL_CREATE_ERROR]', err);
    sendServerError(res, err, '[BIKEPOOLROUTES_ERROR]');
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
        creatorId: { [Op.ne]: currentUser.id },
        availableSeats: { [Op.gt]: 0 },
        // Rides that already left are not joinable (B23)
        departureTime: { [Op.gte]: new Date() }
      },
      include: [
        {
          model: User,
          as: 'creator',
          // No phone in the public board: it is shared only once a seat is approved (see /my-rides).
          attributes: ['id', 'name', 'gender', 'genderPreference', 'profileImage']
        }
      ],
      order: [['departureTime', 'ASC']],
      ...pageOf(req, 50)
    });

    // Enforce safety/gender matching rules in memory for high fidelity filtering
    const filteredPools = availablePools.filter(pool => {
      const creator = pool.creator;
      if (!creator) return false;
      // Women-only rides are not shown to riders who could not join them.
      if (pool.womenOnly && !isFemale(currentUser)) return false;

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
    sendServerError(res, err, '[BIKEPOOLROUTES_ERROR]');
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

    // A ride whose host account is gone cannot be joined (was a crash on pool.creator.gender).
    if (!pool || !pool.creator) {
      return res.status(404).json({ message: 'Bike pool listing not found.' });
    }

    if (pool.status !== 'Available') {
      return res.status(400).json({ message: 'This ride is no longer available.' });
    }
    if (new Date(pool.departureTime).getTime() < Date.now()) {
      return res.status(400).json({ code: 'RIDE_DEPARTED', message: 'This ride has already left.' });
    }

    if (pool.creatorId === req.user.id) {
      return res.status(400).json({ message: 'You cannot join your own ride.' });
    }

    const currentUser = await User.findByPk(req.user.id);
    if (!currentUser) {
      return res.status(404).json({ message: 'User not found.' });
    }

    // Women-only ride: the rider's profile gender must be Female.
    if (pool.womenOnly && !isFemale(currentUser)) {
      return res.status(403).json({ code: 'WOMEN_ONLY', message: WOMEN_ONLY_JOIN_MSG });
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
    if (existingRequest && existingRequest.status !== 'Cancelled') {
      return res.status(400).json({ message: 'You have already requested to join this ride.' });
    }
    if (pool.availableSeats <= 0) {
      return res.status(400).json({ message: 'This ride is full.' });
    }
    // Claim ONE request row first (a double tap must never take two seats or earn karma twice):
    // reuse a withdrawn row only via a conditional flip, otherwise insert (unique on
    // poolId + passengerId, see config/db.js); whoever loses the race gets "already requested".
    const alreadyRequested = () => res.status(400).json({ message: 'You have already requested to join this ride.' });
    let requestId;
    if (existingRequest) {
      const [reopened] = await PoolRequest.update(
        { status: 'Pending' },
        { where: { id: existingRequest.id, status: 'Cancelled' } }
      );
      if (!reopened) return alreadyRequested();
      requestId = existingRequest.id;
    } else {
      try {
        const created = await PoolRequest.create({ poolId: pool.id, passengerId: currentUser.id, status: 'Pending' });
        requestId = created.id;
      } catch (createErr) {
        if (createErr && createErr.name === 'SequelizeUniqueConstraintError') return alreadyRequested();
        throw createErr;
      }
      // Without the unique index (old DB with duplicate rows) keep only the oldest live row.
      const live = await PoolRequest.findAll({
        where: { poolId: pool.id, passengerId: currentUser.id, status: { [Op.ne]: 'Cancelled' } },
        order: [['createdAt', 'ASC'], ['id', 'ASC']],
        attributes: ['id'],
      });
      if (live.length > 1 && String(live[0].id) !== String(requestId)) {
        await PoolRequest.update({ status: 'Cancelled' }, { where: { id: requestId } });
        return alreadyRequested();
      }
    }

    // autoAcceptKnown: someone who completed a ride with this host before is let in at once.
    // Women-only rides always wait for the host (31 Oct 2026): the gender check reads a profile field the rider
    // can edit, so the host sees who is asking before anyone gets in (and before any phone number is shared).
    const knownRider = !pool.womenOnly && !pool.autoApprove && pool.autoAcceptKnown ? await rodeTogetherBefore(pool.creatorId, currentUser.id) : false;
    if (!pool.womenOnly && (pool.autoApprove || knownRider)) {
      // Take the seat atomically: two students tapping at once can never overbook.
      const taken = await takeSeat(pool.id);
      if (!taken) {
        await PoolRequest.update({ status: 'Cancelled' }, { where: { id: requestId, status: 'Pending' } });
        return res.status(400).json({ message: 'This ride just filled up.' });
      }
      await PoolRequest.update({ status: 'Approved' }, { where: { id: requestId } });
      await finishSeatTaken(pool.id, currentUser.id);
      await pool.reload();
      notifyOnce(`joined:${pool.id}:${currentUser.id}`, [pool.creatorId], 'New co-rider', `${firstName(currentUser)} joined your ride to ${pool.destination}.`, {
        type: 'CORIDE_PASSENGER_JOINED', path: '/coride/my-rides', poolId: String(pool.id),
      });
      return res.json({ message: 'Successfully joined ride!', pool, autoAccepted: knownRider ? 'known' : 'auto' });
    } else {
      notifyOnce(`request:${pool.id}:${currentUser.id}`, [pool.creatorId], 'New ride request', `${firstName(currentUser)} asked to join your ride to ${pool.destination}. Approve or decline in My rides.`, {
        type: 'CORIDE_JOIN_REQUEST', path: '/coride/my-rides', poolId: String(pool.id),
      });
      return res.json({ message: 'Request sent to host for approval.', pool });
    }
  } catch (err) {
    console.error('[BIKEPOOL_JOIN_ERROR]', err);
    sendServerError(res, err, '[BIKEPOOLROUTES_ERROR]');
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
    if (request.status !== 'Pending') return res.status(400).json({ message: `This request is already ${String(request.status).toLowerCase()}.` });
    if (pool.status !== 'Available') return res.status(400).json({ message: 'This ride is no longer open.' });
    if (pool.departureTime && Date.now() - new Date(pool.departureTime).getTime() > APPROVE_AFTER_DEPARTURE_MS) {
      return res.status(400).json({ message: 'This ride has already left. Mark it complete or cancel it in My rides.' });
    }

    const [flipped] = await PoolRequest.update({ status: 'Approved' }, { where: { id: request.id, status: 'Pending' } });
    if (flipped === 0) return res.status(400).json({ message: 'This request was just withdrawn or answered.' });
    if (!(await takeSeat(pool.id))) {
      await PoolRequest.update({ status: 'Pending' }, { where: { id: request.id, status: 'Approved' } });
      return res.status(400).json({ message: 'No seats left.' });
    }
    await finishSeatTaken(pool.id, request.passengerId);
    await pool.reload();
    notify([request.passengerId], 'Ride confirmed', `Your seat on the ride to ${pool.destination} is confirmed.`, {
      type: 'CORIDE_REQUEST_APPROVED', poolId: String(pool.id),
    });

    res.json({ message: 'Request approved.', pool });
  } catch (err) {
    console.error('[BIKEPOOL_APPROVE_ERROR]', err);
    res.status(500).json({ message: 'Could not approve this request right now.' });
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

    if (request.status !== 'Pending') return res.status(400).json({ message: `This request is already ${String(request.status).toLowerCase()}.` });
    request.status = 'Rejected';
    await request.save();
    notify([request.passengerId], 'Ride request declined', `The host could not take you on the ride to ${pool.destination}. Find another ride in Co-Ride.`, {
      type: 'CORIDE_REQUEST_DECLINED', path: '/coride/find', poolId: String(pool.id),
    });

    res.json({ message: 'Request rejected.' });
  } catch (err) {
    sendServerError(res, err, '[BIKEPOOLROUTES_ERROR]');
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

    const PoolRequest = getPoolRequestModel();
    const hasApproved = await PoolRequest.findOne({ where: { poolId: pool.id, status: 'Approved' } });

    if (pool.status !== 'Matched' && !(pool.status === 'Available' && hasApproved)) {
      return res.status(400).json({ message: 'Only matched or joined rides can be completed.' });
    }

    if (pool.creatorId !== req.user.id && pool.coRiderId !== req.user.id) {
      return res.status(403).json({ message: 'You are not a participant in this ride.' });
    }

    // The person calling this must be the creator (only they can complete a multi-passenger ride)
    if (pool.creatorId !== req.user.id) {
      return res.status(403).json({ message: 'Only the creator can complete the ride.' });
    }
    // Karma is for a ride that happened (B23): not before its departure time.
    if (new Date(pool.departureTime).getTime() > Date.now()) {
      return res.status(400).json({ code: 'RIDE_NOT_STARTED', message: 'You can complete the ride after its departure time.' });
    }

    const karmaReward = 50; // 50 Karma points for eco-friendly ride

    try {
      const { getSequelize } = require('../config/db');
      const sequelize = getSequelize();

      await sequelize.transaction(async (t) => {
        // Exactly once: only the request that flips the ride to Completed hands out karma.
        const [flipped] = await BikePool.update(
          { status: 'Completed', paymentStatus: 'Paid' },
          { where: { id: pool.id, status: { [Op.in]: ['Matched', 'Available'] } }, transaction: t }
        );
        if (flipped === 0) throw Object.assign(new Error('This ride is already completed.'), { userFacing: true });
        const freshCreator = await User.findByPk(pool.creatorId, { transaction: t, lock: true });
        freshCreator.karmaPoints = (freshCreator.karmaPoints || 0) + karmaReward;
        await freshCreator.save({ transaction: t });

        // Get all approved requests
        const approvedRequests = await PoolRequest.findAll({
          where: { poolId: pool.id, status: 'Approved' },
          transaction: t
        });

        // One karma reward per passenger, however many request rows they have.
        const paidPassengers = new Set([String(pool.creatorId)]);
        for (const req of approvedRequests) {
          if (paidPassengers.has(String(req.passengerId))) continue;
          paidPassengers.add(String(req.passengerId));
          const passenger = await User.findByPk(req.passengerId, { transaction: t, lock: true });
          if (passenger) {
            passenger.karmaPoints = (passenger.karmaPoints || 0) + karmaReward;
            await passenger.save({ transaction: t });
          }
        }

        pool.status = 'Completed';
        pool.paymentStatus = 'Paid';
      });

      const updatedCreator = await User.findByPk(pool.creatorId);

      res.json({
        message: 'Ride completed successfully! Everyone earned +50 Karma Points 🍃!',
        pool,
        karmaPoints: updatedCreator.karmaPoints
      });
    } catch (txErr) {
      if (txErr.userFacing) return res.status(400).json({ message: txErr.message });
      console.error('[BIKEPOOL_COMPLETE_TX_ERROR]', txErr);
      return res.status(500).json({ message: 'Could not complete this ride right now. Please try again.' });
    }
  } catch (err) {
    console.error('[BIKEPOOL_COMPLETE_ERROR]', err);
    sendServerError(res, err, '[BIKEPOOLROUTES_ERROR]');
  }
});

// Cancel a ride.
// - Host: the whole ride is cancelled and every open request is closed.
// - Passenger: only their own seat is released (the ride reopens if it was full).
router.post('/posts/:id/cancel', protect, async (req, res) => {
  try {
    const BikePool = getBikePoolModel();
    const PoolRequest = getPoolRequestModel();
    const { id } = req.params;

    const pool = await BikePool.findByPk(id);

    if (!pool) {
      return res.status(404).json({ message: 'Bike pool listing not found.' });
    }

    if (pool.status === 'Completed') {
      return res.status(400).json({ message: 'Cannot cancel a completed ride.' });
    }
    if (pool.status === 'Cancelled') {
      return res.status(400).json({ message: 'This ride is already cancelled.' });
    }

    if (pool.creatorId === req.user.id) {
      const [closed] = await BikePool.update({ status: 'Cancelled' }, { where: { id: pool.id, status: { [Op.notIn]: ['Completed', 'Cancelled'] } } });
      if (!closed) return res.status(409).json({ message: 'This ride was just completed or cancelled. Please refresh.' });
      pool.status = 'Cancelled';
      const released = await PoolRequest.findAll({ where: { poolId: pool.id, status: { [Op.in]: ['Pending', 'Approved'] } }, attributes: ['passengerId'] });
      await PoolRequest.update(
        { status: 'Cancelled' },
        { where: { poolId: pool.id, status: { [Op.in]: ['Pending', 'Approved'] } } }
      );
      // Passengers used to keep seeing "Confirmed" and could turn up for a ride that was not happening.
      if (released.length) {
        notify(released.map((r) => r.passengerId), 'Ride cancelled', `Your ride to ${pool.destination} was cancelled by the host. Find another ride in Co-Ride.`, {
          type: 'CORIDE_RIDE_CANCELLED', poolId: String(pool.id),
        });
      }
      return res.json({ message: 'Ride cancelled. Your co-riders have been released.', pool });
    }

    const myRequest = await PoolRequest.findOne({
      where: { poolId: pool.id, passengerId: req.user.id, status: { [Op.in]: ['Pending', 'Approved'] } }
    });
    if (!myRequest) {
      return res.status(403).json({ message: 'You are not part of this ride.' });
    }

    const wasApproved = myRequest.status === 'Approved';
    // Conditional: a double tap can release the seat only once.
    const [withdrawn] = await PoolRequest.update(
      { status: 'Cancelled' },
      { where: { id: myRequest.id, status: myRequest.status } }
    );
    if (!withdrawn) return res.status(409).json({ message: 'Your request was just updated. Please refresh.' });

    if (wasApproved) {
      const { literal } = require('sequelize');
      await BikePool.update({ availableSeats: literal('COALESCE("availableSeats", 0) + 1') }, { where: { id: pool.id } });
      await BikePool.update({ status: 'Available' }, { where: { id: pool.id, status: 'Matched' } });
      if (pool.coRiderId === req.user.id) {
        const next = await PoolRequest.findOne({ where: { poolId: pool.id, status: 'Approved' }, order: [['createdAt', 'ASC']] });
        await BikePool.update({ coRiderId: next ? next.passengerId : null }, { where: { id: pool.id } });
      }
      await pool.reload();
      notifyOnce(`left:${pool.id}:${req.user.id}`, [pool.creatorId], 'A co-rider left', `${firstName(req.user)} left your ride to ${pool.destination}. The seat is open again.`, {
        type: 'CORIDE_PASSENGER_LEFT', path: '/coride/my-rides', poolId: String(pool.id),
      });
    }
    return res.json({ message: wasApproved ? 'You left this ride. Your seat is free again.' : 'Your join request was withdrawn.', pool });
  } catch (err) {
    console.error('[BIKEPOOL_CANCEL_ERROR]', err);
    res.status(500).json({ message: 'Failed to cancel pool.' });
  }
});

// Retrieve user's rides (My active/completed/cancelled rides)
router.get('/my-rides', protect, async (req, res) => {
  try {
    const BikePool = getBikePoolModel();
    const User = getUserModel();
    const PoolRequest = getPoolRequestModel();

    // Rides I host, plus every ride I asked to join (pending, approved, rejected or cancelled)
    const myRequests = await PoolRequest.findAll({ where: { passengerId: req.user.id }, attributes: ['poolId'] });
    const requestedPoolIds = [...new Set(myRequests.map(r => r.poolId).filter(Boolean))];
    const myRides = await BikePool.findAll({
      where: {
        [Op.or]: [
          { creatorId: req.user.id },
          { coRiderId: req.user.id },
          ...(requestedPoolIds.length ? [{ id: { [Op.in]: requestedPoolIds } }] : [])
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
        },
        {
          model: PoolRequest,
          as: 'requests',
          include: [
            {
              model: User,
              as: 'passenger',
              attributes: ['id', 'name', 'phone', 'gender', 'profileImage']
            }
          ]
        }
      ],
      order: [['createdAt', 'DESC']],
      limit: 100
    });

    // Phone numbers only between people who actually share the ride: the host sees approved
    // passengers' numbers, an approved passenger sees the host's. Nobody else's.
    const me = req.user.id;
    const scrubbed = myRides.map((ride) => {
      const json = ride.toJSON();
      const isHost = json.creatorId === me;
      const requests = Array.isArray(json.requests) ? json.requests : [];
      const approvedIds = new Set(requests.filter((r) => r.status === 'Approved').map((r) => r.passengerId));
      const iAmApproved = approvedIds.has(me);
      if (json.creator && !isHost && !iAmApproved) delete json.creator.phone;
      if (json.coRider && json.coRider.id !== me && !(isHost && approvedIds.has(json.coRider.id))) delete json.coRider.phone;
      json.requests = requests.map((r) => {
        if (r.passenger && r.passengerId !== me && !(isHost && r.status === 'Approved')) {
          const { phone: _phone, ...rest } = r.passenger;
          return { ...r, passenger: rest };
        }
        return r;
      });
      return json;
    });
    res.json(scrubbed);
  } catch (err) {
    console.error('[BIKEPOOL_MYRIDES_ERROR]', err);
    sendServerError(res, err, '[BIKEPOOLROUTES_ERROR]');
  }
});

// ─── Passenger / host SOS ───────────────────────────────────
// POST /api/bikepool/posts/:id/sos { lat?, lon?, note? } -> 201 { ok, ticketId, emergencyNumber, locationShared, message }
// Only the host or an approved rider of the ride (403 NOT_ON_RIDE otherwise). Creates a Critical support
// ticket (admin Tickets list), tells the admin panel live and pushes every admin device
// (utils/adminAlert.pushAdmins, as the Auto driver SOS does). 5 per 10 minutes per user (429 after).
const sosLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => `user:${req.user && req.user.id}`,
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  message: { code: 'SOS_RATE_LIMIT', message: 'Your SOS alerts were sent. If you are in danger call 112 now.' },
  ...require('../utils/sharedRateLimit').expressStore('coride.sos'),
});
const coord = (v, lim) => {
  if (v === undefined || v === null || v === '' || typeof v === 'boolean') return null;
  const n = Number(v);
  return Number.isFinite(n) && Math.abs(n) <= lim ? Math.round(n * 1e6) / 1e6 : null;
};
// Authorise first: only participants are counted by the limiter.
const sosParticipant = async (req, res, next) => {
  try {
    const pool = await getBikePoolModel().findByPk(req.params.id);
    if (!pool) return res.status(404).json({ message: 'Bike pool listing not found.' });
    const me = String(req.user.id);
    let role = String(pool.creatorId) === me ? 'host' : null;
    if (!role) {
      const approved = await getPoolRequestModel().findOne({ where: { poolId: pool.id, passengerId: me, status: 'Approved' } });
      if (approved) role = 'rider';
    }
    if (!role) return res.status(403).json({ code: 'NOT_ON_RIDE', message: 'Only the host or an approved rider of this ride can send an SOS.' });
    req.sosPool = pool;
    req.sosRole = role;
    return next();
  } catch (err) {
    return sendServerError(res, err, '[BIKEPOOL_SOS_ERROR]');
  }
};
router.post('/posts/:id/sos', protect, sosParticipant, sosLimiter, async (req, res) => {
  try {
    const pool = req.sosPool;
    const body = req.body || {};
    const User = getUserModel();
    const lat = coord(body.lat, 90);
    const lon = coord(body.lon, 180);
    const located = lat !== null && lon !== null;
    const note = typeof body.note === 'string' ? body.note.replace(/[<>]/g, '').trim().slice(0, 300) : '';
    const caller = await User.findByPk(req.user.id, { attributes: ['id', 'name', 'phone'] });
    const host = req.sosRole === 'host' ? caller : await User.findByPk(pool.creatorId, { attributes: ['id', 'name', 'phone'] });
    const approved = await getPoolRequestModel().findAll({ where: { poolId: pool.id, status: 'Approved' }, attributes: ['passengerId'] });
    const riders = approved.length ? await User.findAll({ where: { id: { [Op.in]: approved.map((r) => r.passengerId) } }, attributes: ['id', 'name', 'phone'] }) : [];
    const who = (u) => (u ? `${u.name || 'Student'}${u.phone ? ` (${u.phone})` : ''}` : 'unknown');
    const where = located ? ` Location: ${lat},${lon} (https://www.google.com/maps/search/?api=1&query=${lat},${lon}).` : ' No live location shared.';
    const description = [
      `SOS from the Co-Ride ${req.sosRole} ${who(caller)}${note ? `: ${note}` : '.'}${where}`,
      `Ride ${pool.id}: ${pool.origin} → ${pool.destination}, departure ${new Date(pool.departureTime).toISOString()}, ${pool.vehicleType || 'Bike'}${pool.vehicleInfo ? ` (${pool.vehicleInfo})` : ''}, status ${pool.status}.`,
      `Host: ${who(host)}. Riders: ${riders.length ? riders.map(who).join(', ') : 'none'}.`,
    ].join('\n').slice(0, 2000);
    const { getTicketModel } = require('../models/Ticket');
    const ticket = await getTicketModel().create({
      userId: req.user.id,
      subject: `🚨 Co-Ride SOS (${req.sosRole})`,
      description,
      priority: 'Critical',
      status: 'Open',
      slaBreachAt: new Date(Date.now() + 15 * 60 * 1000),
    });
    try { require('../utils/realtime').notifyAdmin('ticket', 'created', ticket.id); } catch { /* best effort */ }
    const io = req.app && typeof req.app.get === 'function' ? req.app.get('io') : null;
    console.error(`[CRITICAL SOS] Co-Ride ${req.sosRole} ${req.user.id} on ride ${pool.id}${located ? ` at ${lat},${lon}` : ''}`);
    // Fire-and-forget (never blocks the reply); pushAdmins never throws.
    Promise.resolve(require('../utils/adminAlert').pushAdmins(
      '🚨 Co-Ride SOS',
      `${who(caller)} pressed SOS on the ride ${pool.origin} → ${pool.destination}${note ? `: ${note}` : ''}. Call them now.`,
      { type: 'CORIDE_SOS', ticketId: String(ticket.id), poolId: String(pool.id), userId: String(req.user.id) },
      { io },
    )).catch(() => {});
    return res.status(201).json({
      ok: true, ticketId: ticket.id, emergencyNumber: '112', locationShared: located,
      message: 'ZCS has been alerted and will call you back. If anyone is in danger call 112 now.',
    });
  } catch (err) {
    return sendServerError(res, err, '[BIKEPOOL_SOS_ERROR]');
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
    const [closed] = await BikePool.update({ status: 'Cancelled' }, { where: { id: pool.id, status: { [Op.notIn]: ['Completed', 'Cancelled'] } } });
    if (!closed) return res.status(409).json({ message: 'This ride was just completed or cancelled. Please refresh.' });
    pool.status = 'Cancelled';
    // Open join requests are closed too (B23), exactly like a host cancel.
    await getPoolRequestModel().update(
      { status: 'Cancelled' },
      { where: { poolId: pool.id, status: { [Op.in]: ['Pending', 'Approved'] } } }
    );
    res.json({ message: 'Listing forcibly cancelled by Admin.', pool });
  } catch (err) {
    sendServerError(res, err, '[BIKEPOOLROUTES_ERROR]');
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
    sendServerError(res, err, '[BIKEPOOLROUTES_ERROR]');
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
      order: [['createdAt', 'DESC']],
      ...pageOf(req, 100)
    });
    res.json(pools);
  } catch (err) {
    sendServerError(res, err, '[BIKEPOOLROUTES_ERROR]');
  }
});

module.exports = router;
