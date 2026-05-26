// ── Phase 2+3 Feature Routes ──────────────────────────
// F1: Referral, F5: Reviews, F7: Block Challenges, F8: Pre-order,
// F11: AI Picks, F13: Elite Gifting, F2: Push Campaigns
const express = require('express');
const router = express.Router();
const { protect, admin } = require('../middleware/authMiddleware');

// ═══════════════════════════════════════════════════════
// F1: REFERRAL SYSTEM
// ═══════════════════════════════════════════════════════

// POST /api/features/referral/apply - Apply a referral code
router.post('/referral/apply', protect, async (req, res) => {
  try {
    const { referralCode } = req.body;
    if (!referralCode) return res.status(400).json({ message: 'Referral code is required' });

    const { getUserModel } = require('../models/User');
    const User = getUserModel();

    // Find the referrer by code
    const referrer = await User.findOne({ where: { referralCode } });
    if (!referrer) return res.status(404).json({ message: 'Invalid referral code' });

    // Prevent self-referral
    if (referrer.id === req.user.id) {
      return res.status(400).json({ message: 'You cannot refer yourself' });
    }

    // Check if user already used a referral
    const currentUser = await User.findByPk(req.user.id);
    if (!currentUser) return res.status(404).json({ message: 'User not found' });
    if (currentUser.referredBy) {
      return res.status(400).json({ message: 'You have already used a referral code' });
    }

    // Award both users 50 ZenPoints
    currentUser.referredBy = referralCode;
    currentUser.referralRewardClaimed = true;
    currentUser.zenPoints = (currentUser.zenPoints || 0) + 50;
    await currentUser.save();

    referrer.referralCount = (referrer.referralCount || 0) + 1;
    referrer.zenPoints = (referrer.zenPoints || 0) + 50;
    await referrer.save();

    console.log(`[REFERRAL] ${currentUser.name} used code ${referralCode} (referrer: ${referrer.name})`);

    res.json({
      message: 'Referral applied! Both of you earned 50 ZenPoints 🎉',
      yourPoints: currentUser.zenPoints,
      referrerName: referrer.name
    });
  } catch (error) {
    console.error('[REFERRAL_ERROR]', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// GET /api/features/referral/my-code - Get current user's referral code
router.get('/referral/my-code', protect, async (req, res) => {
  try {
    const { getUserModel } = require('../models/User');
    const User = getUserModel();
    const user = await User.findByPk(req.user.id, {
      attributes: ['referralCode', 'referralCount', 'referredBy']
    });
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({
      referralCode: user.referralCode,
      referralCount: user.referralCount || 0,
      hasUsedReferral: !!user.referredBy
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ═══════════════════════════════════════════════════════
// F7: BLOCK CHALLENGES
// ═══════════════════════════════════════════════════════

// GET /api/features/challenges/active - Get active weekly challenge
router.get('/challenges/active', async (req, res) => {
  try {
    const { getOrderModel } = require('../models/Order');
    const { getUserModel } = require('../models/User');
    const { Op } = require('sequelize');
    const Order = getOrderModel();
    const User = getUserModel();

    // Current week window
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    const orders = await Order.findAll({
      where: { status: 'Delivered', createdAt: { [Op.gte]: startOfWeek } }
    });

    // Aggregate by hostel block
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const userIds = [...new Set(orders.map(o => o.userId))].filter(id => id && uuidRegex.test(id));
    let users = [];
    if (userIds.length > 0) {
      users = await User.findAll({ where: { id: { [Op.in]: userIds } } });
    }
    const userBlockMap = {};
    users.forEach(u => userBlockMap[u.id] = u.hostelBlock);

    const blockScores = {};
    orders.forEach(order => {
      const block = userBlockMap[order.userId];
      if (block) {
        if (!blockScores[block]) blockScores[block] = { orders: 0, spend: 0, users: new Set() };
        blockScores[block].orders += 1;
        blockScores[block].spend += (order.finalPrice || order.totalPrice || 0);
        blockScores[block].users.add(order.userId);
      }
    });

    const leaderboard = Object.entries(blockScores)
      .map(([block, data]) => ({
        block,
        orders: data.orders,
        spend: Math.round(data.spend),
        participants: data.users.size,
        score: data.orders * 10 + data.users.size * 5 // Weighted score
      }))
      .sort((a, b) => b.score - a.score);

    // Determine challenge type based on week number
    const weekNum = Math.ceil((now - new Date(now.getFullYear(), 0, 1)) / (7 * 24 * 60 * 60 * 1000));
    const challengeTypes = [
      { title: 'Most Orders', metric: 'orders', emoji: '🏆', description: 'Block with the most delivered orders wins!' },
      { title: 'Highest Spend', metric: 'spend', emoji: '💰', description: 'Block that spends the most wins!' },
      { title: 'Most Participants', metric: 'participants', emoji: '👥', description: 'Block with the most unique orderers wins!' }
    ];
    const activeChallenge = challengeTypes[weekNum % 3];

    res.json({
      challenge: activeChallenge,
      leaderboard,
      weekStart: startOfWeek.toISOString(),
      weekEnd: new Date(startOfWeek.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      totalOrders: orders.length
    });
  } catch (error) {
    console.error('[CHALLENGE_ERROR]', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ═══════════════════════════════════════════════════════
// F11: AI RECOMMENDATION ENGINE (Rule-based "Zenvy Picks")
// ═══════════════════════════════════════════════════════

// GET /api/features/recommendations - Personalized picks
router.get('/recommendations', protect, async (req, res) => {
  try {
    const { getOrderModel } = require('../models/Order');
    const { getUserModel } = require('../models/User');
    const { getMenuItemModel } = require('../models/MenuItem');
    const Order = getOrderModel();
    const User = getUserModel();
    const MenuItem = getMenuItemModel();

    const user = await User.findByPk(req.user.id, {
      attributes: ['dietaryPreference', 'hostelBlock']
    });

    // Get user's order history
    const pastOrders = await Order.findAll({
      where: { userId: req.user.id, status: 'Delivered' },
      order: [['createdAt', 'DESC']],
      limit: 30
    });

    // Extract frequently ordered items and categories
    const itemFreq = {};
    const categoryFreq = {};
    const restaurantFreq = {};
    pastOrders.forEach(o => {
      const items = Array.isArray(o.items) ? o.items : [];
      items.forEach(item => {
        const name = item.name || '';
        itemFreq[name] = (itemFreq[name] || 0) + 1;
        if (item.category) categoryFreq[item.category] = (categoryFreq[item.category] || 0) + 1;
      });
      if (o.restaurantId) restaurantFreq[o.restaurantId] = (restaurantFreq[o.restaurantId] || 0) + 1;
    });

    // Get all available menu items
    const allItems = await MenuItem.findAll({
      where: { isAvailable: true },
      limit: 200
    });

    // Score each item
    const scored = allItems.map(item => {
      let score = 0;
      const itemData = item.toJSON();

      // Boost if user has ordered similar items
      if (itemFreq[itemData.name]) score += itemFreq[itemData.name] * 3;
      if (categoryFreq[itemData.category]) score += categoryFreq[itemData.category] * 2;
      if (restaurantFreq[itemData.restaurantId]) score += restaurantFreq[itemData.restaurantId] * 1;

      // Dietary preference matching
      if (user?.dietaryPreference === 'Veg' && itemData.isVegetarian) score += 5;

      // Popularity boost (rating proxy)
      score += Math.random() * 2; // Small random factor for variety

      return { ...itemData, score };
    });

    // Sort by score, return top 6
    const picks = scored
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map(({ score, ...item }) => item);

    res.json({
      picks,
      reason: pastOrders.length > 0 ? 'Based on your order history' : 'Popular on campus right now',
      totalOrdersAnalyzed: pastOrders.length
    });
  } catch (error) {
    console.error('[RECOMMENDATION_ERROR]', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ═══════════════════════════════════════════════════════
// F13: ELITE GIFTING
// ═══════════════════════════════════════════════════════

// POST /api/features/gift - Send a gift (meal voucher) to another user
router.post('/gift', protect, async (req, res) => {
  try {
    const { recipientPhone, amount, message } = req.body;
    if (!recipientPhone || !amount) {
      return res.status(400).json({ message: 'Recipient phone and amount are required' });
    }
    if (amount < 10 || amount > 500) {
      return res.status(400).json({ message: 'Gift amount must be between ₹10 and ₹500' });
    }

    const { getUserModel } = require('../models/User');
    const User = getUserModel();

    const sender = await User.findByPk(req.user.id);
    if (!sender) return res.status(404).json({ message: 'Sender not found' });
    if (!sender.isElite) return res.status(403).json({ message: 'Only Elite members can send gifts' });

    // Monthly gift limit (3/month)
    const now = new Date();
    if (sender.lastGiftResetDate) {
      const lastReset = new Date(sender.lastGiftResetDate);
      if (lastReset.getMonth() !== now.getMonth() || lastReset.getFullYear() !== now.getFullYear()) {
        sender.eliteGiftsUsedThisMonth = 0;
        sender.lastGiftResetDate = now;
      }
    } else {
      sender.lastGiftResetDate = now;
    }

    if ((sender.eliteGiftsUsedThisMonth || 0) >= 3) {
      return res.status(400).json({ message: 'Monthly gift limit reached (3/month)' });
    }

    // Check wallet balance
    if ((sender.walletBalance || 0) < amount) {
      return res.status(400).json({ message: 'Insufficient wallet balance' });
    }

    // Find recipient
    const recipient = await User.findOne({ where: { phone: recipientPhone } });
    if (!recipient) return res.status(404).json({ message: 'Recipient not found on Zenvy' });
    if (recipient.id === sender.id) return res.status(400).json({ message: 'Cannot gift yourself' });

    // Transfer
    sender.walletBalance = (sender.walletBalance || 0) - amount;
    sender.eliteGiftsUsedThisMonth = (sender.eliteGiftsUsedThisMonth || 0) + 1;
    await sender.save();

    recipient.walletBalance = (recipient.walletBalance || 0) + amount;
    await recipient.save();

    // Emit socket notification
    const io = req.app.get('io');
    if (io) {
      io.emit('gift_received', {
        recipientId: recipient.id,
        senderName: sender.name,
        amount,
        message: message || `${sender.name} sent you a meal gift! 🎁`
      });
    }

    console.log(`[GIFT] ${sender.name} → ${recipient.name}: ₹${amount}`);
    res.json({
      message: `₹${amount} gift sent to ${recipient.name}! 🎁`,
      remainingGifts: 3 - sender.eliteGiftsUsedThisMonth,
      newBalance: sender.walletBalance
    });
  } catch (error) {
    console.error('[GIFT_ERROR]', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ═══════════════════════════════════════════════════════
// F2: PUSH NOTIFICATION CAMPAIGNS
// ═══════════════════════════════════════════════════════

// POST /api/features/push/campaign - Send a push campaign (Admin only)
router.post('/push/campaign', protect, admin, async (req, res) => {
  try {
    const { title, body, targetType, targetData } = req.body;
    // targetType: 'all', 'elite', 'block', 'abandoned_cart', 'inactive'
    if (!title || !body) return res.status(400).json({ message: 'Title and body are required' });

    const { getUserModel } = require('../models/User');
    const { sendPushToTokens } = require('../utils/push');
    const User = getUserModel();
    const { Op } = require('sequelize');

    let users = [];
    switch (targetType) {
      case 'elite':
        users = await User.findAll({ where: { isElite: true } });
        break;
      case 'block':
        if (targetData?.block) {
          users = await User.findAll({ where: { hostelBlock: targetData.block } });
        }
        break;
      case 'inactive': {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        users = await User.findAll({
          where: { updatedAt: { [Op.lt]: thirtyDaysAgo } }
        });
        break;
      }
      default:
        users = await User.findAll({ where: {} });
    }

    let sentCount = 0;
    for (const user of users) {
      const tokens = user.fcmTokens;
      if (tokens && Array.isArray(tokens) && tokens.length > 0) {
        await sendPushToTokens(tokens, title, body, { type: 'campaign' });
        sentCount++;
      }
    }

    console.log(`[PUSH_CAMPAIGN] "${title}" sent to ${sentCount}/${users.length} users (target: ${targetType})`);
    res.json({
      message: `Campaign sent to ${sentCount} devices`,
      totalUsers: users.length,
      devicesReached: sentCount
    });
  } catch (error) {
    console.error('[PUSH_CAMPAIGN_ERROR]', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// POST /api/features/push/abandoned-cart - Trigger abandoned cart nudge
router.post('/push/abandoned-cart', async (req, res) => {
  try {
    const { getUserModel } = require('../models/User');
    const { getOrderModel } = require('../models/Order');
    const { sendPushToTokens } = require('../utils/push');
    const { Op } = require('sequelize');
    const User = getUserModel();
    const Order = getOrderModel();

    // Find users who haven't ordered in the last 3 days but were active before
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);

    const recentOrders = await Order.findAll({
      where: { createdAt: { [Op.between]: [tenDaysAgo, threeDaysAgo] } },
      attributes: ['userId'],
      group: ['userId']
    });

    const targetUserIds = recentOrders.map(o => o.userId);
    if (targetUserIds.length === 0) return res.json({ message: 'No abandoned cart users found', count: 0 });

    const users = await User.findAll({
      where: { id: { [Op.in]: targetUserIds } }
    });

    let sentCount = 0;
    for (const user of users) {
      const tokens = user.fcmTokens;
      if (tokens && Array.isArray(tokens) && tokens.length > 0) {
        await sendPushToTokens(
          tokens,
          '🍽️ Missing your Zenvy meals?',
          `Hey ${user.name || 'there'}! Your favorite restaurants are waiting. Order now and earn ZenPoints!`,
          { type: 'abandoned_cart' }
        );
        sentCount++;
      }
    }

    console.log(`[ABANDONED_CART] Nudged ${sentCount} users`);
    res.json({ message: `Nudged ${sentCount} users`, count: sentCount });
  } catch (error) {
    console.error('[ABANDONED_CART_ERROR]', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;
