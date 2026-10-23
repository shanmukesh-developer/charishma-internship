const { getUserModel } = require('../models/User');

// Middleware to update streak on every order
const updateStreak = async (userId) => {
  const User = getUserModel();
  const user = await User.findByPk(userId);
  if (!user) {
    console.warn('updateStreak: User not found for ID:', userId);
    return 0;
  }
  const now = new Date();
  const lastOrderDate = user.lastOrderDate ? new Date(user.lastOrderDate) : null;

  const getLocalDateString = (date) => {
    // Offset for IST (UTC +5.5 hours)
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istDate = new Date(date.getTime() + istOffset);
    return istDate.toISOString().split('T')[0]; // YYYY-MM-DD
  };

  if (lastOrderDate) {
    const nowDateStr = getLocalDateString(now);
    const lastDateStr = getLocalDateString(lastOrderDate);

    if (nowDateStr !== lastDateStr) {
      const nowParsed = new Date(nowDateStr);
      const lastParsed = new Date(lastDateStr);
      const diffTime = Math.abs(nowParsed - lastParsed);
      const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays === 1) {
        // Ordered exactly the next calendar day
        user.streakCount = (user.streakCount || 0) + 1;
      } else if (diffDays > 1) {
        // Streak broken
        user.streakCount = 1;
      }
    }
  } else {
    // First order
    user.streakCount = 1;
  }

  user.lastOrderDate = now;
  await user.save();
  return user.streakCount;
};

// Order-tier badge name -> tier ('Bronze Beginner' -> 'Bronze', ..., 'Elite Eater' -> 'Elite').
const { BADGE_CRITERIA } = require('../services/BadgeService');
const ORDER_TIER_BY_BADGE = new Map(BADGE_CRITERIA.ORDERS.map((b) => [b.name, b.tier]));

// Calculate perks based on user badges
const calculateBadgePerks = (user) => {
  if (!user) return { deliveryDiscount: 0, orderDiscount: 0, status: 'Guest Citizen' };
  let badges = [];
  if (Array.isArray(user.badges)) {
    badges = user.badges;
  } else {
    try {
      badges = JSON.parse(user.badges || '[]');
    } catch {
      badges = [];
    }
  }
  let deliveryDiscount = 0;
  let orderDiscount = 0;
  let status = 'Standard Citizen';

  // Only the ORDER-tier badges (services/BadgeService BADGE_CRITERIA.ORDERS, exact names) unlock
  // order perks. Streak / late-night badges share the tier words ("Diamond Drifter", "Gold Ghost")
  // and used to match a substring test, handing out order-tier discounts they were never meant to.
  const tierRank = { Bronze: 1, Silver: 2, Gold: 3, Platinum: 4, Diamond: 5, Elite: 6 };
  let tier = user.isElite ? 'Elite' : null;
  for (const b of badges) {
    const t = typeof b === 'string' ? ORDER_TIER_BY_BADGE.get(b.trim()) : undefined;
    if (t && (!tier || tierRank[t] > tierRank[tier])) tier = t;
  }

  if (tier === 'Elite') {
    deliveryDiscount = 1;
    orderDiscount = 100;
    status = 'Elite Sovereign';
  } else if (tier === 'Diamond') {
    deliveryDiscount = 1;
    orderDiscount = 50;
    status = 'Diamond Dignitary';
  } else if (tier === 'Platinum') {
    deliveryDiscount = 1;
    orderDiscount = 25;
    status = 'Platinum Pro';
  } else if (tier === 'Gold') {
    deliveryDiscount = 0.5;
    orderDiscount = 15;
    status = 'Gold Grafter';
  } else if (tier === 'Silver') {
    deliveryDiscount = 0.2;
    orderDiscount = 10;
    status = 'Silver Scaler';
  } else if (tier === 'Bronze') {
    orderDiscount = 5;
    status = 'Bronze Beginner';
  }

  // ── Zen Point Threshold (200 Points = Free Delivery) ──
  let pointsFreeDelivery = false;
  if (user.zenPoints >= 200 && deliveryDiscount < 1) {
    deliveryDiscount = 1;
    status = 'Zen Champion';
    pointsFreeDelivery = true;
  }

  // tier / pointsFreeDelivery: plain words for the bill ("Gold member: order discount").
  return { deliveryDiscount, orderDiscount, status, tier, pointsFreeDelivery };
};

// The streak a user actually has right now: it lapses once a whole IST day passes with no order
// (the stored streakCount is only rewritten on the next order).
const effectiveStreak = (user) => {
  const count = Number(user?.streakCount) || 0;
  if (!count || !user?.lastOrderDate) return 0;
  const IST = 5.5 * 60 * 60 * 1000;
  const day = (d) => new Date(new Date(d).getTime() + IST).toISOString().slice(0, 10);
  const daysSince = Math.round((new Date(day(new Date())) - new Date(day(user.lastOrderDate))) / 86400000);
  return daysSince <= 1 ? count : 0;
};

module.exports = { updateStreak, calculateBadgePerks, effectiveStreak, ORDER_TIER_BY_BADGE };
