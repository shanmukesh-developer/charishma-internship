// Co-Ride (student bike / car pool) shared rules: women-only eligibility, "rode together before"
// (autoAcceptKnown) and gender labels, used by routes/bikePoolRoutes.js, routes/rideTemplateRoutes.js,
// the profile update (controllers/userController.js) and the regular-ride job (services/coRideTemplates.js).
const { Op } = require('sequelize');

const GENDERS = ['Male', 'Female', 'Other', 'Prefer not to say'];
/** Canonical gender label from user input (case-insensitive), '' / null -> 'Prefer not to say'; undefined when invalid. */
const normalizeGender = (v) => {
  if (v === null || (typeof v === 'string' && !v.trim())) return 'Prefer not to say';
  if (typeof v !== 'string') return undefined;
  const t = v.trim().toLowerCase();
  return GENDERS.find((g) => g.toLowerCase() === t);
};
const isFemale = (user) => !!user && String(user.gender || '').trim().toLowerCase() === 'female';

const WOMEN_ONLY_HOST_MSG = 'Only hosts whose profile gender is Female can post a women-only ride. Update your gender in Profile first.';
const WOMEN_ONLY_JOIN_MSG = 'This ride is for women only. Only riders whose profile gender is Female can join.';

/**
 * True when users a and b were both on a Completed ride before (either one hosting, the other an
 * approved passenger).
 */
const rodeTogetherBefore = async (a, b) => {
  if (!a || !b || String(a) === String(b)) return false;
  const BikePool = require('../models/BikePool').getBikePoolModel();
  const PoolRequest = require('../models/PoolRequest').getPoolRequestModel();
  const pairs = [[a, b], [b, a]];
  for (const [host, passenger] of pairs) {
    const hostRides = await BikePool.findAll({ where: { creatorId: host, status: 'Completed' }, attributes: ['id'], limit: 500, order: [['departureTime', 'DESC']] });
    if (!hostRides.length) continue;
    const n = await PoolRequest.count({
      where: { passengerId: passenger, status: 'Approved', poolId: { [Op.in]: hostRides.map((r) => r.id) } },
    });
    if (n > 0) return true;
  }
  return false;
};

module.exports = { GENDERS, normalizeGender, isFemale, rodeTogetherBefore, WOMEN_ONLY_HOST_MSG, WOMEN_ONLY_JOIN_MSG };
