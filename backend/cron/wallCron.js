const cron = require('node-cron');
const { Op } = require('sequelize');
const { getWallEventModel } = require('../models/WallEvent');
const { getWallSubmissionModel } = require('../models/WallSubmission');
const { getCouponModel } = require('../models/Coupon');
const { getUserModel } = require('../models/User');
const { sendPushToTopic, sendPushToTokens } = require('../utils/push');

const initWallCron = () => {
  // 1. Check for expired events every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    console.log('⏰ [WALL CRON] Checking for expired Wall photo contests...');
    try {
      await processExpiredWallEvents();
    } catch (err) {
      console.error('[WALL CRON] Error processing expired events:', err);
    }
  });

  // 2. Cleanup media older than 48 hours post event end (runs daily at 3:00 AM)
  cron.schedule('0 3 * * *', async () => {
    console.log('⏰ [WALL CRON] Running 48h post-event media cleanup...');
    try {
      await cleanupOldWallMedia();
    } catch (err) {
      console.error('[WALL CRON] Error cleaning up media:', err);
    }
  });

  console.log('⏰ [CRON] Wall photo contest winner calculation & media cleanup jobs scheduled.');
};

const processExpiredWallEvents = async () => {
  const WallEvent = getWallEventModel();
  const WallSubmission = getWallSubmissionModel();
  const Coupon = getCouponModel();
  const User = getUserModel();

  if (!WallEvent || !WallSubmission) return;

  const now = new Date();
  const expiredEvents = await WallEvent.findAll({
    where: {
      status: 'ACTIVE',
      endTime: { [Op.lt]: now }
    }
  });

  if (expiredEvents.length === 0) return;

  console.log(`[WALL CRON] Found ${expiredEvents.length} expired event(s) to finalize.`);

  for (const event of expiredEvents) {
    // Find winner with highest likes among approved submissions
    const topSubmission = await WallSubmission.findOne({
      where: {
        eventId: event.id,
        isApproved: true
      },
      order: [['likeCount', 'DESC'], ['createdAt', 'ASC']],
      include: [{ model: User, as: 'user' }]
    });

    let winnerUserId = null;
    let winnerName = 'Community Member';
    let couponCode = null;

    if (topSubmission && topSubmission.userId) {
      winnerUserId = topSubmission.userId;
      if (topSubmission.user && topSubmission.user.name) {
        winnerName = topSubmission.user.name;
      }

      // Generate coupon reward for winner
      const uniqueSuffix = Math.random().toString(36).substring(2, 7).toUpperCase();
      couponCode = `WALL-${uniqueSuffix}`;
      const rewardVal = event.couponValue || 100;

      if (Coupon) {
        try {
          await Coupon.create({
            code: couponCode,
            type: 'DISCOUNT',
            value: rewardVal,
            userId: winnerUserId,
            isUsed: false,
            expiryDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) // 14 days valid
          });
          console.log(`🎁 [WALL REWARD] Created coupon ${couponCode} (₹${rewardVal}) for winner ${winnerUserId}`);
        } catch (cErr) {
          console.error('[WALL REWARD ERR]', cErr);
        }
      }
    }

    // Update event status
    event.status = 'ENDED';
    event.winnerUserId = winnerUserId;
    event.couponCode = couponCode;
    await event.save();

    console.log(`🏆 [WALL EVENT ENDED] Event "${event.title}" finalized. Winner: ${winnerName} (${winnerUserId})`);

    // Trigger Push Notifications
    try {
      // 1. Broadcast notification to all users
      await sendPushToTopic('all_users', '🏆 The Wall Has a Winner!', `Congratulations to ${winnerName} for winning "${event.title}"! Check out the winning photo in the Hall of Fame.`, {
        type: 'WALL_EVENT_ENDED',
        eventId: event.id,
        winnerUserId: winnerUserId || ''
      });

      // 2. Direct winner notification
      if (winnerUserId && topSubmission.user && topSubmission.user.fcmTokens) {
        await sendPushToTokens(
          topSubmission.user.fcmTokens,
          '👑 YOU WON THE WALL PHOTO CONTEST!',
          `Your photo scored ${topSubmission.likeCount} votes! You won a ₹${event.couponValue || 100} coupon. Code: ${couponCode}`,
          {
            type: 'WALL_WINNER_REWARD',
            couponCode: couponCode || '',
            eventId: event.id
          }
        );
      }
    } catch (pErr) {
      console.error('[WALL NOTIFICATION ERR]', pErr);
    }
  }
};

const cleanupOldWallMedia = async () => {
  const WallEvent = getWallEventModel();
  const WallSubmission = getWallSubmissionModel();
  if (!WallEvent || !WallSubmission) return;

  // 48 hours ago
  const cutoffTime = new Date(Date.now() - 48 * 60 * 60 * 1000);

  const endedEvents = await WallEvent.findAll({
    where: {
      status: 'ENDED',
      endTime: { [Op.lt]: cutoffTime }
    }
  });

  for (const evt of endedEvents) {
    // Delete non-winning submission images to save storage
    const deletedCount = await WallSubmission.destroy({
      where: {
        eventId: evt.id,
        userId: { [Op.ne]: evt.winnerUserId }
      }
    });
    if (deletedCount > 0) {
      console.log(`🧹 [WALL CLEANUP] Purged ${deletedCount} non-winning submission images for event "${evt.title}"`);
    }
  }
};

module.exports = { initWallCron, processExpiredWallEvents };
