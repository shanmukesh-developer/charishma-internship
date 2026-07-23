const cron = require('node-cron');
const { Op } = require('sequelize');
const { getUserModel } = require('../models/User');
const { sendPushToTokens } = require('../utils/push');

const initStreakNudge = () => {
  // Run daily at 18:00 (6:00 PM) to catch users before their streak resets at midnight
  cron.schedule('0 18 * * *', async () => {
    console.log('[STREAK CRON] Running daily fire streak expiry checks...');
    try {
      await runStreakNudgeLogic();
    } catch (error) {
      console.error('[STREAK CRON] Error during streak nudge cycle:', error);
    }
  });
  console.log('⏰ [CRON] Daily streak nudge job scheduled at 6:00 PM');
};

const runStreakNudgeLogic = async () => {
  const User = getUserModel();
  if (!User) return;

  const now = new Date();
  
  // Helper to get local date string (YYYY-MM-DD) in IST
  const getLocalDateString = (date) => {
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istDate = new Date(date.getTime() + istOffset);
    return istDate.toISOString().split('T')[0];
  };

  const todayStr = getLocalDateString(now);
  
  // Calculate yesterday's date string in IST
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayStr = getLocalDateString(yesterday);

  console.log(`[STREAK CHECK] Checking streak status. Today IST: ${todayStr}, Yesterday IST: ${yesterdayStr}`);

  // Fetch all active students with a streak count
  const users = await User.findAll({
    where: {
      role: 'student',
      isActive: 1,
      streakCount: {
        [Op.gt]: 0
      },
      lastOrderDate: {
        [Op.ne]: null
      }
    }
  });

  console.log(`[STREAK CHECK] Scanning ${users.length} users with active streaks...`);

  let nudgedCount = 0;
  for (const user of users) {
    const userLastOrderStr = getLocalDateString(new Date(user.lastOrderDate));
    
    // If their last order was yesterday, and they have not placed an order today yet,
    // their streak is expiring at midnight today (in a few hours)!
    if (userLastOrderStr === yesterdayStr) {
      const tokens = user.fcmTokens ? JSON.parse(user.fcmTokens) : [];
      if (tokens.length > 0) {
        console.log(`[STREAK NUDGE] Nudging ${user.name} (${user.phone}) - Last order: ${userLastOrderStr}`);
        
        await sendPushToTokens(
          user.fcmTokens,
          'Maintain your streak! 🔥',
          `Your daily fire streak of ${user.streakCount} days is expiring in a few hours. Place an order now to keep it alive!`,
          {
            type: 'streak_nudge',
            streakCount: String(user.streakCount)
          }
        );
        nudgedCount++;
      } else {
        console.log(`[STREAK NUDGE] User ${user.name} has expiring streak but no registered push tokens.`);
      }
    }
  }
  
  console.log(`[STREAK CHECK] Finished. Nudged ${nudgedCount} users.`);
};

module.exports = { initStreakNudge, runStreakNudgeLogic };
