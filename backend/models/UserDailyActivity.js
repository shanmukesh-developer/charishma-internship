const { DataTypes } = require('sequelize');

// Daily target + streak for the Play closed test (owner, 6 Nov 2026; utils/testerDailyTarget.js): one row per
// customer per IST calendar day on which the customer app was used. Written by utils/appPresence (same throttled
// path as Users.lastSeenAt); read by Admin > Active testers ("did 12+ testers use ZenWe today?").
//   userId         Users.id (string; no FK so a deleted account never blocks anything)
//   day            'YYYY-MM-DD', the IST calendar day
//   firstAt/lastAt first and last recorded use that day
//   appVersion     last customer-app version seen that day
//
// CLOSED-TEST ONLY (owner: usage time is temporary, removed after production; utils/usageTime.js):
//   activeSeconds  seconds of foreground use that day (heartbeats, clamped server side)
//   sessions       sessions that day (a new session = more than 5 min since the last heartbeat)
//   lastBeatMs     epoch ms of the last credited heartbeat (duplicate / gap detection)
// To remove usage time later: drop these three columns' use (utils/usageTime.js), the daily rows stay.
let UserDailyActivity;

const initUserDailyActivityModel = (sequelize) => {
  if (!sequelize) return null;
  UserDailyActivity = sequelize.define('UserDailyActivity', {
    userId: { type: DataTypes.STRING(64), primaryKey: true, allowNull: false },
    day: { type: DataTypes.DATEONLY, primaryKey: true, allowNull: false },
    firstAt: { type: DataTypes.DATE, allowNull: false },
    lastAt: { type: DataTypes.DATE, allowNull: false },
    appVersion: { type: DataTypes.STRING(32), allowNull: true },
    // closed-test only (utils/usageTime.js)
    activeSeconds: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    sessions: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    lastBeatMs: { type: DataTypes.BIGINT, allowNull: true },
  }, {
    tableName: 'UserDailyActivities',
    timestamps: false,
    indexes: [{ name: 'user_daily_activities_day', fields: ['day'] }],
  });
  return UserDailyActivity;
};

const getUserDailyActivityModel = () => UserDailyActivity;

module.exports = { initUserDailyActivityModel, getUserDailyActivityModel };
