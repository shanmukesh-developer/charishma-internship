// Co-Ride regular rides (RideTemplates): input validation, the response shape, and the 5-minute job that
// publishes each template's ride ~150 minutes before departure (Asia/Kolkata) plus a reminder push 15
// minutes before it leaves. Registered in jobs/index.js as 'coride.templates' (one runner per tick on
// Postgres through utils/jobs.runExclusive); exactly once per (template, IST date) through the unique
// index on RideTemplateRuns (templateId, rideDate), so even two processes racing cannot post twice.
const { Op } = require('sequelize');
const { istYmd, istShift } = require('../utils/istTime');
const { isFemale, WOMEN_ONLY_HOST_MSG } = require('../utils/coRide');

const MIN = 60 * 1000;
const PUBLISH_LEAD_MIN = 150; // publish this long before departure
const MIN_LEAD_MIN = 10; // never publish a ride that leaves in less than this (or already left)
const CONFLICT_WINDOW_MIN = 60; // the host's own open ride within ±60 min blocks the publish
const REMINDER_MIN = 15;
const MAX_TEMPLATES_PER_USER = 10;
const MAX_SKIP_DATES = 60;
const SKIP_AHEAD_DAYS = 60;
const OPEN_RIDE = ['Available', 'Matched'];
const REGULAR_PATH = '/coride/regular';

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const cleanStr = (v, max) => String(v).replace(/[<>]/g, '').trim().slice(0, max);

const M = () => ({
  RideTemplate: require('../models/RideTemplate').getRideTemplateModel(),
  RideTemplateRun: require('../models/RideTemplateRun').getRideTemplateRunModel(),
  BikePool: require('../models/BikePool').getBikePoolModel(),
  PoolRequest: require('../models/PoolRequest').getPoolRequestModel(),
  User: require('../models/User').getUserModel(),
});

// ── Dates (IST) ──────────────────────────────────────────────────────────────────────────────────
const validYmd = (s) => {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const addDaysYmd = (ymd, n) => new Date(new Date(`${ymd}T00:00:00Z`).getTime() + n * 24 * 60 * MIN).toISOString().slice(0, 10);
const weekdayOf = (ymd) => new Date(`${ymd}T00:00:00Z`).getUTCDay();
const departureOf = (ymd, hhmm) => new Date(`${ymd}T${hhmm}:00+05:30`);
/** '17:30' -> '5:30 PM' */
const timeLabel = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

// ── Validation ───────────────────────────────────────────────────────────────────────────────────
const bad = (message, field) => ({ error: { status: 400, code: 'INVALID_TEMPLATE', field, message } });

const parseDays = (v) => {
  if (!Array.isArray(v) || v.length < 1 || v.length > 7) return null;
  const out = [];
  for (const x of v) {
    const n = typeof x === 'number' ? x : (typeof x === 'string' && /^\d$/.test(x.trim()) ? Number(x.trim()) : NaN);
    if (!Number.isInteger(n) || n < 0 || n > 6) return null;
    if (!out.includes(n)) out.push(n);
  }
  return out.sort((a, b) => a - b);
};
const parseVehicle = (v) => {
  const t = String(v || '').trim().toLowerCase();
  return t === 'bike' ? 'Bike' : t === 'car' ? 'Car' : null;
};
const seatsOk = (vehicleType, seats) => (vehicleType === 'Bike' ? seats === 1 : Number.isInteger(seats) && seats >= 1 && seats <= 4);

/**
 * Validates a create (partial=false) or PATCH (partial=true) body against the current template (PATCH).
 * Resolves { value } (the fields to write) or { error: { status, code, field, message } }.
 */
const validateTemplateInput = (body, { partial = false, current = null, host = null } = {}) => {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const has = (k) => b[k] !== undefined;
  const v = {};

  for (const k of ['origin', 'destination']) {
    if (!has(k)) { if (!partial) return bad(`${k === 'origin' ? 'Origin' : 'Destination'} is required.`, k); continue; }
    if (typeof b[k] !== 'string' || !b[k].trim()) return bad(`${k === 'origin' ? 'Origin' : 'Destination'} must be text.`, k);
    if (b[k].length > 120) return bad('Please keep places under 120 characters.', k);
    v[k] = cleanStr(b[k], 120);
  }
  if (has('name')) {
    if (b.name !== null && (typeof b.name !== 'string' || b.name.length > 60)) return bad('Name must be text under 60 characters.', 'name');
    v.name = b.name && cleanStr(b.name, 60) ? cleanStr(b.name, 60) : null;
  }
  if (has('days')) {
    const days = parseDays(b.days);
    if (!days) return bad('Days must be a list of weekdays 0 (Sunday) to 6 (Saturday), at least one.', 'days');
    v.days = days;
  } else if (!partial) return bad('Pick at least one day.', 'days');
  if (has('time')) {
    if (typeof b.time !== 'string' || !TIME_RE.test(b.time.trim())) return bad('Time must be HH:MM (24-hour, India time).', 'time');
    v.time = b.time.trim();
  } else if (!partial) return bad('Departure time is required (HH:MM).', 'time');

  if (has('vehicleType')) {
    const vt = parseVehicle(b.vehicleType);
    if (!vt) return bad('Vehicle must be bike or car.', 'vehicleType');
    v.vehicleType = vt;
  }
  if (has('seats')) {
    const s = typeof b.seats === 'string' && /^\d+$/.test(b.seats) ? Number(b.seats) : b.seats;
    if (!Number.isInteger(s)) return bad('Seats must be a whole number.', 'seats');
    v.seats = s;
  }
  const vehicleType = v.vehicleType || (current ? current.vehicleType : 'Bike');
  const seats = v.seats !== undefined ? v.seats : (current && vehicleType === 'Car' && current.vehicleType === 'Car' ? current.seats : 1);
  if (!seatsOk(vehicleType, seats)) {
    return bad(vehicleType === 'Bike' ? 'A bike ride has exactly 1 seat.' : 'A car ride offers 1 to 4 seats.', 'seats');
  }
  if (!partial || v.vehicleType !== undefined || v.seats !== undefined) { v.vehicleType = vehicleType; v.seats = seats; }

  if (has('estimatedFuelCost')) {
    const raw = b.estimatedFuelCost;
    const fuel = raw === null || raw === '' ? 0 : Number(raw);
    if (typeof raw === 'boolean' || !Number.isFinite(fuel) || fuel < 0 || fuel > 5000) return bad('Fuel cost must be between ₹0 and ₹5000.', 'estimatedFuelCost');
    v.estimatedFuelCost = Math.round(fuel * 100) / 100;
  }
  if (has('rideVibe')) {
    if (b.rideVibe !== null && (typeof b.rideVibe !== 'string' || b.rideVibe.length > 30)) return bad('Ride vibe must be short text.', 'rideVibe');
    v.rideVibe = b.rideVibe ? cleanStr(b.rideVibe, 30) || 'Any' : 'Any';
  }
  if (has('notes')) {
    if (b.notes !== null && (typeof b.notes !== 'string' || b.notes.length > 300)) return bad('Notes must be text under 300 characters.', 'notes');
    v.notes = b.notes ? cleanStr(b.notes, 300) || null : null;
  }
  if (has('vehicleInfo')) {
    if (b.vehicleInfo !== null && (typeof b.vehicleInfo !== 'string' || b.vehicleInfo.length > 120)) return bad('Vehicle details must be text under 120 characters.', 'vehicleInfo');
    v.vehicleInfo = b.vehicleInfo ? cleanStr(b.vehicleInfo, 120) || null : null;
  }
  for (const k of ['autoApprove', 'autoAcceptKnown', 'womenOnly', 'active']) {
    if (!has(k)) continue;
    if (typeof b[k] !== 'boolean') return bad(`${k} must be true or false.`, k);
    v[k] = b[k];
  }
  if (has('skipDates')) {
    const today = istYmd();
    if (!Array.isArray(b.skipDates) || b.skipDates.length > MAX_SKIP_DATES || b.skipDates.some((d) => !validYmd(d))) {
      return bad(`Skip dates must be a list of up to ${MAX_SKIP_DATES} dates (YYYY-MM-DD).`, 'skipDates');
    }
    v.skipDates = [...new Set(b.skipDates)].filter((d) => d >= today).sort();
  }
  if (v.womenOnly === true && !isFemale(host)) {
    return { error: { status: 403, code: 'WOMEN_ONLY_HOST', field: 'womenOnly', message: WOMEN_ONLY_HOST_MSG } };
  }
  if (!partial && !v.name) v.name = `${v.origin} → ${v.destination}`.slice(0, 60);
  if (partial && has('name') && !v.name) v.name = `${v.origin || current.origin} → ${v.destination || current.destination}`.slice(0, 60);
  return { value: v };
};

const validateSkipDate = (date, now = new Date()) => {
  if (!validYmd(date)) return 'Date must be YYYY-MM-DD.';
  const today = istYmd(now);
  if (date < today) return 'That date has already passed.';
  if (date > addDaysYmd(today, SKIP_AHEAD_DAYS)) return `You can skip up to ${SKIP_AHEAD_DAYS} days ahead.`;
  return null;
};

// ── Response shape ───────────────────────────────────────────────────────────────────────────────
/** Next departure (Date) of a template that is not skipped and still ahead, within 14 days; null if none. */
const nextDepartureOf = (t, now = new Date()) => {
  if (!t.active) return null;
  const days = Array.isArray(t.days) ? t.days : [];
  const skips = new Set(Array.isArray(t.skipDates) ? t.skipDates : []);
  const today = istYmd(now);
  for (let i = 0; i < 15; i++) {
    const ymd = addDaysYmd(today, i);
    if (!days.includes(weekdayOf(ymd)) || skips.has(ymd)) continue;
    const dep = departureOf(ymd, t.time);
    if (dep.getTime() > now.getTime()) return dep;
  }
  return null;
};

const serializeTemplate = (t, { runs = [], now = new Date() } = {}) => {
  const j = typeof t.toJSON === 'function' ? t.toJSON() : { ...t };
  const next = nextDepartureOf(t, now);
  const upcoming = runs
    .filter((r) => String(r.templateId) === String(j.id) && new Date(r.departureAt).getTime() > now.getTime() - 60 * MIN)
    .sort((a, b) => new Date(a.departureAt) - new Date(b.departureAt))[0];
  return {
    id: j.id,
    name: j.name,
    origin: j.origin,
    destination: j.destination,
    days: j.days,
    time: j.time,
    vehicleType: j.vehicleType,
    seats: j.seats,
    estimatedFuelCost: j.estimatedFuelCost,
    rideVibe: j.rideVibe,
    notes: j.notes,
    vehicleInfo: j.vehicleInfo,
    autoApprove: !!j.autoApprove,
    autoAcceptKnown: !!j.autoAcceptKnown,
    womenOnly: !!j.womenOnly,
    active: !!j.active,
    skipDates: j.skipDates,
    lastPublishedDate: j.lastPublishedDate || null,
    nextDepartureAt: next ? next.toISOString() : null,
    upcomingRide: upcoming ? {
      poolId: upcoming.poolId, rideDate: upcoming.rideDate, departureAt: new Date(upcoming.departureAt).toISOString(),
      status: upcoming.pool ? upcoming.pool.status : null,
    } : null,
    createdAt: j.createdAt,
    updatedAt: j.updatedAt,
  };
};

/** Recent / upcoming publish rows (with the ride's status) for these templates, for serializeTemplate. */
const runsFor = async (templateIds, now = new Date()) => {
  const ids = templateIds.filter(Boolean);
  if (!ids.length) return [];
  const { RideTemplateRun, BikePool } = M();
  const runs = await RideTemplateRun.findAll({
    where: { templateId: { [Op.in]: ids }, departureAt: { [Op.gt]: new Date(now.getTime() - 60 * MIN) }, poolId: { [Op.ne]: null } },
    order: [['departureAt', 'ASC']],
    limit: 200,
  });
  const pools = runs.length ? await BikePool.findAll({ where: { id: { [Op.in]: runs.map((r) => r.poolId) } }, attributes: ['id', 'status'] }) : [];
  const byId = new Map(pools.map((p) => [String(p.id), p]));
  return runs.map((r) => ({ ...r.toJSON(), pool: byId.get(String(r.poolId)) || null }));
};

// ── Pushes ───────────────────────────────────────────────────────────────────────────────────────
// Saved in the in-app list even without a device token; never throws.
const pushUsers = async (userIds, title, body, data) => {
  try {
    const ids = [...new Set((userIds || []).filter(Boolean).map(String))];
    if (!ids.length) return;
    const { User } = M();
    const rows = await User.findAll({ where: { id: { [Op.in]: ids } }, attributes: ['id', 'fcmTokens'] });
    const tokens = rows.flatMap((u) => (Array.isArray(u.fcmTokens) ? u.fcmTokens : []));
    await require('../utils/push').sendPushToTokens(tokens, title, body, data, { recipients: ids });
  } catch (err) {
    console.warn('[CORIDE_TEMPLATE_PUSH_WARN]', err.message);
  }
};

/**
 * Host cancels one published ride (skip today): ride Cancelled, open requests closed, passengers told.
 * Conditional, so a double tap / a racing complete cancels at most once. Resolves the ride id or null.
 */
const cancelPublishedRide = async (poolId, hostId, reason = 'The host skipped this regular ride today.') => {
  const { BikePool, PoolRequest } = M();
  if (!poolId) return null;
  const pool = await BikePool.findByPk(poolId);
  if (!pool || String(pool.creatorId) !== String(hostId) || !OPEN_RIDE.includes(pool.status)) return null;
  const [closed] = await BikePool.update({ status: 'Cancelled' }, { where: { id: pool.id, status: { [Op.in]: OPEN_RIDE } } });
  if (!closed) return null;
  const open = await PoolRequest.findAll({ where: { poolId: pool.id, status: { [Op.in]: ['Pending', 'Approved'] } }, attributes: ['id', 'passengerId'] });
  await PoolRequest.update({ status: 'Cancelled' }, { where: { poolId: pool.id, status: { [Op.in]: ['Pending', 'Approved'] } } });
  if (open.length) {
    await pushUsers(open.map((r) => r.passengerId), 'Ride cancelled', `Your ride to ${pool.destination} was cancelled. ${reason}`, {
      type: 'CORIDE_RIDE_CANCELLED', screen: 'coride', poolId: String(pool.id),
    });
  }
  return String(pool.id);
};

// ── Job ──────────────────────────────────────────────────────────────────────────────────────────
const isUnique = (err) => err && (err.name === 'SequelizeUniqueConstraintError' || /unique/i.test(String(err.message || '')));

/** Publishes every due template ride. Resolves counts. opts.now overrides the clock (tests). */
const publishDueTemplates = async ({ now = new Date() } = {}) => {
  const { RideTemplate, RideTemplateRun, BikePool, User } = M();
  const out = { checked: 0, published: 0, duplicate: 0, conflict: 0, past: 0, skipped: 0, blocked: 0 };
  if (!RideTemplate || !RideTemplateRun || !BikePool) return out;
  const nowMs = now.getTime();
  const today = istYmd(now);
  // Today and tomorrow (IST): a 00:30 ride is published at 22:00 the evening before.
  const dates = [today, addDaysYmd(today, 1)];
  let lastId = null;
  for (;;) {
    const batch = await RideTemplate.findAll({
      where: { active: true, ...(lastId ? { id: { [Op.gt]: lastId } } : {}) },
      order: [['id', 'ASC']],
      limit: 500,
    });
    if (!batch.length) break;
    lastId = batch[batch.length - 1].id;
    for (const t of batch) {
      out.checked++;
      const days = Array.isArray(t.days) ? t.days : [];
      const skips = new Set(Array.isArray(t.skipDates) ? t.skipDates : []);
      if (!TIME_RE.test(String(t.time || ''))) continue;
      for (const ymd of dates) {
        if (!days.includes(weekdayOf(ymd))) continue;
        const dep = departureOf(ymd, t.time);
        const depMs = dep.getTime();
        if (nowMs < depMs - PUBLISH_LEAD_MIN * MIN) continue; // not yet
        if (skips.has(ymd)) { out.skipped++; continue; }
        if (depMs - nowMs < MIN_LEAD_MIN * MIN) { out.past++; continue; } // left already / too late to be useful
        if (await RideTemplateRun.count({ where: { templateId: t.id, rideDate: ymd } })) { out.duplicate++; continue; }
        const conflict = await BikePool.count({
          where: {
            creatorId: t.creatorId,
            status: { [Op.in]: OPEN_RIDE },
            departureTime: { [Op.between]: [new Date(depMs - CONFLICT_WINDOW_MIN * MIN), new Date(depMs + CONFLICT_WINDOW_MIN * MIN)] },
          },
        });
        if (conflict) { out.conflict++; continue; }
        const host = await User.findByPk(t.creatorId, { attributes: ['id', 'gender', 'genderPreference', 'isActive'] });
        if (!host || host.isActive === false) { out.blocked++; continue; }
        if (t.womenOnly && !isFemale(host)) { out.blocked++; continue; }

        let pool;
        try {
          pool = await BikePool.sequelize.transaction(async (transaction) => {
            const run = await RideTemplateRun.create({ templateId: t.id, creatorId: t.creatorId, rideDate: ymd, departureAt: dep }, { transaction });
            const p = await BikePool.create({
              creatorId: t.creatorId,
              creatorRole: 'rider',
              origin: t.origin,
              destination: t.destination,
              departureTime: dep,
              estimatedFuelCost: Number(t.estimatedFuelCost) || 0,
              splitAmount: 0,
              vehicleType: t.vehicleType || 'Bike',
              availableSeats: t.seats || 1,
              autoApprove: !!t.autoApprove,
              autoAcceptKnown: !!t.autoAcceptKnown,
              womenOnly: !!t.womenOnly,
              templateId: t.id,
              isRecurring: true,
              recurringDays: days.map(String),
              stopovers: [],
              rideVibe: t.rideVibe || 'Any',
              vehicleInfo: t.vehicleInfo || null,
              genderPreference: host.genderPreference || 'Any',
              notes: t.notes || null,
              status: 'Available',
              paymentStatus: 'Unpaid',
            }, { transaction });
            await RideTemplateRun.update({ poolId: p.id }, { where: { id: run.id }, transaction });
            await RideTemplate.update({ lastPublishedDate: ymd }, { where: { id: t.id }, transaction });
            return p;
          });
        } catch (err) {
          if (isUnique(err)) { out.duplicate++; continue; }
          console.warn('[CORIDE_TEMPLATE_PUBLISH_WARN]', t.id, err.message);
          continue;
        }
        out.published++;
        const seats = pool.availableSeats;
        await pushUsers([t.creatorId], `Your ${timeLabel(t.time)} ride to ${t.destination} is live`,
          `${seats} seat${seats === 1 ? '' : 's'} · Tap to skip today`, {
            type: 'CORIDE_TEMPLATE_LIVE', screen: 'coride_regular', path: REGULAR_PATH, url: REGULAR_PATH,
            templateId: String(t.id), poolId: String(pool.id), date: ymd,
          });
      }
    }
    if (batch.length < 500) break;
  }
  return out;
};

/** 15-minutes-before reminders for published template rides (host + approved riders), once each. */
const sendDueReminders = async ({ now = new Date() } = {}) => {
  const { RideTemplateRun, BikePool, PoolRequest, User } = M();
  const out = { reminded: 0 };
  if (!RideTemplateRun) return out;
  const due = await RideTemplateRun.findAll({
    where: {
      reminderSentAt: null,
      poolId: { [Op.ne]: null },
      departureAt: { [Op.gt]: now, [Op.lte]: new Date(now.getTime() + REMINDER_MIN * MIN) },
    },
    limit: 500,
  });
  for (const run of due) {
    const [claimed] = await RideTemplateRun.update({ reminderSentAt: now }, { where: { id: run.id, reminderSentAt: null } });
    if (!claimed) continue;
    const pool = await BikePool.findByPk(run.poolId);
    if (!pool || !OPEN_RIDE.includes(pool.status)) continue;
    const when = timeLabel(istShift(pool.departureTime).toISOString().slice(11, 16));
    const approved = await PoolRequest.findAll({ where: { poolId: pool.id, status: 'Approved' }, attributes: ['passengerId'] });
    const data = { type: 'CORIDE_RIDE_REMINDER', screen: 'coride_regular', path: REGULAR_PATH, url: REGULAR_PATH, poolId: String(pool.id), templateId: String(run.templateId) };
    await pushUsers([pool.creatorId], `Your ${when} ride to ${pool.destination} leaves in 15 min`,
      approved.length ? `${approved.length} rider${approved.length === 1 ? '' : 's'} joined. Head to ${pool.origin}.` : `No riders yet. Head to ${pool.origin}.`, data);
    if (approved.length) {
      const host = await User.findByPk(pool.creatorId, { attributes: ['name'] });
      const hostName = host && host.name ? String(host.name).split(' ')[0] : 'your host';
      await pushUsers(approved.map((r) => r.passengerId), `Your ride to ${pool.destination} leaves at ${when}`,
        `Meet ${hostName} at ${pool.origin}.`, { type: 'CORIDE_RIDE_REMINDER', screen: 'coride', poolId: String(pool.id) });
    }
    out.reminded++;
  }
  return out;
};

const runCoRideTemplateJobs = async ({ now = new Date() } = {}) => {
  const a = await publishDueTemplates({ now });
  const b = await sendDueReminders({ now });
  return { ...a, ...b };
};

module.exports = {
  validateTemplateInput, validateSkipDate, serializeTemplate, runsFor, nextDepartureOf, cancelPublishedRide,
  publishDueTemplates, sendDueReminders, runCoRideTemplateJobs, timeLabel, departureOf, addDaysYmd,
  MAX_TEMPLATES_PER_USER, MAX_SKIP_DATES, PUBLISH_LEAD_MIN, REGULAR_PATH,
};
