const { getUserModel } = require('../models/User');
const { sendServerError } = require('../utils/httpErrors');

// @desc    Check spin eligibility
const checkSpinEntry = async (req, res) => {
  try {
    const User = getUserModel();
    const user = await User.findByPk(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const spinsEarned = Math.floor((user.completedOrders || 0) / 2);
    const spinsAvailable = Math.max(0, spinsEarned - (user.spinsUsed || 0));

    res.json({
      completedOrders: user.completedOrders || 0,
      spinsUsed: user.spinsUsed || 0,
      spinsAvailable,
      nextMilestoneIn: 2 - ((user.completedOrders || 0) % 2),
      prizes: SPIN_PRIZES
    });
  } catch (error) {
    sendServerError(res, error, '[REWARDCONTROLLER_ERROR]');
  }
};

// ── Lucky Spin: the prize table lives on the server and the server picks the prize ──
// Same 8 sectors (and order) as the wheel in the app, so the app can animate to prizeIndex.
const SPIN_PRIZES = [
  { label: 'FREE DEL', value: 'FREEDEL', type: 'coupon', display: 'Free Delivery 🚚' },
  { label: '10 ZEN', value: 10, type: 'points', display: '10 ZenPoints 💎' },
  { label: '20 ZEN', value: 20, type: 'points', display: '20 ZenPoints 💎' },
  { label: '5 ZEN', value: 5, type: 'points', display: '5 ZenPoints 💎' },
  { label: '50 ZEN', value: 50, type: 'points', display: '50 ZenPoints 💎' },
  { label: '100 ZEN', value: 100, type: 'points', display: '100 ZenPoints 💎' },
  { label: '5 ZEN', value: 5, type: 'points', display: '5 ZenPoints 💎' },
  { label: '2 ZEN', value: 2, type: 'points', display: '2 ZenPoints 💎' },
];
const FREE_DELIVERY_EVERY = 15; // every 15th spin is Free Delivery
const SPIN_COUPON_DAYS = 7;

// @desc    Use a spin. Body is ignored: the prize is chosen here, never by the client.
// @route   POST /api/rewards/use-spin
const useSpin = async (req, res) => {
  try {
    const User = getUserModel();
    const crypto = require('crypto');
    const { getSequelize } = require('../config/db');
    const sequelize = getSequelize();

    let updatedUser;
    let awardedCoupon = null;
    let prizeIndex = 0;

    await sequelize.transaction(async (t) => {
      const user = await User.findByPk(req.user.id, { transaction: t, lock: true });
      if (!user) throw Object.assign(new Error('Your session has expired. Please log in again.'), { status: 401 });

      const spinsEarned = Math.floor((user.completedOrders || 0) / 2);
      const spinsAvailable = spinsEarned - (user.spinsUsed || 0);
      if (spinsAvailable <= 0) {
        throw Object.assign(new Error('No spins left — every 2 delivered orders earn you a new spin!'), { status: 400 });
      }

      const spinNumber = (user.spinsUsed || 0) + 1;
      prizeIndex = spinNumber % FREE_DELIVERY_EVERY === 0 ? 0 : crypto.randomInt(1, SPIN_PRIZES.length);
      const prize = SPIN_PRIZES[prizeIndex];

      user.spinsUsed = spinNumber;
      if (prize.type === 'points') user.zenPoints = (user.zenPoints || 0) + Number(prize.value);
      if (prize.type === 'coupon') {
        const { getCouponModel } = require('../models/Coupon');
        const Coupon = getCouponModel();
        awardedCoupon = await Coupon.create({
          code: `ZF-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
          type: 'FREEDEL',
          value: 0,
          userId: user.id,
          isUsed: false,
          expiryDate: new Date(Date.now() + SPIN_COUPON_DAYS * 24 * 60 * 60 * 1000)
        }, { transaction: t });
      }
      await user.save({ transaction: t });
      updatedUser = user;
    });

    const prize = SPIN_PRIZES[prizeIndex];
    res.json({
      message: `You won ${prize.display}!`,
      prizeIndex,
      prize,
      spinsUsed: updatedUser.spinsUsed,
      spinsAvailable: Math.max(0, Math.floor((updatedUser.completedOrders || 0) / 2) - updatedUser.spinsUsed),
      zenPoints: updatedUser.zenPoints,
      coupon: awardedCoupon ? { code: awardedCoupon.code, type: awardedCoupon.type, expiryDate: awardedCoupon.expiryDate } : null
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    console.error('[SPIN_ERROR]', error);
    res.status(500).json({ message: 'The wheel got stuck. Please try again.' });
  }
};

// @desc    Get top performers for public leaderboard
const getLeaderboard = async (req, res) => {
  try {
    const User = getUserModel();
    const topUsers = await User.findAll({
      where: { role: 'student' },
      attributes: ['id', 'name', 'badges', 'profileImage', 'zenPoints'],
      order: [['completedOrders', 'DESC']],
      limit: 5
    });

    const leaderboard = topUsers.map(u => {
      const badges = Array.isArray(u.badges) ? u.badges : [];
      let tier = 'Silver';
      if (badges.some(b => b && typeof b === 'string' && b.includes('Platinum'))) tier = 'Platinum';
      else if (badges.some(b => b && typeof b === 'string' && b.includes('Gold'))) tier = 'Gold';

      return {
        id: u.id,
        name: u.name,
        badgeCount: badges.length,
        tier,
        profileImage: u.profileImage,
        zenPoints: u.zenPoints || 0
      };
    });

    res.json(leaderboard);
  } catch (error) {
    console.error('[LEADERBOARD_ERROR]', error);
    res.status(500).json({ message: 'Server error' });
  }
};

const getUserCoupons = async (req, res) => {
  try {
    const { getCouponModel } = require('../models/Coupon');
    const Coupon = getCouponModel();
    const { Op } = require('sequelize');
    const coupons = await Coupon.findAll({
      where: { userId: req.user.id, isUsed: false, [Op.or]: [{ expiryDate: null }, { expiryDate: { [Op.gt]: new Date() } }] },
      order: [['expiryDate', 'ASC'], ['createdAt', 'DESC']]
    });
    res.json(coupons.map(c => {
      const json = c.toJSON();
      const value = Number(json.value) || 0;
      return {
        ...json,
        label: json.type === 'FREEDEL' ? 'Free delivery' : (value > 0 ? `₹${value} off` : '20% off (up to ₹50)'),
        expiresInDays: json.expiryDate ? Math.max(0, Math.ceil((new Date(json.expiryDate) - Date.now()) / 86400000)) : null
      };
    }));
  } catch (error) {
    sendServerError(res, error, '[REWARDCONTROLLER_ERROR]');
  }
};

const couponLabel = (json) => {
  const value = Number(json.value) || 0;
  return json.type === 'FREEDEL' ? 'Free delivery' : (value > 0 ? `₹${value} off` : '20% off (up to ₹50)');
};

// Used and expired coupons of the last 90 days (newest first, at most 50), for the "Used" and "Expired" tabs.
// A coupon's last change is the moment it was used (orderController claims it with isUsed: true).
const getCouponHistory = async (req, res) => {
  try {
    const { getCouponModel } = require('../models/Coupon');
    const Coupon = getCouponModel();
    const { Op } = require('sequelize');
    const now = new Date();
    const since = new Date(now.getTime() - 90 * 86400000);
    const rows = await Coupon.findAll({
      where: {
        userId: req.user.id,
        [Op.or]: [
          { isUsed: true, updatedAt: { [Op.gte]: since } },
          { isUsed: false, expiryDate: { [Op.lte]: now, [Op.gte]: since } },
        ],
      },
      order: [['updatedAt', 'DESC']],
      limit: 50,
    });
    const items = rows.map((c) => {
      const json = c.toJSON();
      const used = !!json.isUsed;
      return {
        id: json.id,
        code: json.code,
        type: json.type,
        value: Number(json.value) || 0,
        label: couponLabel(json),
        minOrderValue: json.minOrderValue,
        status: used ? 'used' : 'expired',
        usedAt: used ? json.updatedAt : null,
        expiryDate: json.expiryDate,
      };
    });
    // Newest event first: used coupons by use time, expired ones by expiry time.
    const at = (i) => new Date(i.status === 'used' ? i.usedAt : i.expiryDate).getTime();
    items.sort((a, b) => at(b) - at(a));
    res.json({ used: items.filter((i) => i.status === 'used'), expired: items.filter((i) => i.status === 'expired') });
  } catch (error) {
    sendServerError(res, error, '[REWARDCONTROLLER_ERROR]');
  }
};

const validateCoupon = async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ message: 'Coupon code is required' });
    }
    const { getCouponModel } = require('../models/Coupon');
    const Coupon = getCouponModel();
    const coupon = await Coupon.findOne({
      where: { code: String(code).trim(), userId: req.user.id, isUsed: false }
    });

    if (!coupon) {
      return res.status(404).json({ message: 'That code is not valid or has already been used.' });
    }

    if (coupon.expiryDate && new Date() > new Date(coupon.expiryDate)) {
      return res.status(400).json({ message: 'This coupon has expired.' });
    }

    res.json({ valid: true, coupon });
  } catch (error) {
    sendServerError(res, error, '[REWARDCONTROLLER_ERROR]');
  }
};

module.exports = {
  checkSpinEntry,
  useSpin,
  getLeaderboard,
  getUserCoupons,
  getCouponHistory,
  validateCoupon
};
