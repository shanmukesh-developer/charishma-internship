const failedLogins = new Map();
// B1: with REDIS_URL set the failure counts are mirrored in Redis ('zenvy:lock:<key>' hash, 15 min TTL)
// so 5 wrong passwords lock the account on EVERY instance. The local map stays the source the checks
// read; syncFromShared() merges the shared count in before a check. Without Redis: unchanged.
const redis = require('../utils/redis');

const LOCK_WINDOW_MS = 15 * 60 * 1000;

// Clean up expired locks AND stale partial counts every 15 minutes (the map must not grow forever).
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of failedLogins.entries()) {
    if ((record.lockTime && now > record.lockTime) || (!record.lockTime && now - (record.lastAt || 0) > LOCK_WINDOW_MS)) {
      failedLogins.delete(key);
    }
  }
}, LOCK_WINDOW_MS).unref?.();

// One key per account, however it is typed: '+91 98…', '098…' and '98…' are the same rider, and
// 'Pizza ', 'pizza' and 'PIZZA' the same store. Falls back to the IP only when no identifier is sent.
const lockoutKey = (req) => {
  const body = req.body || {};
  const raw = body.phone || body.email || body.id || body.name || body.identifier;
  const scope = req.baseUrl || '';
  if (!raw) return `${scope}|ip:${req.ip}`;
  const text = String(raw).trim().toLowerCase();
  const digits = text.replace(/\D/g, '');
  // Same rule as utils/phoneUtils.normalizePhone (what the login controllers look the account up
  // by): no letters -> every non-digit is dropped and the last 10 digits are the account. So
  // '9876543210.', '9876543210//' and '#9876543210' all share one key; otherwise appending a junk
  // character gave every guess a fresh counter and the lockout never triggered.
  if (!text.includes('@') && digits.length >= 10 && !/[a-z]/i.test(text)) {
    const { normalizePhone } = require('../utils/phoneUtils');
    return `${scope}|phone:${normalizePhone(text)}`;
  }
  return `${scope}|id:${text.replace(/\s+/g, ' ')}`;
};

// Account-level lock, keyed by the resolved account id (not by whatever body field the client
// used). Controllers that accept several identifier fields (store login: phone, partnerPhone,
// id, email, name, identifier) call these after resolving the account, so switching fields can
// never reset the count.
const MAX_FAILS = 5;

const sharedKey = (key) => `lock:${key}`;
/** Merge the shared (all instances) count for `key` into the local map. Resolves at once without Redis. */
const syncFromShared = async (key) => {
  if (!redis.isReady()) return;
  const h = await redis.tryCmd((c) => c.hgetall(sharedKey(key)));
  if (!h || !h.count) return;
  const count = Number(h.count) || 0;
  const lockTime = Number(h.lockTime) || 0;
  if (lockTime && lockTime <= Date.now()) { shareClear(key); return; } // that lock is over: start again
  const local = failedLogins.get(key) || { count: 0, lockTime: 0 };
  if (count > local.count || lockTime > (local.lockTime || 0)) {
    failedLogins.set(key, { count: Math.max(count, local.count), lockTime: Math.max(lockTime, local.lockTime || 0), lastAt: Date.now() });
  }
};
// One more failure everywhere (fire-and-forget). The 5th one stores the lock time for all instances.
const shareFailure = (key) => {
  if (!redis.isReady()) return;
  const k = sharedKey(key);
  redis.tryCmd((c) => c.multi().hincrby(k, 'count', 1).pexpire(k, LOCK_WINDOW_MS).exec()).then((res) => {
    const count = res && res[0] && !res[0][0] ? Number(res[0][1]) : 0;
    if (count >= MAX_FAILS) {
      const lockTime = Date.now() + LOCK_WINDOW_MS;
      redis.tryCmd((c) => c.hset(k, 'lockTime', String(lockTime)));
      const local = failedLogins.get(key) || { count: 0, lockTime: 0 };
      failedLogins.set(key, { count: Math.max(count, local.count), lockTime: Math.max(lockTime, local.lockTime || 0), lastAt: Date.now() });
    }
  });
};
const shareClear = (key) => {
  if (!redis.isReady()) return;
  redis.tryCmd((c) => c.del(sharedKey(key)));
};

const isAccountLocked = (key) => {
  const record = failedLogins.get(key);
  if (!record || record.count < MAX_FAILS) return false;
  if (Date.now() < record.lockTime) return true;
  failedLogins.delete(key);
  return false;
};
const recordAccountFailure = (key) => {
  const current = failedLogins.get(key) || { count: 0, lockTime: 0 };
  current.count += 1;
  current.lastAt = Date.now();
  if (current.count >= MAX_FAILS) current.lockTime = Date.now() + LOCK_WINDOW_MS;
  failedLogins.set(key, current);
  shareFailure(key);
};
const clearAccountFailures = (key) => { shareClear(key); return failedLogins.delete(key); };
/** Call (await) before isAccountLocked() so a lock set on another instance applies here too. */
const syncAccountLock = (key) => (redis.isConfigured() ? syncFromShared(key).catch(() => {}) : Promise.resolve());

// Only a wrong password counts towards the lock: a 401 without a code, or INVALID_CREDENTIALS (Auto Driver / PG
// Partner). A missing field (400), an unknown number (ACCOUNT_NOT_FOUND) or an expired code never tested a password.
const isPasswordFailure = (statusCode, body) => {
  if (statusCode !== 401) return false;
  let parsed = body;
  if (typeof body === 'string') { try { parsed = JSON.parse(body); } catch { parsed = null; } }
  const code = parsed && typeof parsed === 'object' ? parsed.code : null;
  return !code || code === 'INVALID_CREDENTIALS';
};

const accountLockout = (req, res, next) => {
  // B1: merge the shared count first (only when REDIS_URL is set; bounded by the command timeout).
  if (redis.isConfigured() && redis.isReady()) {
    const key = lockoutKey(req);
    return syncFromShared(key).catch(() => {}).then(() => accountLockoutLocal(req, res, next));
  }
  return accountLockoutLocal(req, res, next);
};

const accountLockoutLocal = (req, res, next) => {
  const key = lockoutKey(req);
  const record = failedLogins.get(key);

  if (record && record.count >= 5) {
    if (Date.now() < record.lockTime) {
      return res.status(429).json({
        message: 'Account locked due to too many failed login attempts. Try again in 15 minutes.'
      });
    } else {
      failedLogins.delete(key);
    }
  }

  // Intercept the response to track success/failure
  const originalSend = res.send;
  res.send = function (body) {
    const statusCode = res.statusCode;
    if (statusCode >= 200 && statusCode < 300) {
      failedLogins.delete(key);
      shareClear(key);
    } else if (isPasswordFailure(statusCode, body)) {
      const current = failedLogins.get(key) || { count: 0, lockTime: 0 };
      current.count += 1;
      current.lastAt = Date.now();
      if (current.count >= 5) {
        current.lockTime = Date.now() + 15 * 60 * 1000; // 15 mins lock
      }
      failedLogins.set(key, current);
      shareFailure(key);
    }
    return originalSend.apply(this, arguments);
  };

  next();
};

module.exports = { accountLockout, isAccountLocked, recordAccountFailure, clearAccountFailures, syncAccountLock, lockoutKey, isPasswordFailure };
