// Rider heartbeat (6 Nov 2026, PF-01): DeliveryPartner.lastSeenAt = the last time the rider's app showed a sign of
// life (a signed-in API call, a socket connect, a GPS ping over the socket or HTTP). Written at most once per
// SEEN_EVERY_MS per rider per process, fire-and-forget, never fails the request.
//
// Why not liveLocation.ts alone: the rider app's GPS task only reports a fix after the phone moves 15 m (active mode),
// so a rider standing at a counter for 20 minutes has an old fix while the app is open and polling. The stalled-claim
// job (controllers/orderController.releaseStalledRiderClaims) treats a rider as gone only when BOTH are old.
const { getDeliveryPartnerModel } = require('../models/DeliveryPartner');

const SEEN_EVERY_MS = 60 * 1000;
const lastWrite = new Map(); // riderId -> ms of the last write from this process

const noteRiderSeen = (riderId, now = Date.now()) => {
  try {
    const id = riderId ? String(riderId) : '';
    if (!id) return;
    if (now - (lastWrite.get(id) || 0) < SEEN_EVERY_MS) return;
    lastWrite.set(id, now);
    if (lastWrite.size > 5000) lastWrite.clear();
    const DP = getDeliveryPartnerModel();
    if (!DP) return;
    DP.update({ lastSeenAt: new Date(now) }, { where: { id }, silent: true, hooks: false })
      .catch((err) => console.warn('[RIDER_SEEN_WARN]', err.message));
  } catch (err) {
    console.warn('[RIDER_SEEN_WARN]', err.message);
  }
};

/**
 * Milliseconds since the rider last showed any sign of life: the newer of lastSeenAt and the GPS fix time
 * (liveLocation.ts). Infinity when neither is known.
 */
const riderQuietMs = (rider, now = Date.now()) => {
  if (!rider) return Infinity;
  const seen = rider.lastSeenAt ? new Date(rider.lastSeenAt).getTime() : NaN;
  const loc = rider.liveLocation;
  const fix = loc && loc.ts ? Date.parse(loc.ts) : NaN;
  const last = Math.max(Number.isFinite(seen) ? seen : -Infinity, Number.isFinite(fix) ? fix : -Infinity);
  return Number.isFinite(last) ? Math.max(0, now - last) : Infinity;
};

const _reset = () => lastWrite.clear();

module.exports = { noteRiderSeen, riderQuietMs, SEEN_EVERY_MS, _reset };
