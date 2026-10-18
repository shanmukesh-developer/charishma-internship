// S0: shared-cart ("ZN-XXXX") room limits. Guests may use shared carts, so every bound here protects
// memory and stops strangers from finding other people's live baskets by guessing codes.
//
//   - codes: new app builds create 10-character codes; 4-8 character codes from older builds are still
//     accepted (CODE_RE), but joins are rate limited per socket and per IP (JOIN_MAX per JOIN_WINDOW_MS).
//   - per socket: at most MAX_ROOMS_PER_SOCKET cart rooms; a token bucket (RATE_PER_SEC, BURST) on
//     joinRoom(cart) and cart_change.
//   - payload: items are whitelisted + bounded (sanitizeCart), at most MAX_ITEMS, snapshot <= MAX_SNAPSHOT_BYTES.
//   - memory: at most MAX_ROOMS rooms are tracked (oldest idle room evicted first), snapshots expire after
//     SNAPSHOT_TTL_MS, rooms nobody is in and without a live snapshot (e.g. never snapshotted) are
//     forgotten by sweep().
// With REDIS_URL the per-IP join budget is also counted across instances (utils/sharedRateLimit.gate).
const CODE_RE = /^ZN-[A-Z0-9]{4,12}$/;
const MAX_ROOMS_PER_SOCKET = 3;
const RATE_PER_SEC = 5;
const BURST = 10;
const JOIN_MAX = 20;
const JOIN_WINDOW_MS = 10 * 60 * 1000;
const MAX_ITEMS = 100;
const MAX_SNAPSHOT_BYTES = 32 * 1024;
const MAX_ROOMS = 5000;
const SNAPSHOT_TTL_MS = 30 * 60 * 1000;
const MAX_QTY = 50;

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : typeof v === 'number' && Number.isFinite(v) ? String(v).slice(0, max) : null);
const num = (v, min, max) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};
const IMAGE_RE = /^(https:\/\/|\/api\/campus\/media\/)[^\s"'<>]{1,2040}$/i;

/** One cart line, whitelisted. Returns null when the line is unusable (no id / name). */
const sanitizeItem = (i) => {
  if (!i || typeof i !== 'object' || Array.isArray(i)) return null;
  const id = str(i.id, 64);
  const name = str(i.name, 80);
  if (!id || !name) return null;
  const qty = Math.round(num(i.quantity !== undefined ? i.quantity : i.qty, 1, MAX_QTY) || 1);
  const out = { id, name, quantity: qty, qty };
  const cartKey = str(i.cartKey, 96); if (cartKey) out.cartKey = cartKey;
  const restaurantId = str(i.restaurantId, 64); if (restaurantId) out.restaurantId = restaurantId;
  const restaurantName = str(i.restaurantName, 80); if (restaurantName) out.restaurantName = restaurantName;
  const price = num(i.price, 0, 100000); if (price !== null) out.price = price;
  const basePrice = num(i.basePrice, 0, 100000); if (basePrice !== null) out.basePrice = basePrice;
  for (const k of ['image', 'imageUrl']) { const v = str(i[k], 2048); if (v && IMAGE_RE.test(v)) out[k] = v; }
  for (const k of ['isAddOn', 'isStall', 'isCake']) if (i[k] === true) out[k] = true;
  const customName = str(i.customName, 80); if (customName) out.customName = customName;
  const addedBy = str(i.addedBy, 60); if (addedBy) out.addedBy = addedBy;
  const addedById = str(i.addedById, 64); if (addedById) out.addedById = addedById;
  if (i.customizations && typeof i.customizations === 'object' && !Array.isArray(i.customizations)) {
    const c = {};
    for (const [k, v] of Object.entries(i.customizations).slice(0, 12)) {
      if (!/^[A-Za-z]{1,24}$/.test(k)) continue;
      if (typeof v === 'string') c[k] = v.slice(0, 40);
      else if (typeof v === 'number' && Number.isFinite(v)) c[k] = v;
      else if (typeof v === 'boolean') c[k] = v;
      else if (Array.isArray(v)) c[k] = v.filter((x) => typeof x === 'string').slice(0, 12).map((x) => x.slice(0, 40));
    }
    if (Object.keys(c).length) out.customizations = c;
  }
  return out;
};

/** Whitelisted cart (array) or null when the payload is not a cart / is too big. */
const sanitizeCart = (cart) => {
  if (!Array.isArray(cart)) return null;
  const out = [];
  for (const i of cart.slice(0, MAX_ITEMS)) {
    const clean = sanitizeItem(i);
    if (clean) out.push(clean);
  }
  let size = 0;
  try { size = Buffer.byteLength(JSON.stringify(out)); } catch { return null; }
  if (size > MAX_SNAPSHOT_BYTES) return null;
  return out;
};

/** Token bucket stored on the socket. True when one token was taken. */
const takeToken = (socket, now = Date.now()) => {
  const b = socket.__cartBucket || (socket.__cartBucket = { tokens: BURST, at: now });
  b.tokens = Math.min(BURST, b.tokens + ((now - b.at) / 1000) * RATE_PER_SEC);
  b.at = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
};

// Sliding-window join counters (per socket id and per IP).
const joins = new Map(); // key -> number[]
const hit = (key, now) => {
  const list = (joins.get(key) || []).filter((t) => now - t < JOIN_WINDOW_MS);
  if (list.length >= JOIN_MAX) { joins.set(key, list); return false; }
  list.push(now);
  joins.set(key, list);
  if (joins.size > 50000) for (const [k, l] of joins) if (!l.length || now - l[l.length - 1] >= JOIN_WINDOW_MS) joins.delete(k);
  return true;
};

/** Client address of a socket: the hop added by our proxy (rightmost X-Forwarded-For), else the peer. */
const socketIp = (socket) => {
  const h = (socket && socket.handshake) || {};
  const xff = String((h.headers && h.headers['x-forwarded-for']) || '').split(',').map((s) => s.trim()).filter(Boolean);
  return (xff.length ? xff[xff.length - 1] : h.address) || 'unknown';
};

/** May this socket join one more cart room now? */
const joinAllowed = (socket, now = Date.now()) => {
  const ip = socketIp(socket);
  if (!hit(`s:${socket.id}`, now)) return false;
  if (!hit(`ip:${ip}`, now)) return false;
  const shared = require('./sharedRateLimit').gate('cartjoin', ip, JOIN_MAX * 5, JOIN_WINDOW_MS, now);
  return shared === null;
};

const resetJoins = () => joins.clear();

/**
 * Room registry: members (Set) + snapshot ({ cart, at }) per room, with an LRU cap. `liveSize(room)`
 * tells how many sockets of this instance are in the room (rooms with live sockets are never evicted).
 */
const createRegistry = ({ liveSize = () => 0, maxRooms = MAX_ROOMS, ttlMs = SNAPSHOT_TTL_MS } = {}) => {
  const members = new Map();
  const snapshots = new Map();
  const touch = (room) => { const m = members.get(room); if (m) { members.delete(room); members.set(room, m); } };
  return {
    members,
    snapshots,
    /** Registers the room (evicting the oldest idle one when full). False when full of live rooms. */
    open(room) {
      if (members.has(room)) { touch(room); return true; }
      if (members.size >= maxRooms) {
        let evicted = false;
        for (const r of members.keys()) {
          if (liveSize(r) > 0) continue;
          members.delete(r); snapshots.delete(r); evicted = true;
          break;
        }
        if (!evicted) return false;
      }
      members.set(room, new Set());
      return true;
    },
    snapshot(room, now = Date.now()) {
      const s = snapshots.get(room);
      if (!s) return null;
      if (now - s.at > ttlMs) { snapshots.delete(room); return null; }
      return s;
    },
    save(room, cart, at = Date.now()) { snapshots.set(room, { cart, at }); touch(room); },
    /** Forgets expired snapshots and rooms nobody is in (with or without a snapshot). */
    sweep(now = Date.now()) {
      for (const [r, s] of snapshots) if (now - s.at > ttlMs) snapshots.delete(r);
      // A room with a fresh snapshot stays (a roommate may still join it within the TTL); the rest go.
      for (const r of members.keys()) {
        if (liveSize(r) > 0 || snapshots.has(r)) continue;
        members.delete(r);
      }
      for (const r of snapshots.keys()) if (!members.has(r)) snapshots.delete(r);
    },
  };
};

module.exports = {
  CODE_RE, MAX_ROOMS_PER_SOCKET, RATE_PER_SEC, BURST, JOIN_MAX, JOIN_WINDOW_MS, MAX_ITEMS, MAX_SNAPSHOT_BYTES, MAX_ROOMS, SNAPSHOT_TTL_MS, MAX_QTY,
  sanitizeCart, sanitizeItem, takeToken, joinAllowed, socketIp, resetJoins, createRegistry,
};
