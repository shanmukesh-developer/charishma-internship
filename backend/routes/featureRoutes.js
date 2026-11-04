// ── Phase 2+3 Feature Routes ──────────────────────────
// F1: Referral, F5: Reviews, F7: Block Challenges, F8: Pre-order,
// F11: AI Picks, F13: Elite Gifting, F2: Push Campaigns
const express = require('express');
const router = express.Router();
const { protect, admin } = require('../middleware/authMiddleware');
const { sendServerError } = require('../utils/httpErrors');

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

    const code = String(referralCode).trim().toUpperCase();
    const referrer = await User.findOne({ where: { referralCode: code } });
    if (!referrer) return res.status(404).json({ message: 'Invalid referral code' });

    if (referrer.id === req.user.id) {
      return res.status(400).json({ message: 'You cannot refer yourself' });
    }

    const currentUser = await User.findByPk(req.user.id);
    if (!currentUser) return res.status(404).json({ message: 'User not found' });
    if (currentUser.referredBy) {
      return res.status(400).json({ message: 'You have already used a referral code' });
    }
    if (referrer.referredBy && currentUser.referralCode && referrer.referredBy === currentUser.referralCode) {
      return res.status(400).json({ message: 'You cannot use the code of someone you referred.' });
    }
    // Conditional, atomic claim: a double tap can never pay out twice.
    const { literal } = require('sequelize');
    const [claimed] = await User.update(
      { referredBy: code, referralRewardClaimed: true, zenPoints: literal('COALESCE("zenPoints", 0) + 50') },
      { where: { id: currentUser.id, referredBy: null } }
    );
    if (claimed === 0) return res.status(400).json({ message: 'You have already used a referral code' });
    // The referrer is paid for at most MAX_PAID_REFERRALS friends (utils/referralRules); the count always grows.
    const { MAX_PAID_REFERRALS } = require('../utils/referralRules');
    await User.update(
      {
        referralCount: literal('COALESCE("referralCount", 0) + 1'),
        zenPoints: literal(`CASE WHEN COALESCE("referralCount", 0) < ${Number(MAX_PAID_REFERRALS)} THEN COALESCE("zenPoints", 0) + 50 ELSE COALESCE("zenPoints", 0) END`),
      },
      { where: { id: referrer.id } }
    );
    await currentUser.reload();

    console.log(`[REFERRAL] ${currentUser.name} used code ${referralCode} (referrer: ${referrer.name})`);

    res.json({
      message: 'Referral applied! Both of you earned 50 ZENV Points 🎉',
      yourPoints: currentUser.zenPoints,
      referrerName: referrer.name
    });
  } catch (error) {
    console.error('[REFERRAL_ERROR]', error);
    sendServerError(res, error, '[FEATUREROUTES_ERROR]');
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
    sendServerError(res, error, '[FEATUREROUTES_ERROR]');
  }
});

// ═══════════════════════════════════════════════════════
// F7: BLOCK CHALLENGES
// ═══════════════════════════════════════════════════════

// GET /api/features/challenges/active - Get active weekly challenge
// Weekly block leaderboard (same for everyone): 60 s server cache + ETag.
router.get('/challenges/active', require('../utils/responseCache').cacheGet('challenges', { ttlMs: 60 * 1000 }), async (req, res) => {
  try {
    const { getOrderModel } = require('../models/Order');
    const { getUserModel } = require('../models/User');
    const { Op } = require('sequelize');
    const Order = getOrderModel();
    const User = getUserModel();

    // Week starts Sunday 00:00 IST (the server clock is UTC: setHours(0) meant 05:30 IST).
    const IST_MS = 5.5 * 60 * 60 * 1000;
    const now = new Date();
    const nowIst = new Date(Date.now() + IST_MS);
    const startOfWeek = new Date(Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), nowIst.getUTCDate() - nowIst.getUTCDay()) - IST_MS);

    // Only the columns the leaderboard needs (full order rows carry photos / addresses).
    const orders = await Order.findAll({
      where: { status: 'Delivered', createdAt: { [Op.gte]: startOfWeek } },
      attributes: ['userId', 'finalPrice', 'totalPrice'],
      raw: true,
    });
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const userIds = [...new Set(orders.map(o => o.userId))].filter(id => id && uuidRegex.test(id));
    let users = [];
    if (userIds.length > 0) {
      users = await User.findAll({ where: { id: { [Op.in]: userIds } }, attributes: ['id', 'hostelBlock'], raw: true });
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
    sendServerError(res, error, '[FEATUREROUTES_ERROR]');
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

    const pastOrders = await Order.findAll({
      where: { userId: req.user.id, status: 'Delivered' },
      order: [['createdAt', 'DESC']],
      limit: 30
    });
    const itemFreq = {};
    const categoryFreq = {};
    const restaurantFreq = {};
    pastOrders.forEach(o => {
      let itemsList = o.items;
      if (typeof itemsList === 'string') {
        try {
          itemsList = JSON.parse(itemsList);
        } catch {
          itemsList = [];
        }
      }
      const items = Array.isArray(itemsList) ? itemsList : [];
      items.forEach(item => {
        const name = item.name || '';
        itemFreq[name] = (itemFreq[name] || 0) + 1;
        if (item.category) categoryFreq[item.category] = (categoryFreq[item.category] || 0) + 1;
      });
      if (o.restaurantId) restaurantFreq[o.restaurantId] = (restaurantFreq[o.restaurantId] || 0) + 1;
    });

    const { getRestaurantModel } = require('../models/Restaurant');
    const { stripItemSecrets } = require('../utils/publicFields');
    // Only items of live stores (B1); public item rows never carry owner phone / commission.
    const allItems = await MenuItem.findAll({
      where: { isAvailable: true },
      include: [{ model: getRestaurantModel(), as: 'restaurant', attributes: ['id', 'name', 'imageUrl', 'vendorType'], where: { isActive: true, ...(await require('../utils/receiptSettings').listingWhere()) } }],
      limit: 200
    });

    const scored = allItems.map(item => {
      let score = 0;
      const itemData = stripItemSecrets(item.toJSON());

      // Boost if user has ordered similar items
      if (itemFreq[itemData.name]) score += itemFreq[itemData.name] * 3;
      if (categoryFreq[itemData.category]) score += categoryFreq[itemData.category] * 2;
      if (restaurantFreq[itemData.restaurantId]) score += restaurantFreq[itemData.restaurantId] * 1;

      // Dietary preference matching
      if (user?.dietaryPreference === 'Veg' && itemData.isVegetarian) score += 5;

      score += Math.random() * 2; 

      return { ...itemData, score };
    });

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
    sendServerError(res, error, '[FEATUREROUTES_ERROR]');
  }
});

// ═══════════════════════════════════════════════════════
// F13: ELITE GIFTING
// ═══════════════════════════════════════════════════════

// POST /api/features/gift - Send a gift (meal voucher) to another user
const giftError = (msg) => Object.assign(new Error(msg), { expose: true });
// Owner decision (C1-3): the wallet is non-transferable refund / order credit (RBI: no P2P transfer of
// stored value). Gifts are OFF unless WALLET_TRANSFERS_ENABLED=true. Checked before the idempotency
// claim, so nothing is reserved or charged; older apps show the message in their error alert.
const walletTransfersEnabled = () => String(process.env.WALLET_TRANSFERS_ENABLED || '').toLowerCase() === 'true';
const TRANSFER_DISABLED_BODY = Object.freeze({ code: 'TRANSFER_DISABLED', message: 'Wallet transfers are turned off. Your wallet balance can be used for orders in ZENV.' });
router.post('/gift', protect, async (req, res, next) => {
  if (!walletTransfersEnabled()) return res.status(403).json({ ...TRANSFER_DISABLED_BODY });
  return next();
}, async (req, res) => {
  // Retry key (customer-1): the app sends the same key for the same recipient + amount until the
  // server answers. A repeat never charges the wallet twice.
  const { readIdempotencyKey, claim } = require('../utils/idempotency');
  const giftKey = readIdempotencyKey(req, (req.body || {}).idempotencyKey);
  const slot = await claim('gift', req.user.id, giftKey);
  if (slot.state === 'busy') {
    return res.status(409).json({ code: 'GIFT_IN_PROGRESS', message: 'Your gift is still being sent. Hang tight.' });
  }
  if (slot.state === 'done') return res.status(slot.status).json({ ...slot.body, duplicate: true });
  try {
    const { message } = req.body || {};
    const { normalizePhone } = require('../utils/phoneUtils');
    const recipientPhone = normalizePhone(String(req.body?.recipientPhone || ''));
    const amount = Number(req.body?.amount);
    if (!/^\d{10}$/.test(recipientPhone) || !amount) {
      return res.status(400).json({ message: "Enter your friend's 10-digit phone number and a gift amount." });
    }
    if (!Number.isInteger(amount) || amount < 10 || amount > 500) {
      return res.status(400).json({ message: 'Gift amount must be between ₹10 and ₹500' });
    }

    const { getUserModel } = require('../models/User');
    const User = getUserModel();
    const { getSequelize } = require('../config/db');
    const sequelize = getSequelize();

    let updatedSender;
    let recipientName;
    let replayed = false;
    let giftEvent = null;

    await sequelize.transaction(async (t) => {
      const sender = await User.findByPk(req.user.id, { transaction: t, lock: true });
      if (!sender) throw giftError('Sender not found');
      // Same key as the last gift that went through (e.g. a retry after a restart): answer with
      // that gift instead of sending another one. Checked under the sender's row lock.
      if (giftKey && sender.lastGiftKey === giftKey) {
        const recipient = await User.findOne({ where: { phone: recipientPhone }, attributes: ['name'], transaction: t });
        updatedSender = sender;
        recipientName = recipient ? recipient.name : 'your friend';
        replayed = true;
        return;
      }
      if (!sender.isElite) throw giftError('Only Elite members can send gifts');

      const now = new Date();
      const { istMonthKey } = require('../utils/istTime');
      if (sender.lastGiftResetDate) {
        // Monthly limit resets on the IST month boundary, not the server's UTC one.
        if (istMonthKey(sender.lastGiftResetDate) !== istMonthKey(now)) {
          sender.eliteGiftsUsedThisMonth = 0;
          sender.lastGiftResetDate = now;
        }
      } else {
        sender.lastGiftResetDate = now;
      }

      if ((sender.eliteGiftsUsedThisMonth || 0) >= 3) {
        throw giftError('Monthly gift limit reached (3/month)');
      }

      if ((sender.walletBalance || 0) < amount) {
        throw giftError('Insufficient wallet balance');
      }

      const recipient = await User.findOne({ where: { phone: recipientPhone }, transaction: t, lock: true });
      if (!recipient) throw giftError('No ZENV account uses that phone number.');
      if (recipient.id === sender.id) throw giftError('Cannot gift yourself');

      // C5: both sides move through the wallet ledger (GIFT_SENT / GIFT_RECEIVED) in this transaction.
      // walletBalance is never assigned on the instances, so save() below does not overwrite it.
      const walletLedger = require('../utils/walletLedger');
      const giftPaise = walletLedger.toPaise(amount);
      const ledgerKey = giftKey ? `gift:${giftKey}` : null;
      let debit;
      try {
        debit = await walletLedger.applyWalletChange({
          t, ownerType: 'user', ownerId: sender.id, amountPaise: -giftPaise, type: walletLedger.TYPES.GIFT_SENT,
          ref: { type: 'USER', id: recipient.id }, actor: { type: 'user', id: sender.id }, idempotencyKey: ledgerKey,
        });
      } catch (e) {
        if (walletLedger.isInsufficient(e)) throw giftError('Insufficient wallet balance');
        throw e;
      }
      await walletLedger.applyWalletChange({
        t, ownerType: 'user', ownerId: recipient.id, amountPaise: giftPaise, type: walletLedger.TYPES.GIFT_RECEIVED,
        ref: { type: 'USER', id: sender.id }, actor: { type: 'user', id: sender.id }, idempotencyKey: ledgerKey,
      });
      sender.eliteGiftsUsedThisMonth = (sender.eliteGiftsUsedThisMonth || 0) + 1;
      if (giftKey) sender.lastGiftKey = giftKey;
      await sender.save({ transaction: t });
      sender.setDataValue('walletBalance', debit.balance);

      updatedSender = sender;
      recipientName = recipient.name;
      giftEvent = {
        room: `user_${recipient.id}`,
        payload: {
          recipientId: recipient.id,
          senderName: sender.name,
          amount,
          message: message || `${sender.name} sent you a meal gift! 🎁`
        }
      };
    });

    // Notify only the recipient (personal socket room) — after the transaction committed, so a
    // rolled-back gift is never announced.
    if (giftEvent) {
      const io = req.app.get('io');
      if (io) io.to(giftEvent.room).emit('gift_received', giftEvent.payload);
    }

    if (!replayed) console.log(`[GIFT] ${updatedSender.name} → ${recipientName}: ₹${amount}`);
    const body = {
      message: `₹${amount} gift sent to ${recipientName}! 🎁`,
      remainingGifts: Math.max(0, 3 - (updatedSender.eliteGiftsUsedThisMonth || 0)),
      newBalance: updatedSender.walletBalance
    };
    await slot.finish(200, body);
    res.json(replayed ? { ...body, duplicate: true } : body);
  } catch (error) {
    console.error('[GIFT_ERROR]', error);
    if (error.expose) return res.status(400).json({ message: error.message });
    res.status(500).json({ message: 'Could not send the gift right now. Your wallet was not charged.' });
  } finally {
    await slot.release(); // no-op after finish(); frees the key after any refusal so a retry can run
  }
});

// ═══════════════════════════════════════════════════════
// F2: PUSH NOTIFICATION CAMPAIGNS
// ═══════════════════════════════════════════════════════

// POST /api/features/push/campaign - Send a push campaign (Admin only)
router.post('/push/campaign', protect, admin, async (req, res) => {
  try {
    const { title, body, targetType, targetData } = req.body || {};
    // targetType: 'all', 'elite', 'block', 'inactive'. Anything else is refused — an unknown or
    // misspelled target must never fall through to "every user" (B20).
    if (!title || !body) return res.status(400).json({ message: 'Title and body are required' });
    const TARGETS = ['all', 'elite', 'block', 'inactive'];
    if (!TARGETS.includes(targetType)) {
      return res.status(400).json({ message: `Choose a target: ${TARGETS.join(', ')}` });
    }
    const block = targetType === 'block' ? String((targetData && targetData.block) || '').trim() : '';
    if (targetType === 'block' && !block) return res.status(400).json({ message: 'Pick the hostel block to target.' });

    const { getUserModel } = require('../models/User');
    const { sendPushToTokens } = require('../utils/push');
    const User = getUserModel();
    const { Op } = require('sequelize');

    let where = {};
    if (targetType === 'elite') where = { isElite: true };
    else if (targetType === 'block') where = { hostelBlock: block };
    else if (targetType === 'inactive') where = { updatedAt: { [Op.lt]: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } };

    // Only the columns needed to send (no full user rows in memory).
    const users = await User.findAll({ where, attributes: ['id', 'fcmTokens'], raw: true });
    const parseTokens = (t) => {
      if (Array.isArray(t)) return t;
      if (typeof t === 'string') { try { const v = JSON.parse(t); return Array.isArray(v) ? v : []; } catch { return []; } }
      return [];
    };
    const targets = users.map((u) => ({ id: u.id, tokens: parseTokens(u.fcmTokens) })).filter((u) => u.tokens.length > 0);
    const sentCount = targets.length;

    // Send in the background in small batches so a big campaign never holds the request open.
    setTimeout(async () => {
      const BATCH = 25;
      for (let i = 0; i < targets.length; i += BATCH) {
        await Promise.all(targets.slice(i, i + BATCH).map((u) =>
          sendPushToTokens(u.tokens, title, body, { type: 'campaign' }, { recipients: [u.id] }).catch(() => null)));
      }
      console.log(`[PUSH_CAMPAIGN] "${title}" sent to ${sentCount}/${users.length} users (target: ${targetType})`);
    }, 0);

    res.json({
      message: `Campaign sending to ${sentCount} devices`,
      totalUsers: users.length,
      devicesReached: sentCount
    });
  } catch (error) {
    console.error('[PUSH_CAMPAIGN_ERROR]', error);
    sendServerError(res, error, '[FEATUREROUTES_ERROR]');
  }
});

// Abandoned-cart nudge: customers who ordered 3-10 days ago and not since.
// Called in-process by the daily cron (jobs/index.js) and by admins through the route below.
const runAbandonedCartNudge = async () => {
  const { getUserModel } = require('../models/User');
  const { getOrderModel } = require('../models/Order');
  const { sendPushToTokens } = require('../utils/push');
  const { Op } = require('sequelize');
  const User = getUserModel();
  const Order = getOrderModel();

  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);

  const olderOrders = await Order.findAll({
    where: { createdAt: { [Op.between]: [tenDaysAgo, threeDaysAgo] } },
    attributes: ['userId'],
    group: ['userId']
  });
  const recentOrders = await Order.findAll({
    where: { createdAt: { [Op.gt]: threeDaysAgo } },
    attributes: ['userId'],
    group: ['userId']
  });
  const orderedRecently = new Set(recentOrders.map(o => o.userId));
  const targetUserIds = olderOrders.map(o => o.userId).filter(id => id && !orderedRecently.has(id));
  if (targetUserIds.length === 0) return { count: 0 };

  const users = await User.findAll({ where: { id: { [Op.in]: targetUserIds } } });

  let sentCount = 0;
  for (const user of users) {
    const tokens = user.fcmTokens;
    if (tokens && Array.isArray(tokens) && tokens.length > 0) {
      await sendPushToTokens(
        tokens,
        '🍽️ Missing your ZENV meals?',
        `Hey ${(user.name || 'there').split(' ')[0]}! Your favourite campus spots are open. Order now and earn ZENV Points!`,
        { type: 'abandoned_cart' },
        { recipients: [user.id] }
      );
      sentCount++;
    }
  }
  console.log(`[ABANDONED_CART] Nudged ${sentCount} users`);
  return { count: sentCount };
};

// POST /api/features/push/abandoned-cart - Trigger abandoned cart nudge (Admin only)
router.post('/push/abandoned-cart', protect, admin, async (req, res) => {
  try {
    const { count } = await runAbandonedCartNudge();
    res.json({ message: count ? `Nudged ${count} users` : 'No abandoned cart users found', count });
  } catch (error) {
    console.error('[ABANDONED_CART_ERROR]', error);
    res.status(500).json({ message: 'Could not send the nudge right now.' });
  }
});

// POST /api/features/streak/nudge-trigger - Trigger daily fire streak reminders manually (admin only)
router.post('/streak/nudge-trigger', protect, admin, async (req, res) => {
  try {
    const { runStreakNudgeLogic } = require('../cron/streakNudge');
    await runStreakNudgeLogic();
    res.json({ message: 'Streak nudge checks executed successfully.' });
  } catch (error) {
    console.error('[STREAK_NUDGE_TRIGGER_ERROR]', error);
    sendServerError(res, error, '[FEATUREROUTES_ERROR]');
  }
});

module.exports = router;
module.exports.runAbandonedCartNudge = runAbandonedCartNudge;
