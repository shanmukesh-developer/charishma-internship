const { getUserModel } = require('../models/User');

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
      nextMilestoneIn: 2 - ((user.completedOrders || 0) % 2)
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Use a spin and record prize
const useSpin = async (req, res) => {
  try {
    const { prizeType, prizeValue } = req.body;
    const User = getUserModel();

    // Server-side validation of the claimed prize to prevent client parameter manipulation
    if (prizeType === 'points') {
      const val = Number(prizeValue);
      if (isNaN(val) || val <= 0 || val > 100) {
        return res.status(400).json({ message: 'Invalid prize value. Maximum allowed points is 100.' });
      }
    } else if (prizeType === 'coupon') {
      if (prizeValue !== 'FREEDEL' && prizeValue !== 'DISCOUNT') {
        return res.status(400).json({ message: 'Invalid coupon prize value.' });
      }
    } else {
      return res.status(400).json({ message: 'Invalid prize type.' });
    }

    const { getSequelize } = require('../config/db');
    const sequelize = getSequelize();
    
    let updatedUser;
    let awardedCoupon = null;

    await sequelize.transaction(async (t) => {
      const user = await User.findByPk(req.user.id, { transaction: t, lock: true });
      if (!user) {
        throw new Error('User not found');
      }

      const spinsEarned = Math.floor((user.completedOrders || 0) / 2);
      const spinsAvailable = spinsEarned - (user.spinsUsed || 0);

      if (spinsAvailable <= 0) {
        throw new Error('No spins available. Complete more orders!');
      }

      user.spinsUsed = (user.spinsUsed || 0) + 1;

      if (prizeType === 'points') {
        user.zenPoints = (user.zenPoints || 0) + Number(prizeValue);
      }

      if (prizeType === 'coupon') {
        const { getCouponModel } = require('../models/Coupon');
        const Coupon = getCouponModel();
        const code = `ZF-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
        awardedCoupon = await Coupon.create({
          code,
          type: prizeValue === 'FREEDEL' ? 'FREEDEL' : 'DISCOUNT',
          userId: user.id,
          isUsed: false,
          expiryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        }, { transaction: t });
      }

      await user.save({ transaction: t });
      updatedUser = user;
    });

    res.json({
      message: 'Spin recorded successfully',
      spinsUsed: updatedUser.spinsUsed,
      zenPoints: updatedUser.zenPoints,
      coupon: awardedCoupon ? { code: awardedCoupon.code, type: awardedCoupon.type } : null
    });
  } catch (error) {
    res.status(400).json({ message: error.message || 'Spin failed.' });
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
    const coupons = await Coupon.findAll({
      where: { userId: req.user.id, isUsed: false },
      order: [['createdAt', 'DESC']]
    });
    res.json(coupons);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

module.exports = { checkSpinEntry, useSpin, getLeaderboard, getUserCoupons };
