const { Op } = require('sequelize');
const { getWallEventModel } = require('../models/WallEvent');
const { getWallSubmissionModel } = require('../models/WallSubmission');
const { getCouponModel } = require('../models/Coupon');
const { getUserModel } = require('../models/User');
const { sendPushToTokens } = require('../utils/push');
// Wall announcements: every student's devices, only while Campus is on (utils/campusBroadcast; topics reached nobody).
const campusBroadcast = require('../utils/campusBroadcast');

// Scheduled by jobs/index.js through utils/jobs.runExclusive:
//  1. every 5 minutes ('*/5 * * * *'): finalize expired Wall photo contests (runWallFinalizeJob)
//  2. daily 03:00 India time ('0 3 * * *' Asia/Kolkata, B25): purge media 48 h after an event ended
// Both log and swallow their errors (as the old cron callbacks did) and return counts.
const runWallFinalizeJob = async () => {
  console.log('⏰ [WALL CRON] Checking for expired Wall photo contests...');
  try {
    return { finalized: await processExpiredWallEvents() };
  } catch (err) {
    console.error('[WALL CRON] Error processing expired events:', err);
    return { finalized: 0 };
  }
};

const runWallMediaCleanupJob = async () => {
  console.log('⏰ [WALL CRON] Running 48h post-event media cleanup...');
  try {
    return { purged: await cleanupOldWallMedia() };
  } catch (err) {
    console.error('[WALL CRON] Error cleaning up media:', err);
    return { purged: 0 };
  }
};

// The winner's prize coupon: a whole number of rupees, ₹1 to ₹1000 (the admin form's limit, also checked by the
// event routes). An event saved with a value outside it (an older admin build, a direct API call) is held to it here,
// so a typo never becomes a ₹10,000 coupon and a negative value never becomes some other discount.
const WALL_PRIZE_MAX = 1000;
const wallPrizeValue = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= WALL_PRIZE_MAX ? n : null;
};
const prizeFor = (event) => {
  const n = Math.round(Number(event.couponValue));
  return Number.isFinite(n) && n >= 1 ? Math.min(WALL_PRIZE_MAX, n) : 100;
};

const processExpiredWallEvents = async () => {
  const WallEvent = getWallEventModel();
  const WallSubmission = getWallSubmissionModel();
  const Coupon = getCouponModel();
  const User = getUserModel();

  if (!WallEvent || !WallSubmission) return 0;

  const now = new Date();
  const expiredEvents = await WallEvent.findAll({
    where: {
      status: 'ACTIVE',
      endTime: { [Op.lt]: now }
    }
  });

  if (expiredEvents.length === 0) return 0;
  let finalized = 0;

  console.log(`[WALL CRON] Found ${expiredEvents.length} expired event(s) to finalize.`);

  for (const event of expiredEvents) {
    // Claim the event first (conditional ACTIVE -> ENDED): the 5-minute cron, the admin "finalize
    // now" route and a second instance during a deploy can all see the same expired event. Only
    // the run that flips it awards the coupon and sends the pushes (no duplicate WALL- coupons).
    const [claimed] = await WallEvent.update({ status: 'ENDED' }, { where: { id: event.id, status: 'ACTIVE' } });
    if (!claimed) continue;
    finalized++;

    // Winner = most real votes (counted from WallLikes, not the cached likeCount) among approved
    // submissions; a photo with no votes never wins (B18).
    const voteCount = WallSubmission.sequelize.literal('(SELECT COUNT(*) FROM "WallLikes" WHERE "WallLikes"."submissionId" = "WallSubmission"."id")');
    const ranked = await WallSubmission.findOne({
      where: {
        eventId: event.id,
        isApproved: true
      },
      attributes: ['id', [voteCount, 'votes']],
      order: [[voteCount, 'DESC'], ['createdAt', 'ASC']],
    });
    const votes = ranked ? Number(ranked.get('votes')) || 0 : 0;
    const topSubmission = ranked && votes > 0
      ? await WallSubmission.findByPk(ranked.id, { include: [{ model: User, as: 'user' }] })
      : null;
    if (topSubmission) topSubmission.likeCount = votes;

    let winnerUserId = null;
    let winnerName = 'Community Member';
    let couponCode = null;
    const rewardVal = prizeFor(event);

    if (topSubmission && topSubmission.userId) {
      winnerUserId = topSubmission.userId;
      if (topSubmission.user && topSubmission.user.name) {
        winnerName = topSubmission.user.name;
      }

      // Generate coupon reward for winner
      const uniqueSuffix = require('crypto').randomBytes(4).toString('hex').slice(0, 6).toUpperCase();
      couponCode = `WALL-${uniqueSuffix}`;

      if (!Coupon) couponCode = null;
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
          // No coupon was created: never announce / store a code that does not exist (B18).
          couponCode = null;
          console.error('[WALL REWARD ERR]', cErr);
        }
      }
    }

    // Record the winner (status was already set to ENDED by the claim above)
    await WallEvent.update({ winnerUserId, couponCode }, { where: { id: event.id } });
    event.status = 'ENDED';
    event.winnerUserId = winnerUserId;
    event.couponCode = couponCode;
    require('../utils/realtime').publish('wall', 'updated', event.id, { scope: 'event' });

    console.log(`🏆 [WALL EVENT ENDED] Event "${event.title}" finalized. Winner: ${winnerName} (${winnerUserId})`);

    // Trigger Push Notifications
    try {
      // 1. Broadcast to all users, only when someone won (a contest with no voted photo used to announce
      //    "Congratulations to Community Member" to every student). First name only, like the public leaderboard.
      if (winnerUserId) {
        const firstName = String(winnerName || '').trim().split(/\s+/)[0].slice(0, 30) || 'a student';
        await campusBroadcast.broadcastToStudents('🏆 The Wall Has a Winner!', `Congratulations to ${firstName} for winning "${event.title}"! Check out the winning photo in the Hall of Fame.`, {
          type: 'WALL_EVENT_ENDED',
          eventId: event.id,
          winnerUserId
        });
      }

      // 2. Direct winner notification
      if (winnerUserId && topSubmission.user && topSubmission.user.fcmTokens) {
        await sendPushToTokens(
          topSubmission.user.fcmTokens,
          '👑 YOU WON THE WALL PHOTO CONTEST!',
          couponCode
            ? `Your photo scored ${topSubmission.likeCount} votes! You won a ₹${rewardVal} coupon. Code: ${couponCode}`
            : `Your photo scored ${topSubmission.likeCount} votes! Our team will send your reward shortly.`,
          {
            type: 'WALL_WINNER_REWARD',
            couponCode: couponCode || '',
            eventId: event.id
          },
          { recipients: [winnerUserId] }
        );
      }
    } catch (pErr) {
      console.error('[WALL NOTIFICATION ERR]', pErr);
    }
  }
  return finalized;
};

const cleanupOldWallMedia = async () => {
  const WallEvent = getWallEventModel();
  const WallSubmission = getWallSubmissionModel();
  if (!WallEvent || !WallSubmission) return 0;
  let purged = 0;

  // 48 hours ago
  const cutoffTime = new Date(Date.now() - 48 * 60 * 60 * 1000);

  const endedEvents = await WallEvent.findAll({
    where: {
      status: 'ENDED',
      endTime: { [Op.lt]: cutoffTime }
    }
  });

  for (const evt of endedEvents) {
    // Delete non-winning submission images to save storage. (`userId <> NULL` matches nothing in
    // SQL, so an event without a winner used to keep every photo.)
    const where = evt.winnerUserId ? { eventId: evt.id, userId: { [Op.ne]: evt.winnerUserId } } : { eventId: evt.id };
    const doomed = await WallSubmission.findAll({ where, attributes: ['id', 'imageUrl'] });
    const deletedCount = doomed.length ? await WallSubmission.destroy({ where: { id: { [Op.in]: doomed.map((d) => d.id) } } }) : 0;
    // ...and their photo bytes (B19).
    if (doomed.length) await require('../utils/mediaCleanup').releaseMedia(doomed.map((d) => d.imageUrl), 'wall').catch(() => 0);
    purged += deletedCount;
    if (deletedCount > 0) {
      console.log(`🧹 [WALL CLEANUP] Purged ${deletedCount} non-winning submission images for event "${evt.title}"`);
    }
  }
  return purged;
};

module.exports = { runWallFinalizeJob, runWallMediaCleanupJob, processExpiredWallEvents, cleanupOldWallMedia, WALL_PRIZE_MAX, wallPrizeValue };
