// B1: small realtime state shared across instances through Redis (only while Redis is ready; every
// function resolves null / does nothing otherwise and the caller keeps its in-memory state, which is
// today's single-instance behaviour). Everything here is tiny and expires on its own.
//
//   Shared carts      'zenvy:cart:<room>:m'    SET of member ids          (30 min, refreshed on activity)
//                     'zenvy:cart:<room>:snap' latest basket JSON         (30 min)
//   Surge             'zenvy:surge:z:<zone>'   ZSET of order timestamps   (window + 1 min)
//                     'zenvy:surge:on:<zone>'  "1" while the zone surges   (2 windows + 1 min, refreshed)
//   Campus presence   'zenvy:cpres:i:<inst>'   SET of user ids per instance (refreshed every 60 s)
const redis = require('./redis');

// S0: shared-cart state lives 30 min after the last activity (was 6 h); snapshots are at most 32 KB.
const CART_TTL_MS = 30 * 60 * 1000;
const MAX_CART_SNAPSHOT_BYTES = 32 * 1024;

const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };
const execOk = (res) => Array.isArray(res) && res.every((r) => !r[0]);

// ── Shared carts ────────────────────────────────────────────────────────────────────────────────
const cartKeys = (room) => ({ m: `cart:${room}:m`, snap: `cart:${room}:snap` });

/** Add a member. Resolves { existed, members, snapshot|undefined } across instances, or null (not ready). */
const cartJoin = async (room, memberId) => {
  const k = cartKeys(room);
  const res = await redis.tryCmd((c) => c.multi()
    .scard(k.m)
    .sadd(k.m, String(memberId))
    .pexpire(k.m, CART_TTL_MS)
    .scard(k.m)
    .get(k.snap)
    .exec());
  if (!execOk(res)) return null;
  const snapRaw = res[4][1];
  const snap = snapRaw ? parse(snapRaw) : null;
  return {
    existed: Number(res[0][1]) > 0,
    members: Number(res[3][1]) || 0,
    snapshot: snap && Array.isArray(snap.cart) ? snap : undefined,
  };
};

/** Store the room's latest basket for late joiners on any instance. Fire-and-forget. */
const cartSaveSnapshot = (room, cart, at = Date.now()) => {
  if (!redis.isReady()) return;
  let body;
  try { body = JSON.stringify({ cart, at }); } catch { return; }
  if (body.length > MAX_CART_SNAPSHOT_BYTES) return;
  const k = cartKeys(room);
  redis.tryCmd((c) => c.multi().set(k.snap, body, 'PX', CART_TTL_MS).pexpire(k.m, CART_TTL_MS).exec());
};

/** A member left (none of their sockets is in the room any more on this instance). Fire-and-forget. */
const cartLeave = (room, memberId) => {
  if (!redis.isReady()) return;
  redis.tryCmd((c) => c.srem(cartKeys(room).m, String(memberId)));
};

// ── Surge ───────────────────────────────────────────────────────────────────────────────────────
/**
 * Record one order for `zone` and return the zone's order count in the window across all instances,
 * or null when Redis is not ready.
 */
const surgeRecord = async (zone, windowMs, now = Date.now()) => {
  const z = `surge:z:${zone}`;
  const res = await redis.tryCmd((c) => c.multi()
    .zadd(z, now, `${now}-${redis.INSTANCE_ID}-${Math.random().toString(36).slice(2, 8)}`)
    .zremrangebyscore(z, '-inf', now - windowMs)
    .zcard(z)
    .pexpire(z, windowMs + 60000)
    .exec());
  if (!execOk(res)) return null;
  return Number(res[2][1]) || 0;
};

/** Orders in the window across all instances (no write), or null. */
const surgeCount = async (zone, windowMs, now = Date.now()) => {
  const r = await redis.tryCmd((c) => c.zcount(`surge:z:${zone}`, now - windowMs, '+inf'));
  return r === null ? null : Number(r) || 0;
};

/** Claim the OFF->ON transition (one instance wins and announces it). true / false / null (not ready). */
// The flag outlives the order window (2 windows + 1 min) so the periodic check, not a silent expiry,
// ends the surge and announces surge_ended.
const surgeFlagTtl = (windowMs) => windowMs * 2 + 60000;
const surgeClaimOn = async (zone, windowMs) => {
  const r = await redis.tryCmd((c) => c.set(`surge:on:${zone}`, '1', 'PX', surgeFlagTtl(windowMs), 'NX'));
  if (r === null) {
    // Already on (NX refused) or Redis error: refresh the TTL when it exists.
    await redis.tryCmd((c) => c.pexpire(`surge:on:${zone}`, surgeFlagTtl(windowMs)));
    return redis.isReady() ? false : null;
  }
  return r === 'OK';
};

/** Claim the ON->OFF transition. true when this instance ended it, false otherwise, null when not ready. */
const surgeClaimOff = async (zone) => {
  const r = await redis.tryCmd((c) => c.del(`surge:on:${zone}`));
  return r === null ? null : Number(r) > 0;
};

/** Is the zone surging anywhere? true / false / null (not ready). */
const surgeIsOn = async (zone) => {
  const r = await redis.tryCmd((c) => c.exists(`surge:on:${zone}`));
  return r === null ? null : Number(r) > 0;
};

// ── Campus presence (/campus namespace) ──────────────────────────────────────────────────────────
// Few Redis ops (Redis Cloud free allows ~100 ops/s): ONE set per instance 'zenvy:cpres:i:<instanceId>'
// of the user ids connected there (rebuilt by a heartbeat every 60 s, expires 150 s after the last one)
// and a registry ZSET 'zenvy:cpres:instances' (instanceId -> alive-until). A lookup costs 1 + one
// SMISMEMBER per live instance, whatever the number of users.
const PRESENCE_TTL_MS = 150 * 1000;
const PRESENCE_BEAT_MS = 60 * 1000;
const INSTANCES_KEY = 'cpres:instances';
let presenceSource = null; // () => iterable of user ids online on THIS instance
let presenceTimer = null;

const instanceSet = (inst) => `cpres:i:${inst}`;

const presenceMark = (userId, online) => {
  if (!redis.isReady() || !userId) return;
  const k = instanceSet(redis.INSTANCE_ID);
  if (online) redis.tryCmd((c) => c.sadd(k, String(userId)));
  else redis.tryCmd((c) => c.srem(k, String(userId)));
};

const presenceBeat = () => {
  if (!redis.isReady() || !presenceSource) return;
  const ids = Array.from(presenceSource(), String);
  const now = Date.now();
  const k = instanceSet(redis.INSTANCE_ID);
  redis.tryCmd((c) => {
    const m = c.multi().del(k);
    for (let i = 0; i < ids.length; i += 1000) m.sadd(k, ...ids.slice(i, i + 1000));
    return m.pexpire(k, PRESENCE_TTL_MS)
      .zadd(INSTANCES_KEY, now + PRESENCE_TTL_MS, redis.INSTANCE_ID)
      .zremrangebyscore(INSTANCES_KEY, '-inf', now)
      .pexpire(INSTANCES_KEY, PRESENCE_TTL_MS * 4)
      .exec();
  });
};

/** Start the presence heartbeat for this instance's online users (source: () => iterable of ids). */
const presenceStart = (source) => {
  presenceSource = source;
  if (presenceTimer || !redis.isConfigured()) return;
  presenceTimer = setInterval(presenceBeat, PRESENCE_BEAT_MS);
  if (presenceTimer.unref) presenceTimer.unref();
  redis.onReady(() => presenceBeat());
};

/**
 * From ids that are NOT online on this instance, keep the ones not online on any other instance either.
 * Without Redis (or on error) the input is returned unchanged (= today's behaviour).
 */
const presenceFilterOffline = async (ids) => {
  if (!ids.length || !redis.isReady()) return ids;
  const insts = await redis.tryCmd((c) => c.zrangebyscore(INSTANCES_KEY, Date.now(), '+inf'));
  if (!Array.isArray(insts)) return ids;
  const others = insts.filter((i) => i !== redis.INSTANCE_ID);
  if (!others.length) return ids;
  const strIds = ids.map(String);
  const res = await redis.tryCmd((c) => {
    const m = c.multi();
    for (const inst of others) m.smismember(instanceSet(inst), ...strIds);
    return m.exec();
  });
  if (!execOk(res)) return ids;
  return ids.filter((_, i) => !res.some((r) => Array.isArray(r[1]) && Number(r[1][i]) === 1));
};

module.exports = {
  cartJoin, cartSaveSnapshot, cartLeave,
  surgeRecord, surgeCount, surgeClaimOn, surgeClaimOff, surgeIsOn,
  presenceMark, presenceStart, presenceFilterOffline,
  CART_TTL_MS,
};
