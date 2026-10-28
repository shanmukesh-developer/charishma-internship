// Rider jobs that are not Orders: shopping lists (MegaBasket, rider shops and delivers) and service pickups
// (ServiceBooking: laundry / tailoring / repairs, rider collects from the student's room and brings it back).
// Same reach as a delivery order: every on-duty approved rider hears the live pool event
// (realtime.riderJob -> 'rider_job' in RIDERS_ONLINE_ROOM) and the best-placed riders get a push on the rider
// app's order channel. The rider who holds a job is told about changes to it (customer approved the bill,
// cancelled, admin moved it) on their own room + push.
//
// Delivery slots (utils/deliverySlots) apply to shopping lists only: a slot list is announced from
// DISPATCH_WINDOW_MIN before its slot start (megaBasketController.releaseDueSlotBaskets). Service pickups are
// never slot-gated.
const realtime = require('./realtime');

const JOB_KINDS = ['basket', 'service'];
// Push data.type the rider app reacts to (delivery-boy-app src/state/JobsStore.tsx).
const NEW_JOB_PUSH = 'NEW_JOB';
const JOB_UPDATE_PUSH = 'JOB_UPDATE';

const tokensOf = (row) => (Array.isArray(row && row.fcmTokens) ? row.fcmTokens : [])
  .map((t) => (typeof t === 'string' ? t : t && t.token))
  .filter(Boolean);

// New job in the pool: live event to every on-duty rider + push to the `limit` freshest riders. Never throws.
const announceJob = async ({ kind, id, title, body, limit = 10 }) => {
  if (!JOB_KINDS.includes(kind) || !id) return 0;
  realtime.riderJob(kind, id, 'new');
  try {
    const { rankOnlineRiders, RIDER_PUSH_ANDROID } = require('./riderDispatch');
    let ranked = await rankOnlineRiders(null);
    // Riders already at the 3-job limit cannot claim it: they no longer take push slots from riders who can.
    try {
      const full = await require('./riderLoad').fullRiderIds(ranked.map(({ rider }) => rider.id));
      if (full.size) ranked = ranked.filter(({ rider }) => !full.has(String(rider.id)));
    } catch (countErr) {
      console.warn('[RIDER_JOB_COUNT_WARN]', countErr.message);
    }
    const tokens = ranked.slice(0, limit).flatMap(({ rider }) => tokensOf(rider));
    if (!tokens.length) return 0;
    await require('./push').sendPushToTokens(tokens, title, body, { type: NEW_JOB_PUSH, kind, jobId: String(id) }, {
      persist: false,
      android: RIDER_PUSH_ANDROID,
    });
    return tokens.length;
  } catch (err) {
    console.warn('[RIDER_JOB_PUSH_WARN]', kind, err.message);
    return 0;
  }
};

// The job left the pool (claimed, cancelled, expired). Never throws.
const jobGone = (kind, id) => realtime.riderJob(kind, id, 'gone');

// The rider holding a job: live event always, push when `title` is given. Never throws.
const tellJobRider = async ({ kind, id, riderId, title = null, body = '' }) => {
  if (!riderId || !id) return;
  realtime.riderJob(kind, id, 'updated', riderId);
  if (!title) return;
  try {
    const rider = await require('../models/DeliveryPartner').getDeliveryPartnerModel().findByPk(riderId, { attributes: ['id', 'fcmTokens'] });
    const tokens = tokensOf(rider);
    if (!tokens.length) return;
    const { RIDER_PUSH_ANDROID } = require('./riderDispatch');
    await require('./push').sendPushToTokens(tokens, title, body, { type: JOB_UPDATE_PUSH, kind, jobId: String(id) }, {
      persist: false,
      android: RIDER_PUSH_ANDROID,
    });
  } catch (err) {
    console.warn('[RIDER_JOB_UPDATE_PUSH_WARN]', kind, err.message);
  }
};

// Customer push + in-app notification for a job (type MEGA_BASKET / SERVICE_STATUS). Never throws.
const tellCustomer = async (userId, title, body, data) => {
  if (!userId) return;
  try {
    const user = await require('../models/User').getUserModel().findByPk(userId, { attributes: ['id', 'fcmTokens'] });
    if (!user) return;
    await require('./push').sendPushToTokens(user.fcmTokens, title, body, data, { recipients: [user.id] });
  } catch (err) {
    console.warn('[JOB_CUSTOMER_PUSH_WARN]', err.message);
  }
};

module.exports = { JOB_KINDS, NEW_JOB_PUSH, JOB_UPDATE_PUSH, announceJob, jobGone, tellJobRider, tellCustomer };
