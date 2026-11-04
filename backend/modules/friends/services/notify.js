/**
 * Friends notifications on top of the existing push + Notification store (campusHelpers.pushToUsers).
 *  - Respects each recipient's FriendsSettings.notifPrefs (type -> preference key below).
 *  - Dedupes on "type:target:recipient" for 10 minutes (retries never notify twice). Callers must also
 *    only notify when their row was newly created.
 *  - Lock-screen bodies are generic unless the recipient turned lockScreenPreviews on; Connect and
 *    moderation bodies are always generic.
 *  - Data shape for deep links: { type, screen: 'friends', sub, id }.
 */
const { Op } = require('sequelize');
const { getModel } = require('../index');
const { DEFAULT_NOTIF_PREFS } = require('../models/foundation/settings');

const DEDUPE_MS = 10 * 60 * 1000;
const seen = new Map(); // key -> ms

// type -> { pref, sub, title, generic body, alwaysGeneric }
const TYPES = {
  FRIENDS_REPLY: { pref: 'replies', sub: 'pulse', title: 'New reply', generic: 'Someone replied to your post.' },
  FRIENDS_MENTION: { pref: 'mentions', sub: 'pulse', title: 'You were mentioned', generic: 'Someone mentioned you in Friends.' },
  FRIENDS_FOLLOW: { pref: 'follows', sub: 'pulse', title: 'New follower', generic: 'Someone on your campus followed you.' },
  FORUM_ANSWER: { pref: 'forum', sub: 'forum', title: 'New answer', generic: 'Your forum post has a new comment.' },
  FORUM_BEST_ANSWER: { pref: 'forum', sub: 'forum', title: 'Best answer', generic: 'Your comment was marked as the best answer.' },
  SPACE_REMINDER: { pref: 'spaces', sub: 'spaces', title: 'Space starting soon', generic: 'A Space you follow starts soon.' },
  SPACE_UPDATED: { pref: 'spaces', sub: 'spaces', title: 'Space updated', generic: 'A Space you wanted to join was changed.' },
  TASK_APPLICATION: { pref: 'tasks', sub: 'tasks', title: 'New application', generic: 'Someone applied to your task.' },
  TASK_SELECTED: { pref: 'tasks', sub: 'tasks', title: 'You were selected', generic: 'You were selected for a task.' },
  TASK_ACCEPTED: { pref: 'tasks', sub: 'tasks', title: 'Task accepted', generic: 'Your helper accepted the task.' },
  TASK_SUBMITTED: { pref: 'tasks', sub: 'tasks', title: 'Task submitted', generic: 'Your helper marked the task as done.' },
  TASK_COMPLETED: { pref: 'tasks', sub: 'tasks', title: 'Task completed', generic: 'A task was confirmed as completed.' },
  TASK_REVIEW: { pref: 'tasks', sub: 'tasks', title: 'New review', generic: 'You received a task review.' },
  TASK_CANCELLED: { pref: 'tasks', sub: 'tasks', title: 'Task cancelled', generic: 'A task you are part of was cancelled.' },
  CONNECT_MATCH: { pref: 'connect', sub: 'connect', title: 'ZENV Friends', generic: 'You have a new match.', alwaysGeneric: true },
  MOD_OUTCOME: { pref: 'moderation', sub: 'safety', title: 'Friends safety update', generic: 'There is an update on a Friends safety review.', alwaysGeneric: true, mandatory: true },
  APPEAL_DECIDED: { pref: 'moderation', sub: 'safety', title: 'Appeal decided', generic: 'Your appeal has been reviewed.', alwaysGeneric: true, mandatory: true },
};

const sweep = (now) => {
  for (const [k, t] of seen) if (now - t > DEDUPE_MS) seen.delete(k);
};

const prefsFor = async (userIds) => {
  const FriendsSettings = getModel('FriendsSettings');
  const out = new Map();
  if (!FriendsSettings || !userIds.length) return out;
  const rows = await FriendsSettings.findAll({ where: { userId: { [Op.in]: userIds } }, attributes: ['userId', 'notifPrefs'] });
  rows.forEach((r) => out.set(String(r.userId), { ...DEFAULT_NOTIF_PREFS, ...(r.notifPrefs || {}) }));
  return out;
};

const pusher = { send: null }; // tests may replace send(userIds, title, body, data)
// Friends pushes follow the app's "Campus activity" switch (utils/pushCategories; chats and calls never muted).
const defaultSend = (ids, title, body, data) => require('../../campus/campusHelpers').pushToUsers(ids, title, body, data, { category: 'campus' });

/**
 * @param {string} type     one of TYPES
 * @param {string[]} recipients user ids (the actor is removed by the caller)
 * @param {object} p        { id (target id for deep link + dedupe), body (detailed body), data, dedupeKey }
 * @returns {Promise<string[]>} the user ids that were notified
 */
const notify = async (type, recipients, p = {}) => {
  try {
    const t = TYPES[type];
    if (!t) throw new Error(`unknown notification type ${type}`);
    // Campus switched off (Admin > Friends app > Switches): no Campus pushes, so a scheduled job (Space reminders,
    // task expiry) never sends a student into the closed tab. The API is closed by the same switch (eligibility).
    if (!(await require('./featureFlags').getConfig()).enabled) return [];
    const now = Date.now();
    const target = p.dedupeKey || p.id || '-';
    const ids = [...new Set((recipients || []).filter(Boolean).map(String))];
    const fresh = ids.filter((uid) => {
      const key = `${type}:${target}:${uid}`;
      if (now - (seen.get(key) || 0) < DEDUPE_MS) return false;
      seen.set(key, now);
      return true;
    });
    if (seen.size > 20000) sweep(now);
    if (!fresh.length) return [];

    const prefs = await prefsFor(fresh);
    const allowed = fresh.filter((uid) => {
      if (t.mandatory) return true;
      const pr = prefs.get(uid) || DEFAULT_NOTIF_PREFS;
      return pr[t.pref] !== false;
    });
    if (!allowed.length) return [];

    const data = { ...(p.data || {}), type, screen: 'friends', sub: t.sub, ...(p.id ? { id: String(p.id) } : {}) };
    const detailed = !t.alwaysGeneric && typeof p.body === 'string' && p.body.trim();
    const withPreview = detailed ? allowed.filter((uid) => (prefs.get(uid) || DEFAULT_NOTIF_PREFS).lockScreenPreviews === true) : [];
    const generic = allowed.filter((uid) => !withPreview.includes(uid));
    const send = pusher.send || defaultSend;
    if (generic.length) await send(generic, t.title, t.generic, data);
    if (withPreview.length) await send(withPreview, t.title, p.body.trim().slice(0, 140), data);
    return allowed;
  } catch (err) {
    console.warn('[FRIENDS_NOTIFY_WARN]', type, err.message);
    return [];
  }
};

const resetDedupe = () => seen.clear();

module.exports = { notify, TYPES, pusher, resetDedupe };
