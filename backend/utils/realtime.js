// Realtime sync layer: tells connected clients that something changed so they can refetch,
// without anyone pulling to refresh.
//
// • publish(type, action, id, extra?)  → `data:changed` to EVERY socket on the default namespace
//   (customers, guests, riders, stores, admins). Payload is IDs only:
//   { type, action, id, storeId?, scope?, at }. Never put names, prices, phones, wallets etc. here.
// • notifyAdmin(type, action, id, extra?) → `admin:changed` to the 'admin-room' only, same shape.
//
// Bursts are debounced: events are collected for DEBOUNCE_MS and sent once, de-duplicated by
// type/action/id. If a single flush holds more than BULK_THRESHOLD events of one type (bulk import,
// seeding), they collapse into ONE event { type, action: 'updated', id: null, bulk: true, count }.
//
// Rider dispatch (not debounced, ids only):
// • setRiderOnline(riderId, online) → every socket of `rider_<id>` joins / leaves RIDERS_ONLINE_ROOM.
//   Only call with online=true for an authenticated rider whose DeliveryPartner row is isOnline && isApproved.
// • deliveryRequest(orderId)     → `delivery_request { orderId }` to RIDERS_ONLINE_ROOM (order became claimable).
// • deliveryRequestGone(orderId) → `delivery_request_gone { orderId }` (claimed / cancelled / left the pool).
//
// Store/product events also clear the in-memory public restaurant listing cache immediately (not
// debounced) so the refetch a client makes on receipt already sees fresh data. config / campus /
// vault ('coupon') events clear their utils/responseCache groups the same way.

const ADMIN_ROOM = 'admin-room';
const PUBLIC_EVENT = 'data:changed';
const ADMIN_EVENT = 'admin:changed';
const DEBOUNCE_MS = 400;
const BULK_THRESHOLD = 20;

const PUBLIC_TYPES = new Set(['store', 'product', 'config', 'announcement', 'coupon', 'pg', 'wall', 'campus',
  // Student vehicle rentals: a listing became visible / hidden (ids only).
  'rental',
  // Auto-Ride: a shared-auto trip's availability / status changed (ids only).
  'auto_trip',
  // Campus Events: an event's availability / status changed (ids only).
  'campus_event']);
const ADMIN_TYPES = new Set([...PUBLIC_TYPES, 'order', 'ticket', 'verification', 'pg_booking', 'wall_submission', 'service_booking', 'rider', 'user',
  // Zenvy Friends moderation queue (admin /moderation page)
  'friends_report', 'friends_appeal', 'friends_review',
  // Rentals admin queues (admin /rentals page)
  'rental_listing', 'rental_licence', 'rental_booking', 'rental_report', 'rental_dispute',
  // Auto-Ride admin queues (drivers, vehicles, routes, bookings, full-auto requests, incidents)
  'auto_driver', 'auto_vehicle', 'auto_route', 'auto_booking', 'auto_private_request', 'auto_incident',
  // Campus Events admin queues (review queue, organizers, registrations, refunds)
  'campus_event_admin',
  // ZCS PG Partner: owner accounts + tenant complaints (admin /pg page, Owner accounts tab)
  'pg_owner', 'pg_complaint']);
const ACTIONS = new Set(['created', 'updated', 'deleted']);
const CACHE_TYPES = new Set(['store', 'product']);

let ioRef = null;
const queues = { public: new Map(), admin: new Map() };
const timers = { public: null, admin: null };

const init = (io) => { ioRef = io || null; };

const clearListingCache = () => {
  try { require('../controllers/adminController').clearRestaurantsCache(); } catch (e) { console.error('[REALTIME_CACHE_CLEAR]', e.message); }
};

// Other public GET caches (utils/responseCache) keyed by the realtime type that changes them.
// Vault deals are published as type 'coupon' (scope 'vault').
const RESPONSE_CACHE_GROUPS = { config: ['config'], announcement: ['config'], campus: ['campus'], coupon: ['vault'] };
const clearResponseCache = (type) => {
  const groups = RESPONSE_CACHE_GROUPS[type];
  if (!groups) return;
  try { require('./responseCache').invalidate(...groups); } catch (e) { console.error('[REALTIME_CACHE_CLEAR]', e.message); }
};

// Only plain id-like strings / numbers survive; anything else becomes null.
const safeId = (v) => {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const s = String(v).trim();
  return s && s.length <= 100 && /^[A-Za-z0-9_.:-]+$/.test(s) ? s : null;
};

const buildEvent = (type, action, id, extra = {}) => {
  const evt = { type, action: ACTIONS.has(action) ? action : 'updated', id: safeId(id) };
  const storeId = safeId(extra.storeId);
  if (storeId !== null) evt.storeId = storeId;
  if (typeof extra.scope === 'string' && /^[a-z0-9_-]{1,40}$/.test(extra.scope)) evt.scope = extra.scope;
  return evt;
};

const flush = (channel) => {
  timers[channel] = null;
  const queue = queues[channel];
  if (!queue.size) return;
  const events = Array.from(queue.values());
  queue.clear();
  if (!ioRef) return;

  const at = new Date().toISOString();
  const byType = new Map();
  for (const e of events) {
    if (!byType.has(e.type)) byType.set(e.type, []);
    byType.get(e.type).push(e);
  }
  const target = channel === 'admin' ? ioRef.to(ADMIN_ROOM) : ioRef;
  const eventName = channel === 'admin' ? ADMIN_EVENT : PUBLIC_EVENT;
  try {
    for (const [type, list] of byType) {
      if (list.length > BULK_THRESHOLD) {
        const storeIds = new Set(list.map((e) => e.storeId).filter(Boolean));
        const bulk = { type, action: 'updated', id: null, bulk: true, count: list.length, at };
        if (storeIds.size === 1) bulk.storeId = [...storeIds][0];
        target.emit(eventName, bulk);
      } else {
        for (const e of list) target.emit(eventName, { ...e, at });
      }
    }
  } catch (err) {
    console.error('[REALTIME_EMIT_ERROR]', err.message);
  }
};

const enqueue = (channel, evt) => {
  const key = `${evt.type}|${evt.action}|${evt.id}|${evt.storeId || ''}|${evt.scope || ''}`;
  queues[channel].set(key, evt);
  if (!timers[channel]) {
    timers[channel] = setTimeout(() => flush(channel), DEBOUNCE_MS);
    if (typeof timers[channel].unref === 'function') timers[channel].unref();
  }
};

// Public, non-sensitive change → every socket. Never throws.
const publish = (type, action, id, extra = {}) => {
  try {
    if (!PUBLIC_TYPES.has(type)) return;
    if (CACHE_TYPES.has(type)) clearListingCache();
    else clearResponseCache(type);
    enqueue('public', buildEvent(type, action, id, extra));
  } catch (err) {
    console.error('[REALTIME_PUBLISH_ERROR]', err.message);
  }
};

// Admin-only change → 'admin-room'. Never throws.
const notifyAdmin = (type, action, id, extra = {}) => {
  try {
    if (!ADMIN_TYPES.has(type)) return;
    enqueue('admin', buildEvent(type, action, id, extra));
  } catch (err) {
    console.error('[REALTIME_ADMIN_ERROR]', err.message);
  }
};

// Event to one customer's own sockets (room `user_<id>`, joined on authenticated connect). Not debounced.
// Payloads must stay ids / statuses only. Never throws.
const toUser = (userId, event, payload = {}) => {
  try {
    const id = safeId(userId);
    if (!ioRef || id === null || typeof event !== 'string') return;
    ioRef.to(`user_${id}`).emit(event, { ...payload, at: new Date().toISOString() });
  } catch (err) {
    console.error('[REALTIME_USER_EMIT_ERROR]', err.message);
  }
};

// Event to one Zenvy Auto Driver's own sockets (room `autodriver_<id>`, joined on authenticated
// connect of an 'auto_driver' token). Not debounced. Payloads ids / statuses only. Never throws.
const toDriver = (driverId, event, payload = {}) => {
  try {
    const id = safeId(driverId);
    if (!ioRef || id === null || typeof event !== 'string') return;
    ioRef.to(`autodriver_${id}`).emit(event, { ...payload, at: new Date().toISOString() });
  } catch (err) {
    console.error('[REALTIME_DRIVER_EMIT_ERROR]', err.message);
  }
};

// C2: one event to every connected socket of the main namespace (e.g. community_post_deleted when a
// moderator hides a post). Payloads must stay ids only. Never throws.
const broadcast = (event, payload = {}) => {
  try {
    if (!ioRef || typeof event !== 'string') return;
    ioRef.emit(event, payload);
  } catch (err) {
    console.error('[REALTIME_BROADCAST_ERROR]', err.message);
  }
};

// ── Rider dispatch room ─────────────────────────────────────────────────────
const RIDERS_ONLINE_ROOM = 'riders_online';
const DELIVERY_REQUEST_EVENT = 'delivery_request';
const DELIVERY_REQUEST_GONE_EVENT = 'delivery_request_gone';
// Statuses in which an order with no rider sits in the pool (GET /delivery/orders/pending).
const CLAIMABLE_STATUSES = ['Accepted', 'Preparing', 'ReadyForPickup'];

const setRiderOnline = (riderId, online) => {
  try {
    const id = safeId(riderId);
    if (!ioRef || id === null) return;
    const sockets = ioRef.in(`rider_${id}`);
    if (online) sockets.socketsJoin(RIDERS_ONLINE_ROOM);
    else sockets.socketsLeave(RIDERS_ONLINE_ROOM);
  } catch (err) {
    console.error('[REALTIME_RIDER_ROOM_ERROR]', err.message);
  }
};

const emitToRiders = (event, orderId) => {
  try {
    const id = safeId(orderId);
    if (!ioRef || id === null) return;
    ioRef.to(RIDERS_ONLINE_ROOM).emit(event, { orderId: id });
  } catch (err) {
    console.error('[REALTIME_RIDER_EMIT_ERROR]', err.message);
  }
};
// Stall orders (Order.fulfilment = 'VENDOR') are delivered by the stall itself and must never reach
// riders: the order's fulfilment is checked before the event goes out (defence in depth for every caller).
const deliveryRequest = (orderId) => {
  const id = safeId(orderId);
  if (!ioRef || id === null) return;
  Promise.resolve()
    .then(() => {
      const { getOrderModel } = require('../models/Order');
      const Order = getOrderModel();
      return Order ? Order.findByPk(id, { attributes: ['id', 'fulfilment'] }) : null;
    })
    .then((order) => {
      if (order && order.fulfilment === 'VENDOR') return;
      emitToRiders(DELIVERY_REQUEST_EVENT, id);
    })
    .catch((err) => console.error('[REALTIME_DELIVERY_REQUEST_ERROR]', err.message));
};
const deliveryRequestGone = (orderId) => emitToRiders(DELIVERY_REQUEST_GONE_EVENT, orderId);

// A rider who released (or lost) an order must stop receiving its room traffic: live status,
// order chat and the next rider's GPS. Every socket of that rider leaves the order room.
const leaveOrderRoom = (riderId, orderId) => {
  if (!ioRef || !riderId || !orderId) return;
  try {
    ioRef.in(`rider_${riderId}`).socketsLeave(String(orderId));
  } catch (err) {
    console.warn('[REALTIME_LEAVE_ROOM_WARN]', err.message);
  }
};

// Session revocation for LIVE sockets. Socket auth checks tokenVersion only at connect, so after a
// password change / reset / admin logout an already-connected socket kept receiving the account's
// events (orders, customer details, pushes) until it dropped. Disconnects every socket of `accountId`
// (main and /campus namespaces) whose token version is not `tokenVersion`; pass null to drop all of them.
// Fire-and-forget, never throws. Sockets carrying the new token stay connected.
const disconnectRevokedSockets = (accountId, tokenVersion = null) => {
  if (!ioRef || !accountId || typeof ioRef.fetchSockets !== 'function') return Promise.resolve(0);
  const want = tokenVersion === null || tokenVersion === undefined ? null : (Number(tokenVersion) || 0);
  // The /campus namespace (chat, calls, proximity rooms) authenticates separately: its sockets
  // stayed connected after a password reset or a ban and kept sending messages.
  let pending;
  try {
    const campus = typeof ioRef.of === 'function' ? ioRef.of('/campus') : null;
    const cluster = require('./socketCluster');
    if (cluster.isClustered()) {
      // B1 (Redis adapter): ask every instance, but only for this account's personal rooms (never a
      // dump of every socket); a Redis failure falls back to this instance's sockets.
      const id = String(accountId);
      const mainRooms = [`user_${id}`, `rider_${id}`, `autodriver_${id}`, `restaurant_${id}`];
      pending = Promise.all([
        cluster.fetchSockets(ioRef.in(mainRooms)),
        campus ? cluster.fetchSockets(campus.in(`user:${id}`)).catch(() => []) : Promise.resolve([]),
      ]).then(([main, camp]) => [...main, ...camp]);
    } else {
      pending = Promise.all([
        Promise.resolve(ioRef.fetchSockets()),
        campus && typeof campus.fetchSockets === 'function' ? Promise.resolve(campus.fetchSockets()).catch(() => []) : Promise.resolve([]),
      ]).then(([main, camp]) => [...main, ...camp]);
    }
  } catch (err) { console.warn('[REALTIME_REVOKE_WARN]', err.message); return Promise.resolve(0); }
  return pending
    .then((sockets) => {
      let n = 0;
      for (const s of sockets) {
        const u = s.data && s.data.user ? s.data.user : s.user;
        if (!u || String(u.id) !== String(accountId)) continue;
        if (want !== null && (Number(u.tv) || 0) === want) continue;
        s.disconnect(true);
        n++;
      }
      return n;
    })
    .catch((err) => { console.warn('[REALTIME_REVOKE_WARN]', err.message); return 0; });
};

module.exports = {
  disconnectRevokedSockets,
  init, publish, notifyAdmin, toUser, toDriver, broadcast, PUBLIC_EVENT, ADMIN_EVENT, ADMIN_ROOM,
  setRiderOnline, deliveryRequest, deliveryRequestGone, leaveOrderRoom,
  RIDERS_ONLINE_ROOM, DELIVERY_REQUEST_EVENT, DELIVERY_REQUEST_GONE_EVENT, CLAIMABLE_STATUSES,
};
