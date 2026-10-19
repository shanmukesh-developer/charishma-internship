const admin = require('../config/firebase');
const firebaseMessaging = require('firebase-admin/messaging');
const { recordNotifications } = require('./notificationStore');
const { createLimiter } = require('./pushQueue');

// ── Helpers ─────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// A5: every FCM call (multicast batch or topic send) goes through one in-process queue, so a burst
// (admin broadcast to every user, a lunch-rush of order pushes) never opens thousands of concurrent
// requests. firebase-admin itself times out each request at 15 s and retries 503 / ECONNRESET.
//   PUSH_CONCURRENCY      default 10    FCM calls in flight per process (1..100)
//   PUSH_BATCH_SIZE       default 500   tokens per sendEachForMulticast call (FCM maximum 500)
//   PUSH_QUEUE_MAX        default 10000 calls waiting; beyond that a batch is dropped (counted, logged)
//   PUSH_STALE_CLEANUP    default on    '0' / 'false' keeps unregistered tokens on User / DeliveryPartner rows
const intEnv = (name, def, min, max) => {
  const n = parseInt(process.env[name], 10);
  return Number.isFinite(n) && n >= min ? Math.min(max, n) : def;
};
const FCM_MAX_BATCH = 500;
const batchSize = () => intEnv('PUSH_BATCH_SIZE', FCM_MAX_BATCH, 1, FCM_MAX_BATCH);
const queue = createLimiter(intEnv('PUSH_CONCURRENCY', 10, 1, 100), { maxQueue: intEnv('PUSH_QUEUE_MAX', 10000, 1, 1000000) });
const metrics = { calls: 0, batches: 0, queued: 0, sent: 0, failed: 0, batchErrors: 0, dropped: 0, staleFound: 0, staleRemoved: 0, topics: 0 };
let lastDropLogAt = 0;
const pushStats = () => ({ ...metrics, ...queue.stats(), batchSize: batchSize() });

// Tests swap the messaging client (no network).
let messagingOverride = null;
const getMessaging = () => (messagingOverride ? messagingOverride() : firebaseMessaging.getMessaging());
const firebaseReady = () => {
  if (messagingOverride) return true;
  const apps = (admin.getApps ? admin.getApps() : admin.apps) || [];
  return apps.length > 0;
};

// Unregistered / invalid tokens are removed from the customer and rider rows that hold them (store
// tokens are cleaned by utils/storePush.js). Exact-match re-check after the LIKE lookup; never throws.
const staleCleanupOn = () => !['0', 'false', 'off', 'no'].includes(String(process.env.PUSH_STALE_CLEANUP || '').trim().toLowerCase());
const STALE_MAX_PER_CALL = 1000;
const removeStaleTokens = async (staleTokens) => {
  const tokens = [...new Set((staleTokens || []).filter((t) => typeof t === 'string' && t.length >= 20))].slice(0, STALE_MAX_PER_CALL);
  if (!tokens.length || !staleCleanupOn()) return 0;
  let removed = 0;
  try {
    const { Op } = require('sequelize');
    const { tokenLikePattern, FCM_TOKEN_RE } = require('./fcmToken');
    const safe = tokens.filter((t) => FCM_TOKEN_RE.test(t));
    const staleSet = new Set(safe);
    const tokenOf = (t) => (typeof t === 'string' ? t : t && t.token) || null;
    const models = [];
    try { const M = require('../models/User').getUserModel(); if (M) models.push(M); } catch { /* not loaded */ }
    try { const M = require('../models/DeliveryPartner').getDeliveryPartnerModel(); if (M) models.push(M); } catch { /* not loaded */ }
    for (const Model of models) {
      for (let i = 0; i < safe.length; i += 50) {
        const chunk = safe.slice(i, i + 50);
        const rows = await Model.findAll({
          where: { [Op.or]: chunk.map((t) => ({ fcmTokens: { [Op.like]: tokenLikePattern(t) } })) },
          attributes: ['id', 'fcmTokens'],
        });
        for (const row of rows) {
          const before = Array.isArray(row.fcmTokens) ? row.fcmTokens : [];
          const after = before.filter((t) => !staleSet.has(tokenOf(t)));
          if (after.length === before.length) continue;
          row.fcmTokens = after;
          row.changed('fcmTokens', true);
          await row.save({ fields: ['fcmTokens'], hooks: false });
          removed += before.length - after.length;
        }
      }
    }
    if (removed) console.log(`[FCM_SEND] removed ${removed} unregistered device token(s).`);
  } catch (err) {
    console.warn('[FCM_STALE_CLEANUP_WARN]', err.message);
  }
  metrics.staleRemoved += removed;
  return removed;
};
// Cleanups run in the background; tests await them.
const pendingCleanups = new Set();
const _flushCleanups = () => Promise.all([...pendingCleanups]);

const buildMessage = (data, extraFCMOptions) => ({
  data: Object.fromEntries(
    Object.entries(data || {}).map(([k, v]) => [k, v !== undefined && v !== null ? String(v) : ''])
  ),
  android: {
    priority: 'high',
    notification: {
      sound: 'alert',
      channelId: 'delivery-alerts-v2',
    },
    ...(extraFCMOptions.android || {})
  },
  apns: {
    payload: {
      aps: {
        sound: 'alert.wav',
      },
      ...(extraFCMOptions.apns?.payload || {})
    },
    ...(extraFCMOptions.apns || {})
  },
  ...Object.fromEntries(Object.entries(extraFCMOptions).filter(([k]) => k !== 'android' && k !== 'apns'))
});

// ── Multicast Push ──────────────────────────────────────────────────────
// Options that are ours, not FCM's:
//   recipients: [userId]  saves the notification for these users (even if they have no device token)
//   persist: false        do not save it in the in-app notification list
const sendPushToTokens = async (tokens, title, body, data = {}, extraFCMOptions = {}) => {
  const { recipients, persist, ...fcmOptions } = extraFCMOptions || {};
  extraFCMOptions = fcmOptions;
  let tokenList = tokens;
  if (typeof tokens === 'string') {
    try {
      tokenList = JSON.parse(tokens);
    } catch {
      tokenList = [];
    }
  }
  if (!Array.isArray(tokenList)) tokenList = [];

  if (persist !== false) {
    await recordNotifications({ userIds: Array.isArray(recipients) ? recipients : undefined, tokens: tokenList, title, body, data });
  }

  if (!firebaseReady()) return console.log('[FCM_SEND] Firebase not initialized — skipping push');
  if (tokenList.length === 0) return;

  const validTokens = [...new Set(tokenList.map(t => typeof t === 'string' ? t : t && t.token).filter(Boolean))];
  if (validTokens.length === 0) return { successCount: 0, failureCount: 0, staleTokens: [] };

  const MAX_BATCH_SIZE = batchSize();
  let totalSuccess = 0;
  let totalFailure = 0;
  const allStaleTokens = [];
  metrics.calls++;

  const sendBatch = async (i) => {
    const batchTokens = validTokens.slice(i, i + MAX_BATCH_SIZE);
    const message = {
      notification: { title, body },
      tokens: batchTokens,
      ...buildMessage(data, extraFCMOptions)
    };

    const attemptSend = async (attempt = 1) => {
      try {
        const response = await getMessaging().sendEachForMulticast(message);
        const successCount = response.successCount || 0;
        const failureCount = response.failureCount || 0;
        console.log(`[FCM_SEND] Multicast Batch ${i / MAX_BATCH_SIZE + 1}: ${successCount} sent, ${failureCount} failed (attempt ${attempt})`);

        // Clean up stale/invalid tokens
        if (response.responses) {
          const staleTokens = [];
          response.responses.forEach((resp, idx) => {
            if (resp.error) {
              const code = resp.error.code || '';
              if (code === 'messaging/registration-token-not-registered' ||
                  code === 'messaging/invalid-registration-token') {
                staleTokens.push(batchTokens[idx]);
              }
            }
          });
          if (staleTokens.length > 0) {
            allStaleTokens.push(...staleTokens);
            console.log(`[FCM_SEND] ${staleTokens.length} stale token(s) detected in batch.`);
          }
        }

        totalSuccess += successCount;
        totalFailure += failureCount;
        metrics.sent += successCount;
        metrics.failed += failureCount;
        return response;
      } catch (error) {
        const statusCode = error?.httpResponse?.status || error?.code || '';
        const isTransient = typeof statusCode === 'number'
          ? statusCode >= 500
          : String(statusCode).includes('unavailable') || String(statusCode).includes('internal');

        if (isTransient && attempt < 3) {
          console.warn(`[FCM_SEND] Transient error (${statusCode}) on batch, retrying in 2s...`);
          await sleep(2000 * attempt);
          return attemptSend(attempt + 1);
        }
        console.error(`[FCM_SEND] Failed batch after ${attempt} attempt(s):`, error.message || error);
        metrics.batchErrors++;
        metrics.failed += batchTokens.length;
      }
    };

    await attemptSend();
  };

  // Batches of this call share the global queue with every other push (bounded concurrency).
  const jobs = [];
  for (let i = 0; i < validTokens.length; i += MAX_BATCH_SIZE) {
    metrics.batches++;
    metrics.queued++;
    jobs.push(queue.run(() => sendBatch(i)).catch((err) => {
      const n = Math.min(MAX_BATCH_SIZE, validTokens.length - i);
      metrics.dropped++;
      metrics.failed += n;
      if (Date.now() - lastDropLogAt > 60000) {
        lastDropLogAt = Date.now();
        console.warn(`[FCM_SEND] push queue full (${err && err.message}): batch of ${n} dropped`);
      }
    }));
  }
  await Promise.all(jobs);

  if (allStaleTokens.length) {
    metrics.staleFound += allStaleTokens.length;
    const p = removeStaleTokens(allStaleTokens).finally(() => pendingCleanups.delete(p));
    pendingCleanups.add(p);
  }

  return { successCount: totalSuccess, failureCount: totalFailure, staleTokens: allStaleTokens };
};

// ── Topic Push ──────────────────────────────────────────────────────────
const sendPushToTopic = async (topic, title, body, data = {}, extraFCMOptions = {}) => {
  if (!firebaseReady()) return console.log('[FCM_TOPIC] Firebase not initialized — skipping push');

  const message = {
    notification: { title, body },
    topic,
    ...buildMessage(data, extraFCMOptions)
  };

  const attemptSend = async (attempt = 1) => {
    try {
      const response = await getMessaging().send(message);
      console.log(`[FCM_TOPIC] Sent to "${topic}" (attempt ${attempt}):`, response);
      return response;
    } catch (error) {
      const statusCode = error?.httpResponse?.status || error?.code || '';
      const isTransient = typeof statusCode === 'number'
        ? statusCode >= 500
        : String(statusCode).includes('unavailable') || String(statusCode).includes('internal');

      if (isTransient && attempt < 2) {
        console.warn(`[FCM_TOPIC] Transient error (${statusCode}), retrying in 2s...`);
        await sleep(2000);
        return attemptSend(attempt + 1);
      }
      console.error(`[FCM_TOPIC] Failed to send to "${topic}" after ${attempt} attempt(s):`, error.message || error);
    }
  };

  metrics.topics++;
  metrics.queued++;
  await queue.run(() => attemptSend()).catch((err) => {
    metrics.dropped++;
    console.warn(`[FCM_TOPIC] push queue full (${err && err.message}): topic "${topic}" send dropped`);
  });
};

const _setMessaging = (fn) => { messagingOverride = fn || null; };
const _resetPushStats = () => { for (const k of Object.keys(metrics)) metrics[k] = 0; };

module.exports = { sendPushToTokens, sendPushToTopic, pushStats, removeStaleTokens, _setMessaging, _flushCleanups, _resetPushStats, _queue: queue };
