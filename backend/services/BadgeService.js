/**
 * BadgeService.js
 * Centralized logic for evaluating and awarding gamification badges.
 */

const BADGE_CRITERIA = {
  ORDERS: [
    { name: 'Bronze Beginner', threshold: 5, tier: 'Bronze' },
    { name: 'Silver Scaler', threshold: 15, tier: 'Silver' },
    { name: 'Gold Grafter', threshold: 50, tier: 'Gold' },
    { name: 'Platinum Pro', threshold: 100, tier: 'Platinum' },
    { name: 'Diamond Devotee', threshold: 250, tier: 'Diamond' },
    { name: 'Elite Eater', threshold: 500, tier: 'Elite' }
  ],
  LATE_NIGHT: [
    { name: 'Bronze Bat', threshold: 3, tier: 'Bronze' },
    { name: 'Silver Shadow', threshold: 10, tier: 'Silver' },
    { name: 'Gold Ghost', threshold: 25, tier: 'Gold' },
    { name: 'Platinum Phantom', threshold: 75, tier: 'Platinum' },
    { name: 'Diamond Drifter', threshold: 150, tier: 'Diamond' }
  ],
  STREAK: [
    { name: 'Bronze Believer', threshold: 3, tier: 'Bronze' },
    { name: 'Silver Streaker', threshold: 7, tier: 'Silver' },
    { name: 'Gold Guardian', threshold: 21, tier: 'Gold' },
    { name: 'Platinum Persistence', threshold: 50, tier: 'Platinum' },
    { name: 'Diamond Dynamo', threshold: 100, tier: 'Diamond' }
  ]
};

/**
 * Evaluates which new badges a user has earned.
 * @param {Object} user - The Sequelize user instance.
 * @returns {Array} - Array of new badge names unlocked.
 */
const evaluateBadges = (user) => {
  if (!user) return [];
  const currentBadges = Array.isArray(user.badges) ? user.badges : [];
  const newBadges = [];

  // 1. Order Count Badges
  BADGE_CRITERIA.ORDERS.forEach(b => {
    if (user.completedOrders >= b.threshold && !currentBadges.includes(b.name)) {
      newBadges.push(b.name);
    }
  });

  // 2. Late Night Badges
  BADGE_CRITERIA.LATE_NIGHT.forEach(b => {
    if (user.lateNightOrders >= b.threshold && !currentBadges.includes(b.name)) {
      newBadges.push(b.name);
    }
  });

  // 3. Streak Badges
  BADGE_CRITERIA.STREAK.forEach(b => {
    if (user.streakCount >= b.threshold && !currentBadges.includes(b.name)) {
      newBadges.push(b.name);
    }
  });

  return newBadges;
};

// IST hour (Render runs in UTC).
const istHour = () => new Date(Date.now() + 5.5 * 60 * 60 * 1000).getUTCHours();

/**
 * Credits the customer for a delivered order: ZenPoints (10 per ₹100), completedOrders (+1)
 * and late-night count, as atomic SQL increments so a concurrent spin / rating / redeem is
 * never overwritten by a stale read-modify-save. Then awards any newly unlocked badges.
 * Call only from the request that actually flipped the order to Delivered.
 * @returns {{ customer: object|null, newBadges: string[], points: number }}
 */
const creditCustomerForDelivery = async (User, order) => {
  const points = Math.max(0, Math.floor(Number(order.finalPrice || order.totalPrice || 0) / 100) * 10);
  const hour = istHour();
  const lateNight = hour >= 22 || hour < 4;
  // Daily streak is earned on delivery, not on placing the order: place-then-cancel orders used
  // to build streaks that unlock streak-gated Vault deals.
  try {
    await require('../middleware/rewardEngine').updateStreak(order.userId);
  } catch (streakErr) {
    console.warn('[STREAK_UPDATE_WARN]', streakErr.message);
  }
  const { literal } = require('sequelize');
  const bump = (col, by) => literal(`COALESCE("${col}", 0) + ${Number(by)}`);
  await User.update(
    {
      // An owner-only test order (utils/testView) is not counted for the public leaderboard (top students by orders).
      ...(order.isTestData ? {} : { completedOrders: bump('completedOrders', 1) }),
      ...(points > 0 ? { zenPoints: bump('zenPoints', points) } : {}),
      ...(lateNight ? { lateNightOrders: bump('lateNightOrders', 1) } : {})
    },
    { where: { id: order.userId } }
  );
  const customer = await User.findByPk(order.userId);
  if (!customer) return { customer: null, newBadges: [], points };
  const newBadges = evaluateBadges(customer);
  if (newBadges.length > 0) {
    customer.badges = [...(Array.isArray(customer.badges) ? customer.badges : []), ...newBadges];
    await customer.save({ fields: ['badges'] });
  }
  return { customer, newBadges, points };
};

module.exports = { evaluateBadges, creditCustomerForDelivery, BADGE_CRITERIA };
