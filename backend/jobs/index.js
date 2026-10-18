// Central registry of every scheduled / background job that writes data or sends notifications.
//
// Each job runs through utils/jobs.runExclusive: on Postgres exactly ONE process runs a given tick
// (advisory lock), even while Render briefly runs the old and new process side by side during a deploy
// or when we run 2+ instances; on SQLite (local / tests) an in-process guard only. The schedules below
// are exactly the ones the jobs had before they moved here (same intervals, first-run delays, cron
// expressions and time zones: only the wall-clock jobs use Asia/Kolkata; the hourly / 5-minute ones
// keep the server clock, as before).
//
// Started once from server.js after the database is ready (startJobs). Nothing here runs on require.
// PROCESS_ROLE (utils/processRole): 'all' and 'worker' run these jobs, 'web' does not. Per-process
// housekeeping (in-memory map sweeps, the rider presence sweep, the Spaces room sweep) is NOT here
// as an exclusive job: it is about this process's own memory / sockets and runs on every process
// that has them.
//
// Tests / tools: runJob(name) runs one job now (through runExclusive), listJobs() lists them.
const cron = require('node-cron');
const { runExclusive, waitForIdle } = require('../utils/jobs');
const { getProcessRole, runsJobs, servesApi } = require('../utils/processRole');

const SEC = 1000;
const MIN = 60 * SEC;
const IST = 'Asia/Kolkata';

let ctx = { io: null, isDbReady: () => true };
const handles = []; // timers / cron tasks started by startJobs (for stopJobs)
let stopping = false; // set by stopJobs: scheduled ticks that still fire start no new run

// ── Job bodies (moved verbatim from server.js where they were inline) ────────────────────────────

// Hourly (+ once at boot): delete expired community posts, mark expired birthdays, announce birthdays.
const runExpiryCleanup = async ({ io }) => {
  const out = { postsDeleted: 0, birthdaysExpired: 0, birthdaysAnnounced: 0 };
  try {
    const { getCommunityPostModel } = require('../models/CommunityPost');
    const { getBirthdayCelebrationModel } = require('../models/BirthdayCelebration');
    const { Op: CleanupOp } = require('sequelize');

    const CommunityPost = getCommunityPostModel();
    if (CommunityPost) {
      const deleted = await CommunityPost.destroy({
        where: { expiresAt: { [CleanupOp.lt]: new Date() } }
      });
      out.postsDeleted = deleted;
      if (deleted > 0) console.log(`🗑️  [EXPIRY_CLEANUP] Deleted ${deleted} expired community post(s).`);
    }

    const BirthdayCelebration = getBirthdayCelebrationModel();
    if (BirthdayCelebration) {
      const [updated] = await BirthdayCelebration.update(
        { status: 'expired' },
        {
          where: {
            status: 'approved',
            expiresAt: { [CleanupOp.lt]: new Date() }
          }
        }
      );
      out.birthdaysExpired = updated;
      if (updated > 0) console.log(`🗑️  [EXPIRY_CLEANUP] Marked ${updated} expired birthday celebration(s) as expired.`);
    }
    // Birthdays approved ahead of time are announced on the day itself.
    out.birthdaysAnnounced = (await require('../routes/birthdayRoutes').announceDueBirthdays(io)) || 0;
  } catch (e) { console.warn('[EXPIRY_CLEANUP] Error:', e.message); }
  return out;
};

// Orders the store never accepted: cancel + refund once, tell the customer (orders-n12).
// + C1-5: riders who claimed an order but did not pick it up within RIDER_PICKUP_TIMEOUT_MIN of it
// being ready are taken off it (back to the pool, admins told). Same single-runner tick.
const runAutoCancel = async ({ io }) => {
  const out = { orders: 0, baskets: 0, ridersReleased: 0 };
  try {
    const { autoCancelStalePendingOrders } = require('../controllers/orderController');
    out.orders = (await autoCancelStalePendingOrders(io)) || 0;
    const { expireStaleBaskets } = require('../controllers/megaBasketController');
    out.baskets = (await expireStaleBaskets(io)) || 0;
  } catch (e) {
    console.warn('[AUTO_CANCEL] Error:', e.message);
  }
  try {
    const { releaseStalledRiderClaims } = require('../controllers/orderController');
    out.ridersReleased = (await releaseStalledRiderClaims(io)) || 0;
  } catch (e) {
    console.warn('[RIDER_PICKUP_TIMEOUT] Error:', e.message);
  }
  return out;
};

// Stall orders open for hours are FLAGGED (never cancelled): admin + stall told once (utils/stallStuckJob).
const runStallStuck = async ({ io }) => {
  try {
    return { flagged: (await require('../utils/stallStuckJob').flagStuckStallOrders(io)) || 0 };
  } catch (e) {
    console.warn('[STALL_STUCK] Error:', e.message);
    return { flagged: 0 };
  }
};

// Promotions past their featuredUntil end on their own (store row + Home banner).
const runFeaturedExpiry = async () => {
  try {
    return { ended: (await require('../controllers/adminController').expireFeaturedStores()) || 0 };
  } catch (e) {
    console.warn('[FEATURED_EXPIRY] Error:', e.message);
    return { ended: 0 };
  }
};

// Restaurant out-of-stock auto-restore (outOfStockUntil passed -> available again, broadcast).
const runMenuAutoRestore = async ({ io, isDbReady }) => {
  const out = { restored: 0 };
  if (typeof isDbReady === 'function' && !isDbReady()) return out;
  try {
    const { getMenuItemModel } = require('../models/MenuItem');
    const MenuItem = getMenuItemModel();
    if (!MenuItem) return out;
    const { Op } = require('sequelize');

    const expiredItems = await MenuItem.findAll({
      where: {
        isAvailable: false,
        outOfStockUntil: {
          [Op.ne]: null,
          [Op.lte]: new Date()
        }
      }
    });

    if (expiredItems.length > 0) {
      console.log(`[AUTO-RESTORE] Restoring ${expiredItems.length} menu items...`);
      for (const item of expiredItems) {
        item.isAvailable = true;
        item.outOfStockUntil = null;
        await item.save();
        out.restored++;

        // Broadcast to clients via Socket.io
        if (io) io.emit('inventory_updated', { itemId: item.id, restaurantId: item.restaurantId, isAvailable: true });
        require('../utils/realtime').publish('product', 'updated', item.id, { storeId: item.restaurantId, scope: 'stock' });
        console.log(`[AUTO-RESTORE] Restored item: ${item.name} (${item.id})`);
      }
    }
  } catch (err) {
    console.warn('[AUTO-RESTORE_ERROR] Failed to run auto-restore:', err.message);
  }
  return out;
};

// Rentals expiry / no-show / auto-complete / reminders (modules/rentals/jobs.js).
const runRentals = async () => {
  try {
    const r = await require('../modules/rentals/jobs').runRentalJobs();
    if (r && (r.expired || r.noShow || r.autoCompleted)) console.log('[RENTALS_JOB]', JSON.stringify(r));
    return r;
  } catch (err) {
    console.warn('[RENTALS_JOB] Error:', err.message);
    return { error: err.message };
  }
};

// Auto-Ride holds / booking opens / private request expiry / reminders / no-shows / refunds
// (modules/autoRide/jobs.js). One indexed lookup and out when nothing is active (feature off).
const runAutoRide = async () => {
  try {
    const r = await require('../modules/autoRide/jobs').runAutoRideJobs();
    if (r && !r.idle && !r.skipped && Object.values(r).some((v) => typeof v === 'number' && v > 0)) console.log('[AUTORIDE_JOB]', JSON.stringify(r));
    return r;
  } catch (err) {
    console.warn('[AUTORIDE_JOB] Error:', err.message);
    return { error: err.message };
  }
};

// Campus Events expiries / waitlist / scheduled publish / completion / invitations / reminders / deadline
// notices / refund retries / answer retention (modules/campusEvents/jobs.js). A few indexed lookups and
// out when nothing is active (feature off).
const runCampusEvents = async () => {
  try {
    const r = await require('../modules/campusEvents/jobs').runCampusEventJobs();
    if (r && !r.idle && !r.skipped && Object.values(r).some((v) => typeof v === 'number' && v > 0)) console.log('[CAMPUS_EVENTS_JOB]', JSON.stringify(r));
    return r;
  } catch (err) {
    console.warn('[CAMPUS_EVENTS_JOB] Error:', err.message);
    return { error: err.message };
  }
};

const runRetention = async () => require('../cron/retentionCron').runRetention();

// Daily abandoned-cart push (10:00 IST).
const runAbandonedCart = async () => {
  console.log('[CRON] Running daily abandoned cart nudge...');
  try {
    // In-process call (the HTTP route is admin-only now)
    const { runAbandonedCartNudge } = require('../routes/featureRoutes');
    const { count } = await runAbandonedCartNudge();
    console.log(`[CRON] Abandoned cart nudge sent to ${count} users`);
    return { sent: count };
  } catch (e) {
    console.warn('[CRON] Nudge failed:', e.message);
    return { sent: 0 };
  }
};

// Expired retry-key claims / stored answers (utils/idempotency.js, IdempotencyKeys table).
const runIdempotencyCleanup = async () => {
  try {
    return await require('../utils/idempotency').cleanupExpired();
  } catch (err) {
    console.warn('[IDEMPOTENCY_CLEANUP] Error:', err.message);
    return { error: err.message };
  }
};

const runTasks = async () => require('../modules/friends/jobs/taskJobs').runOnce();
const runConnectPurge = async () => {
  try {
    return await require('../modules/friends/services/connectDeletion').runJobs();
  } catch (err) {
    console.warn('[CONNECT_JOBS_WARN]', err.message);
    return { error: err.message };
  }
};
const runSpacesDb = async () => require('../modules/friends/jobs/spaceJobs').runOnce();
const sweepSpacesRooms = () => require('../modules/friends/socket/spacesState').sweep().catch(() => {});

// Legacy base64 images -> CampusMedia short URLs (idempotent, batched): once, a minute after boot.
const runBase64Migration = async () => {
  let runBase64MediaMigration;
  try {
    ({ runBase64MediaMigration } = require('../scripts/migrate_base64_to_media'));
  } catch (migErr) {
    console.warn('⚠️ [BASE64_MIGRATION] not started:', migErr.message);
    return { error: migErr.message };
  }
  try {
    const r = await runBase64MediaMigration();
    console.log('🖼️ [BASE64_MIGRATION]', JSON.stringify(r));
    return r;
  } catch (err) {
    console.warn('⚠️ [BASE64_MIGRATION] failed:', err.message);
    return { error: err.message };
  }
};

// ── Registry ─────────────────────────────────────────────────────────────────────────────────────
// schedule:
//   { everyMs, firstMs }          setInterval(everyMs) from start + one extra run after firstMs
//                                 (firstMs 0 = run right away; no firstMs = interval only)
//   { everyMs, firstMs, chain }   first run after firstMs, THEN setInterval(everyMs) (friends jobs)
//   { cron, timezone, onceAfterMs }  node-cron expression (+ one boot run after onceAfterMs)
//   { onceAfterMs, retryLockedMs }   one run after boot (retried while another process holds the lock)
//   { custom: 'spaces' }          Spaces: 15 s tick, database pass every 4th tick (see startSpaces)
const notTest = () => process.env.NODE_ENV !== 'test';
const JOBS = [
  { name: 'community.expiryCleanup', schedule: { everyMs: 60 * MIN, firstMs: 0 }, run: runExpiryCleanup, emits: true },
  { name: 'orders.autoCancel', schedule: { everyMs: 2 * MIN, firstMs: 30 * SEC }, run: runAutoCancel, quietWhenIdle: true, emits: true },
  { name: 'orders.stallStuck', schedule: { everyMs: 15 * MIN, firstMs: 60 * SEC }, run: runStallStuck, emits: true },
  { name: 'stores.featuredExpiry', schedule: { everyMs: 10 * MIN, firstMs: 45 * SEC }, run: runFeaturedExpiry, quietWhenIdle: true },
  { name: 'menu.autoRestore', schedule: { everyMs: 30 * SEC }, run: runMenuAutoRestore, quietWhenIdle: true, emits: true },
  { name: 'rentals.lifecycle', schedule: { everyMs: 2 * MIN, firstMs: 40 * SEC }, run: runRentals, quietWhenIdle: true, emits: true },
  { name: 'autoRide.lifecycle', schedule: { everyMs: 30 * SEC, firstMs: 50 * SEC }, run: runAutoRide, quietWhenIdle: true, emits: true },
  { name: 'campusEvents.lifecycle', schedule: { everyMs: 60 * SEC, firstMs: 55 * SEC }, run: runCampusEvents, quietWhenIdle: true, emits: true },
  { name: 'wall.finalize', schedule: { cron: '*/5 * * * *' }, run: () => require('../cron/wallCron').runWallFinalizeJob(), quietWhenIdle: true },
  { name: 'wall.mediaCleanup', schedule: { cron: '0 3 * * *', timezone: IST }, run: () => require('../cron/wallCron').runWallMediaCleanupJob(), timeoutMs: 30 * MIN },
  { name: 'retention.chatPulse', schedule: { cron: '23 * * * *', onceAfterMs: 3 * MIN }, run: runRetention, timeoutMs: 30 * MIN },
  { name: 'chat.ephemeralPurge', schedule: { cron: '0 * * * *' }, run: () => require('../cron/ephemeralPurge').runEphemeralPurge() },
  { name: 'idempotency.cleanup', schedule: { everyMs: 30 * MIN, firstMs: 2 * MIN }, run: runIdempotencyCleanup, quietWhenIdle: true },
  { name: 'push.streakNudge', schedule: { cron: '0 18 * * *', timezone: IST }, run: () => require('../cron/streakNudge').runStreakNudgeJob(), timeoutMs: 30 * MIN },
  { name: 'push.abandonedCart', schedule: { cron: '0 10 * * *', timezone: IST }, run: runAbandonedCart, timeoutMs: 30 * MIN },
  {
    name: 'friends.tasks', schedule: { everyMs: 5 * MIN, firstMs: 45 * SEC, chain: true }, run: runTasks, quietWhenIdle: true, emits: true,
    enabled: () => notTest() && process.env.FRIENDS_TASK_JOBS !== 'off',
  },
  {
    name: 'friends.connectPurge', schedule: { everyMs: 60 * MIN, firstMs: 90 * SEC, chain: true }, run: runConnectPurge, quietWhenIdle: true,
    enabled: () => notTest() && process.env.CONNECT_JOBS !== 'off',
  },
  {
    name: 'friends.spaces', schedule: { custom: 'spaces' }, run: runSpacesDb, quietWhenIdle: true, emits: true,
    enabled: () => notTest() && process.env.FRIENDS_SPACE_JOBS !== 'off',
  },
  // C5: daily wallet check (ledger sum vs balance for every owner). Read-only; mismatches -> admin alert.
  { name: 'wallet.reconcile', schedule: { cron: '30 4 * * *', timezone: IST }, run: (c) => require('../utils/walletLedger').runReconcileJob(c), timeoutMs: 30 * MIN },
  // C6: daily rider cash check (ledger sum vs cash held; every delivered COD order has exactly one cash row). Read-only; problems -> admin alert.
  { name: 'riderCash.reconcile', schedule: { cron: '45 4 * * *', timezone: IST }, run: (c) => require('../utils/riderCash').runReconcileJob(c), timeoutMs: 30 * MIN },
  {
    name: 'media.base64Migration', schedule: { onceAfterMs: 60 * SEC, retryLockedMs: 10 * MIN }, run: runBase64Migration, timeoutMs: 60 * MIN,
    enabled: () => String(process.env.DISABLE_BASE64_MIGRATION || '').toLowerCase() !== 'true',
  },
];
const byName = new Map(JOBS.map((j) => [j.name, j]));

const listJobs = () => JOBS.map(({ name, schedule, timeoutMs, quietWhenIdle, emits }) => ({ name, schedule, timeoutMs, quietWhenIdle: !!quietWhenIdle, emits: !!emits }));

/** Run one registered job now, through runExclusive. Resolves to runExclusive's outcome. */
const runJob = (name, overrides = {}) => {
  const job = byName.get(name);
  if (!job) return Promise.reject(new Error(`Unknown job: ${name}`));
  const jobCtx = { ...ctx, ...overrides };
  return runExclusive(name, () => job.run(jobCtx), { timeoutMs: job.timeoutMs, quietWhenIdle: job.quietWhenIdle });
};

const unref = (t) => { if (t && t.unref) t.unref(); return t; };
const track = (h) => {
  if (stopping) { // a chained / retry timer created after stopJobs: cancel it at once
    try { if (h.interval) clearInterval(h.interval); if (h.timeout) clearTimeout(h.timeout); if (h.cron) h.cron.stop(); } catch { /* ignore */ }
    return h;
  }
  handles.push(h);
  return h;
};
const fire = (name) => {
  if (stopping) return;
  runJob(name).catch((err) => console.warn(`[JOB] ${name}: ${err.message}`));
};

const scheduleJob = (job) => {
  const s = job.schedule;
  if (s.cron) {
    const fn = () => fire(job.name);
    const task = s.timezone ? cron.schedule(s.cron, fn, { timezone: s.timezone }) : cron.schedule(s.cron, fn);
    track({ cron: task });
    if (s.onceAfterMs !== undefined) track({ timeout: unref(setTimeout(fn, s.onceAfterMs)) });
    return;
  }
  if (s.everyMs && s.chain) {
    const first = setTimeout(() => {
      fire(job.name);
      track({ interval: unref(setInterval(() => fire(job.name), s.everyMs)) });
    }, s.firstMs || 0);
    track({ timeout: unref(first) });
    return;
  }
  if (s.everyMs) {
    if (s.firstMs === 0) fire(job.name);
    else if (s.firstMs !== undefined) track({ timeout: setTimeout(() => fire(job.name), s.firstMs) });
    track({ interval: setInterval(() => fire(job.name), s.everyMs) });
    return;
  }
  if (s.onceAfterMs !== undefined) {
    const attempt = () => {
      if (stopping) return;
      runJob(job.name).then((r) => {
        if (r && r.skipped === 'locked' && s.retryLockedMs) track({ timeout: unref(setTimeout(attempt, s.retryLockedMs)) });
      }).catch((err) => console.warn(`[JOB] ${job.name}: ${err.message}`));
    };
    track({ timeout: unref(setTimeout(attempt, s.onceAfterMs)) });
  }
};

// Friends > Spaces, same timing as modules/friends/jobs/spaceJobs.start(): first database pass 30 s after
// start, then a 15 s tick; every 4th tick is the database pass (reminders, expiry, orphans, which also
// sweeps this process's rooms), the other ticks only sweep this process's in-memory rooms. The room
// sweep is per process (rooms live in this process's memory), so a process that serves sockets still
// sweeps its rooms when another process holds the database lock, and a 'web' process sweeps on every tick.
const SPACES_TICK_MS = 15 * SEC;
const SPACES_DB_EVERY_TICKS = 4;
const SPACES_FIRST_MS = 30 * SEC;
const startSpaces = (job, { jobsHere, socketsHere }) => {
  let ticks = 0;
  const dbPass = () => {
    if (stopping) return;
    if (!jobsHere) { if (socketsHere) sweepSpacesRooms(); return; }
    runJob(job.name)
      .then((r) => { if (r && !r.ran && socketsHere) sweepSpacesRooms(); })
      .catch(() => {});
  };
  const first = setTimeout(() => {
    dbPass();
    track({ interval: unref(setInterval(() => {
      if (stopping) return;
      ticks++;
      if (ticks % SPACES_DB_EVERY_TICKS === 0) dbPass();
      else if (socketsHere) sweepSpacesRooms();
    }, SPACES_TICK_MS)) });
  }, SPACES_FIRST_MS);
  track({ timeout: unref(first) });
};

let started = false;
/**
 * Schedule every job for this process's role. Call once, after the database is ready.
 * opts: { io, isDbReady, role }
 */
const startJobs = (opts = {}) => {
  if (started) return { started: false, role: getProcessRole() };
  started = true;
  stopping = false;
  const role = opts.role || getProcessRole();
  ctx = { io: opts.io || null, isDbReady: opts.isDbReady || (() => true) };
  const jobsHere = runsJobs(role);
  const socketsHere = servesApi(role);
  const names = [];
  for (const job of JOBS) {
    if (job.enabled && !job.enabled()) continue;
    try {
      if (job.schedule.custom === 'spaces') {
        if (!jobsHere && !socketsHere) continue;
        startSpaces(job, { jobsHere, socketsHere });
        names.push(jobsHere ? job.name : `${job.name}(room sweep only)`);
        continue;
      }
      if (!jobsHere) continue;
      scheduleJob(job);
      names.push(job.name);
    } catch (err) {
      console.error(`[JOBS] could not schedule ${job.name}:`, err.message);
    }
  }
  if (jobsHere) {
    console.log(`⏰ [JOBS] PROCESS_ROLE=${role}: ${names.length} jobs scheduled, single-runner per tick: ${names.join(', ')}`);
  } else {
    console.log(`⏰ [JOBS] PROCESS_ROLE=${role}: scheduled jobs are OFF in this process${names.length ? ` (per-process: ${names.join(', ')})` : ''}`);
  }
  return { started: true, role, jobs: names };
};

/**
 * Cancel every schedule started by startJobs (intervals, timeouts, cron tasks); ticks that still fire
 * afterwards start nothing. With opts.waitMs > 0 it then waits (at most waitMs) for runs already in
 * progress in this process to finish (graceful shutdown). Resolves
 * { cancelled, idle, stillRunning: [names] }. Manual runJob() calls still work (tests / tools).
 */
const stopJobs = async (opts = {}) => {
  stopping = true;
  let cancelled = 0;
  for (const h of handles.splice(0)) {
    try {
      if (h.cron) h.cron.stop();
      if (h.interval) clearInterval(h.interval);
      if (h.timeout) clearTimeout(h.timeout);
      cancelled++;
    } catch { /* already stopped */ }
  }
  started = false;
  const waitMs = Math.max(0, Number(opts.waitMs) || 0);
  const r = await waitForIdle(waitMs);
  return { cancelled, ...r };
};

module.exports = { JOBS, listJobs, runJob, startJobs, stopJobs, getContext: () => ctx };
