/**
 * Announcements to every student for Campus features (Wall photo contests), 1 Nov 2026.
 *
 * The Wall used FCM topic sends ('all_users'), but no ZCS app subscribes to topics (every app registers device
 * tokens), so "The Wall Photo Contest is LIVE!" and the winner announcement reached nobody. This sends to every
 * active student's devices instead, the same way the admin broadcast does, and only while Campus is switched on
 * (Admin > Friends app > Switches): the Wall lives in Campus, so a closed Campus gets no Wall pushes.
 */
const tokensOf = (user) => {
  let list = user && user.fcmTokens;
  if (!list) return [];
  if (typeof list === 'string') {
    try { list = JSON.parse(list); } catch { list = [list]; }
  }
  if (!Array.isArray(list)) return [];
  return list.map((t) => (typeof t === 'string' ? t : t && t.token)).filter(Boolean);
};

/** -> { sent: true, devices, students } or { sent: false, reason: 'campus_off' | 'no_devices' }. Never throws. */
const broadcastToStudents = async (title, body, data = {}) => {
  try {
    const flags = require('../modules/friends/services/featureFlags');
    if (!(await flags.getConfig()).enabled) return { sent: false, reason: 'campus_off' };
    const User = require('../models/User').getUserModel();
    const users = await User.findAll({ where: { isActive: true }, attributes: ['id', 'fcmTokens'] });
    const tokens = [...new Set(users.flatMap(tokensOf))];
    if (!tokens.length) return { sent: false, reason: 'no_devices' };
    await require('./push').sendPushToTokens(tokens, title, body, data, { recipients: users.map((u) => u.id) });
    return { sent: true, devices: tokens.length, students: users.length };
  } catch (err) {
    console.warn('[CAMPUS_BROADCAST_WARN]', err && err.message);
    return { sent: false, reason: 'error' };
  }
};

module.exports = { broadcastToStudents, _tokensOf: tokensOf };
