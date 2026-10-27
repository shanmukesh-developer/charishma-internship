/**
 * Friends > Tasks (Phase 3): /api/campus/tasks. Contract: backend_contract.md "Friends (tasks)".
 *
 * A commission-free peer gig board for verified students of one campus. Zenvy is NOT an escrow,
 * payment processor or guarantor: no payment data is stored or accepted anywhere here, every task
 * payload carries the exact payment notice from the spec, and the optional UPI link is built on the
 * client only (never sent here, never marks anything as paid).
 *
 * Lifecycle (server-only transitions; the client can never set `status`):
 *   open ──select──▶ assigned ──accept──▶ in_progress ──submit──▶ submitted ──confirm──▶ completed
 *        ◀─unselect/decline─┘                ▲   └──reject-submission──┘        (7-day auto-confirm, D4)
 *   open / assigned ──deadline job──▶ expired     open / assigned / in_progress ──cancel──▶ cancelled
 *   in_progress / submitted ──dispute──▶ disputed ──admin resolve──▶ completed | cancelled | in_progress
 * Every transition is ONE conditional UPDATE ... WHERE status = <expected> (+ the actor's role column)
 * inside a transaction; zero rows -> 409 STATE_CHANGED. "One helper per task" is additionally a
 * database rule (partial unique fta_one_active), so parallel selects can never produce two helpers.
 *
 * Privacy: posters are named (tasks are never anonymous); the helper, applicant list, application
 * notes, chat id, submission / cancel / dispute details and reviews are only sent to the poster and
 * the helper. Public reputation shows ratings without reviewers. Contact details, exact locations and
 * payment details are refused in public text (contentPolicy + paymentCheck).
 */
const crypto = require('crypto');
const { Op } = require('sequelize');
const { getModel, getSequelize } = require('../index');
const limiter = require('../services/limiter');
const identity = require('../services/identity');
const cursor = require('../services/cursor');
const blocks = require('../services/blocks');
const reportsSvc = require('../services/reports');
const targets = require('../services/targets');
const audit = require('../services/audit');
const contentPolicy = require('../services/contentPolicy');
const integrity = require('../services/taskIntegrity');
const { notify } = require('../services/notify');
const { fail, requireUuid, isUuid, isUniqueError, optText } = require('../services/http');
const E = require('../models/foundation/enums');
const T = require('../models/tasks/enums');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

limiter.define('task_create', 5, DAY);
limiter.define('task_integrity_reject', 10, DAY);
limiter.define('task_edit', 20, HOUR);
limiter.define('task_apply', 20, DAY);
limiter.define('task_transition', 60, HOUR);
limiter.define('task_dispute', 5, DAY);
limiter.define('task_review', 20, DAY);

const MEDIA_PURPOSES = ['task', 'post', 'other', 'forum', 'chat'];
const autoConfirmDays = () => {
  const n = Number(process.env.TASK_AUTO_CONFIRM_DAYS);
  return Number.isFinite(n) && n > 0 && n <= 60 ? n : 7;
};

const M = (name) => getModel(name);
const send = (res, status, payload) => res.status(status).json(identity.scrub(payload));
const likeOp = () => (getSequelize().getDialect() === 'postgres' ? Op.iLike : Op.like);
const ctxOf = (req) => (req.friends && req.friends.ctx) || null;
const campusOf = (req) => {
  const ctx = ctxOf(req);
  return ctx && ctx.profile ? ctx.profile.campusId : null;
};
const charLen = (s) => Array.from(String(s || '')).length;
const notifyAdmin = (type, action, id, extra) => {
  try { require('../../../utils/realtime').notifyAdmin(type, action, id, extra); } catch { /* optional */ }
};

// ═════════════════════════════════════════════════════════════════════════════
// Transactions + realtime
// ═════════════════════════════════════════════════════════════════════════════

// SQLite (dev / tests) has one connection for ':memory:' and cannot run two transactions at once, so
// task transactions are queued there. Postgres runs them concurrently; the conditional UPDATEs and the
// partial unique index keep them correct.
let chain = Promise.resolve();
const serial = (fn) => {
  const run = chain.then(() => fn());
  chain = run.catch(() => {});
  return run;
};
const runTx = (fn) => {
  const seq = getSequelize();
  if (seq.getDialect() === 'postgres') return seq.transaction((t) => fn(t));
  return serial(() => seq.transaction((t) => fn(t)));
};

let ioRef = null;
const captureIo = (req) => {
  try {
    const io = req.app && req.app.get('io');
    if (io) ioRef = io;
  } catch { /* optional */ }
};
/** Tells the poster / helper apps to refetch a task. Payload has no personal data. */
const emitTask = (task, userIds) => {
  try {
    const nsp = ioRef && typeof ioRef.of === 'function' ? ioRef.of('/campus') : null;
    if (!nsp) return;
    const ids = [...new Set((userIds || []).filter(Boolean).map(String))];
    for (const u of ids) nsp.to(`user:${u}`).emit('friends:task_updated', { id: task.id, status: task.status });
  } catch { /* realtime is best effort; the app also refetches on focus */ }
};

// ═════════════════════════════════════════════════════════════════════════════
// Karma / reputation
// ═════════════════════════════════════════════════════════════════════════════

const karmaRow = async (userId, campusId, transaction) => {
  const FriendsKarma = M('FriendsKarma');
  const found = await FriendsKarma.findOne({ where: { userId }, transaction });
  if (found) return found;
  try {
    return await FriendsKarma.create({ userId, campusId: campusId || null }, { transaction });
  } catch (err) {
    if (!isUniqueError(err)) throw err;
    return FriendsKarma.findOne({ where: { userId }, transaction });
  }
};

const KARMA_FIELDS = ['tasksCompleted', 'taskRatingSum', 'taskRatingCount'];
const bumpTaskKarma = async (userId, campusId, deltas, transaction) => {
  const sets = Object.entries(deltas).filter(([k, v]) => KARMA_FIELDS.includes(k) && Number.isInteger(v) && v > 0);
  if (!userId || !sets.length) return;
  await karmaRow(userId, campusId, transaction);
  const sql = sets.map(([k]) => `"${k}" = "${k}" + :${k}`).join(', ');
  await getSequelize().query(`UPDATE "FriendsKarma" SET ${sql} WHERE "userId" = :u`, {
    replacements: { ...Object.fromEntries(sets), u: userId },
    transaction,
  });
};

/** 'trusted_helper' badge: 5+ completed tasks as helper, 3+ ratings averaging 4.0 or more. */
const evaluateTaskBadges = async (userId) => {
  try {
    const k = await M('FriendsKarma').findOne({ where: { userId } });
    if (!k) return;
    const count = Number(k.taskRatingCount) || 0;
    const avg = count ? (Number(k.taskRatingSum) || 0) / count : 0;
    if ((Number(k.tasksCompleted) || 0) >= 5 && count >= 3 && avg >= 4) {
      await M('FriendsBadge').findOrCreate({ where: { userId, code: 'trusted_helper' }, defaults: { userId, code: 'trusted_helper', source: 'auto' } });
    }
  } catch (err) {
    if (!isUniqueError(err)) console.warn('[FRIENDS_TASKS_BADGE_WARN]', err.message);
  }
};

const reputationOf = async (userIds) => {
  const ids = [...new Set((userIds || []).filter(Boolean).map(String))];
  const out = new Map();
  if (!ids.length) return out;
  const rows = await M('FriendsKarma').findAll({ where: { userId: { [Op.in]: ids } }, attributes: ['userId', 'tasksCompleted', 'taskRatingSum', 'taskRatingCount'] });
  for (const r of rows) {
    const c = Number(r.taskRatingCount) || 0;
    out.set(String(r.userId), {
      tasksCompleted: Number(r.tasksCompleted) || 0,
      ratingAvg: c ? Math.round(((Number(r.taskRatingSum) || 0) / c) * 10) / 10 : null,
      ratingCount: c,
    });
  }
  for (const id of ids) if (!out.has(id)) out.set(id, { tasksCompleted: 0, ratingAvg: null, ratingCount: 0 });
  return out;
};

// ═════════════════════════════════════════════════════════════════════════════
// Input parsing and content checks
// ═════════════════════════════════════════════════════════════════════════════

const reqText = (value, min, max, field, code) => {
  if (typeof value !== 'string') throw fail(400, code || 'INVALID_INPUT', `${field} is required.`, { field });
  const v = value.trim().replace(/[ \t]+\n/g, '\n');
  const n = charLen(v);
  if (n < min) throw fail(400, 'TOO_SHORT', `${field} needs at least ${min} characters.`, { field, min });
  if (n > max) throw fail(400, 'TOO_LONG', `${field} can be at most ${max} characters.`, { field, max });
  return v;
};

const parseReward = (raw) => {
  const n = typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : raw;
  if (!Number.isInteger(n) || n < T.REWARD_MIN || n > T.REWARD_MAX) {
    throw fail(400, 'INVALID_REWARD', `Reward must be a whole number of rupees from ${T.REWARD_MIN} to ${T.REWARD_MAX}.`, { min: T.REWARD_MIN, max: T.REWARD_MAX });
  }
  return n;
};

const parseDeadline = (raw) => {
  const d = typeof raw === 'string' || typeof raw === 'number' ? new Date(raw) : null;
  if (!d || Number.isNaN(d.getTime())) throw fail(400, 'INVALID_DEADLINE', 'Pick a valid deadline.');
  const now = Date.now();
  if (d.getTime() < now + T.DEADLINE_MIN_MINUTES * MIN) throw fail(400, 'INVALID_DEADLINE', `The deadline must be at least ${T.DEADLINE_MIN_MINUTES} minutes from now.`);
  if (d.getTime() > now + T.DEADLINE_MAX_DAYS * DAY) throw fail(400, 'INVALID_DEADLINE', `The deadline can be at most ${T.DEADLINE_MAX_DAYS} days away.`);
  return d;
};

const parseSkills = (raw) => {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw fail(400, 'INVALID_SKILLS', 'skills must be a list.');
  const out = [];
  const seen = new Set();
  for (const s of raw) {
    if (typeof s !== 'string') throw fail(400, 'INVALID_SKILLS', 'Each skill must be text.');
    const v = s.trim().replace(/\s+/g, ' ');
    if (!v) continue;
    if (charLen(v) > T.SKILL_MAX) throw fail(400, 'INVALID_SKILLS', `Each skill can be at most ${T.SKILL_MAX} characters.`, { max: T.SKILL_MAX });
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  if (out.length > T.MAX_SKILLS) throw fail(400, 'INVALID_SKILLS', `Add at most ${T.MAX_SKILLS} skills.`, { max: T.MAX_SKILLS });
  return out;
};

const parseEnum = (raw, values, field, code, fallback) => {
  if (raw === undefined || raw === null || raw === '') {
    if (fallback !== undefined) return fallback;
    throw fail(400, code, `${field} is required.`, { allowed: values });
  }
  const v = String(raw);
  if (!values.includes(v)) throw fail(400, code, `${field} must be one of ${values.join(', ')}.`, { allowed: values });
  return v;
};

/** Validated task fields. partial: only the keys present (PATCH). Client status / ids are never read. */
const parseFields = (b, { partial = false } = {}) => {
  const f = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(b, k) && b[k] !== undefined;
  if (!partial || has('title')) f.title = reqText(b.title, T.TITLE_MIN, T.TITLE_MAX, 'Title');
  if (!partial || has('description')) f.description = reqText(b.description, T.DESCRIPTION_MIN, T.DESCRIPTION_MAX, 'Description');
  if (!partial || has('category')) f.category = parseEnum(b.category, T.CATEGORIES, 'category', 'INVALID_CATEGORY');
  if (!partial || has('rewardInr')) f.rewardInr = parseReward(b.rewardInr);
  if (!partial || has('deadlineAt')) f.deadlineAt = parseDeadline(b.deadlineAt);
  if (!partial || has('skills')) f.skills = parseSkills(b.skills);
  if (!partial || has('fulfillment')) f.fulfillment = parseEnum(b.fulfillment, T.FULFILLMENT, 'fulfillment', 'INVALID_FULFILLMENT', 'either');
  if (!partial || has('areaHint')) f.areaHint = optText(b.areaHint, T.AREA_HINT_MAX, 'Area hint');
  return f;
};

const resolveMedia = async (mediaIds, ownerId) => {
  if (mediaIds === undefined || mediaIds === null) return [];
  if (!Array.isArray(mediaIds)) throw fail(400, 'INVALID_MEDIA', 'mediaIds must be a list.');
  const ids = [...new Set(mediaIds.map(String))];
  if (ids.length > T.MAX_MEDIA) throw fail(400, 'TOO_MANY_MEDIA', `You can attach at most ${T.MAX_MEDIA} images.`, { max: T.MAX_MEDIA });
  if (!ids.length) return [];
  if (!ids.every(isUuid)) throw fail(400, 'INVALID_MEDIA', 'One of the attachments is not valid.');
  const rows = await M('CampusMedia').findAll({ where: { id: { [Op.in]: ids } }, attributes: ['id', 'ownerId', 'isPrivate', 'purpose', 'mime'] });
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  for (const id of ids) {
    const r = byId.get(id);
    if (!r || String(r.ownerId) !== String(ownerId) || r.isPrivate || !MEDIA_PURPOSES.includes(r.purpose)
      || (r.mime && !/^image\/(jpeg|png|webp|gif)$/i.test(r.mime))) {
      throw fail(400, 'INVALID_MEDIA', 'Upload the image again and attach it from this device.');
    }
  }
  return ids.map((id) => ({ mediaId: id }));
};

// Payment details never belong in task text: Zenvy does not handle payments, and UPI ids / card
// numbers in public text invite fraud. People agree on payment privately in the task chat.
const UPI_RE = /(?:^|[^a-z0-9._@-])[a-z0-9._-]{2,64}@[a-z][a-z0-9]{1,30}(?![a-z0-9.@-])/i;
const CARD_RE = /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/;
const SECRET_RE = /\b(?:upi\s*pin|atm\s*pin|cvv|card\s*pin|net\s*banking\s*password)\b/i;
const PAYMENT_TEXT = 'Do not put payment details (UPI ids, card numbers or PINs) in a task. Agree on payment privately in the task chat.';
const paymentCheck = (text) => {
  const raw = String(text || '');
  if (UPI_RE.test(raw) || CARD_RE.test(raw) || SECRET_RE.test(raw)) {
    throw fail(422, 'CONTENT_BLOCKED', PAYMENT_TEXT, { reasons: ['PAYMENT_DETAILS'], details: [PAYMENT_TEXT] });
  }
};

/**
 * Public text checks. kind 'post' = contact details, room numbers, threats, bad links are refused
 * (no exact location / private contact in public). kind 'chat' = only threats / bad links (text the
 * two participants already share privately). Returns the contentPolicy result ('flag' or 'allow').
 */
const textChecks = (text, cfg, kind = 'post') => {
  if (!text) return { decision: 'allow', reasons: [] };
  const r = contentPolicy.enforce(text, { kind, cfg });
  if (kind !== 'chat') paymentCheck(text);
  return r;
};

const flagCategory = (reasons) => {
  if (reasons.includes('SELF_HARM')) return 'self_harm';
  if (reasons.includes('GRADED_WORK_UNCLEAR')) return 'academic_integrity';
  if (reasons.some((r) => r.startsWith('SPAM') || r === 'LINK_SHORTENER')) return 'spam';
  return 'other';
};

const taskText = (f) => [f.title, f.description, f.areaHint, (f.skills || []).join(', ')].filter(Boolean).join('\n');

// ═════════════════════════════════════════════════════════════════════════════
// Serialization
// ═════════════════════════════════════════════════════════════════════════════

const mediaOut = (req, media) => (media || []).map((m) => ({
  mediaId: m.mediaId,
  url: require('../../campus/campusHelpers').absolutize(req, `/api/campus/media/${m.mediaId}`),
}));

const iso = (d) => (d ? new Date(d).toISOString() : null);

const roleOf = (task, me) => {
  if (!me) return null;
  if (String(task.posterId) === String(me)) return 'poster';
  if (task.helperId && String(task.helperId) === String(me)) return 'helper';
  return null;
};

const chatOpen = (t) => {
  if (['removed', 'hidden'].includes(t.modStatus)) return false;
  if (['in_progress', 'submitted', 'disputed'].includes(t.status)) return true;
  return t.status === 'completed' && !!t.chatClosesAt && new Date(t.chatClosesAt).getTime() > Date.now();
};

/** Display stage: adds "applications_received" and "reviewed" (mutual reviews) to the lifecycle. */
const stageOf = (t, reviewCount = 0) => {
  if (t.status === 'open' && (t.applicationCount || 0) > 0) return 'applications_received';
  if (t.status === 'completed' && reviewCount >= 2) return 'reviewed';
  return t.status;
};

const reviewWindowOpen = (t) => t.status === 'completed' && !!t.completedAt
  && Date.now() - new Date(t.completedAt).getTime() < T.REVIEW_WINDOW_DAYS * DAY;

const actionsFor = (t, role, myApp, { reviewed } = {}) => {
  const a = [];
  const live = t.modStatus === 'visible';
  if (role === 'poster') {
    if (t.status === 'open') { if (['visible', 'pending_review'].includes(t.modStatus)) a.push('edit'); a.push('cancel'); }
    if (t.status === 'assigned') a.push('unselect', 'cancel');
    if (t.status === 'in_progress') a.push('cancel', 'dispute');
    if (t.status === 'submitted') {
      a.push('confirm', 'dispute');
      if ((t.submissionRejections || 0) < T.MAX_SUBMISSION_REJECTIONS) a.push('reject_submission');
    }
  } else if (role === 'helper') {
    if (t.status === 'assigned') a.push('accept', 'decline');
    if (t.status === 'in_progress') a.push('submit', 'cancel', 'dispute');
    if (t.status === 'submitted') a.push('dispute');
  } else if (myApp && myApp.status === 'pending' && t.status === 'open') {
    a.push('withdraw');
  } else if (live && t.status === 'open' && (!myApp || myApp.status === 'withdrawn')) {
    a.push('apply');
  }
  if ((role === 'poster' || role === 'helper') && reviewWindowOpen(t) && !reviewed) a.push('review');
  if ((role === 'poster' || role === 'helper') && t.conversationId) a.push('chat');
  return a;
};

const reviewOut = (r) => (r ? { rating: r.rating, text: r.text || '', createdAt: iso(r.createdAt) } : null);

/**
 * Task DTOs for one viewer (me) or for admins (opts.admin). Batch-loads identities, my applications
 * and (for participants) the two reviews.
 */
const serializeTasks = async (req, rows, me, { admin = false } = {}) => {
  if (!rows.length) return [];
  const ids = rows.map((t) => t.id);
  const people = new Set();
  rows.forEach((t) => {
    people.add(String(t.posterId));
    if (t.helperId && (admin || roleOf(t, me))) people.add(String(t.helperId));
  });
  const participantIds = rows.filter((t) => admin || roleOf(t, me)).map((t) => t.id);
  const [identities, myApps, reviews] = await Promise.all([
    identity.loadIdentities(req, [...people], { viewerId: me }),
    me ? M('FriendsTaskApplication').findAll({ where: { taskId: { [Op.in]: ids }, applicantId: me } }) : [],
    participantIds.length ? M('FriendsTaskReview').findAll({ where: { taskId: { [Op.in]: participantIds } } }) : [],
  ]);
  const appOf = new Map(myApps.map((a) => [String(a.taskId), a]));
  const reviewsOf = new Map();
  reviews.forEach((r) => {
    const k = String(r.taskId);
    if (!reviewsOf.has(k)) reviewsOf.set(k, []);
    reviewsOf.get(k).push(r);
  });
  const fallback = { userId: null, name: 'Former student', avatarUrl: null, verified: false, badges: [] };

  return rows.map((t) => {
    const role = admin ? null : roleOf(t, me);
    const participant = admin || !!role;
    const myApp = appOf.get(String(t.id)) || null;
    const rs = reviewsOf.get(String(t.id)) || [];
    const mine = role ? rs.find((r) => String(r.reviewerId) === String(me)) : null;
    const theirs = role ? rs.find((r) => String(r.reviewerId) !== String(me)) : null;
    const dto = {
      id: t.id,
      title: t.title,
      description: t.description,
      category: t.category,
      categoryLabel: T.CATEGORY_LABELS[t.category] || 'Other',
      rewardInr: t.rewardInr,
      deadlineAt: iso(t.deadlineAt),
      skills: t.skills || [],
      fulfillment: t.fulfillment,
      areaHint: t.areaHint || null,
      media: mediaOut(req, t.media),
      status: t.status,
      stage: stageOf(t, rs.length),
      applicationCount: t.applicationCount || 0,
      poster: identities.get(String(t.posterId)) || fallback,
      createdAt: iso(t.createdAt),
      editedAt: iso(t.editedAt),
      myRole: role || (myApp && myApp.status !== 'withdrawn' ? 'applicant' : null),
      myApplication: myApp ? { id: myApp.id, status: myApp.status, note: myApp.note || '', createdAt: iso(myApp.createdAt) } : null,
      actions: admin ? [] : actionsFor(t, role, myApp, { reviewed: !!mine }),
      paymentNotice: T.PAYMENT_NOTICE,
    };
    if (participant) {
      Object.assign(dto, {
        helper: t.helperId ? identities.get(String(t.helperId)) || fallback : null,
        conversationId: t.conversationId || null,
        chat: t.conversationId ? { conversationId: t.conversationId, canSend: chatOpen(t), closesAt: t.status === 'completed' ? iso(t.chatClosesAt) : null } : null,
        assignedAt: iso(t.assignedAt),
        startedAt: iso(t.startedAt),
        submittedAt: iso(t.submittedAt),
        submissionNote: t.submissionNote || null,
        submissionRejections: t.submissionRejections || 0,
        lastRejectionNote: t.lastRejectionNote || null,
        completedAt: iso(t.completedAt),
        autoConfirmed: !!t.autoConfirmed,
        autoConfirmAt: t.status === 'submitted' && t.submittedAt ? iso(new Date(new Date(t.submittedAt).getTime() + autoConfirmDays() * DAY)) : null,
        cancelledAt: iso(t.cancelledAt),
        cancelledBy: t.cancelledBy || null,
        cancelReason: t.cancelReason || null,
        expiredAt: iso(t.expiredAt),
        disputedAt: iso(t.disputedAt),
        disputedBy: t.disputedBy || null,
        disputeReason: t.disputeReason || null,
        disputeResolution: t.disputeResolution || null,
        reviews: role ? { mine: reviewOut(mine), theirs: reviewOut(theirs), canReview: reviewWindowOpen(t) && !mine } : undefined,
      });
    }
    if (admin || role === 'poster') {
      dto.modStatus = t.modStatus;
      dto.underReview = t.modStatus === 'pending_review';
      if (t.modStatus !== 'visible') dto.removedReason = t.removedReason || null;
      if (t.modStatus === 'rejected') {
        dto.integrity = { reasons: t.integrityFlags || [], details: (t.integrityFlags || []).map((r) => integrity.REASON_TEXT[r]).filter(Boolean) };
      }
    }
    if (admin) {
      dto.campusId = t.campusId;
      dto.integrityFlags = t.integrityFlags || [];
      dto.reviews = rs.map((r) => ({
        reviewer: identities.get(String(r.reviewerId)) || null,
        revieweeRole: r.revieweeRole,
        rating: r.rating,
        text: r.text || '',
        createdAt: iso(r.createdAt),
      }));
    }
    return dto;
  });
};

const serializeOne = async (req, t, me, opts) => (await serializeTasks(req, [t], me, opts))[0] || null;

// ═════════════════════════════════════════════════════════════════════════════
// Lazy maintenance (the jobs do the same in bulk; this keeps reads exact between job runs)
// ═════════════════════════════════════════════════════════════════════════════

const closeConversation = async (conversationId, transaction) => {
  if (!conversationId) return 0;
  const [n] = await M('Conversation').update({ closedAt: new Date() }, { where: { id: conversationId, closedAt: null }, transaction });
  return n;
};

/** open / assigned past the deadline -> expired. Returns true when this call expired it. */
const expireOne = async (task) => {
  const [n] = await M('FriendsTask').update(
    { status: 'expired', expiredAt: new Date() },
    { where: { id: task.id, status: { [Op.in]: ['open', 'assigned'] }, deadlineAt: { [Op.lt]: new Date() } } },
  );
  return n === 1;
};

/**
 * submitted -> completed (poster confirm, auto-confirm D4, or an admin dispute decision). The
 * conditional UPDATE decides the single winner; only the winner bumps karma and notifies.
 * where: extra conditions (e.g. posterId for a poster confirm).
 */
const completeTask = async (taskId, { from = ['submitted'], where = {}, auto = false, resolution } = {}) => {
  const now = new Date();
  const out = await runTx(async (transaction) => {
    const fields = { status: 'completed', completedAt: now, chatClosesAt: new Date(now.getTime() + T.CHAT_OPEN_DAYS_AFTER_COMPLETION * DAY), autoConfirmed: !!auto };
    if (resolution !== undefined) fields.disputeResolution = resolution;
    const [n] = await M('FriendsTask').update(fields, { where: { id: taskId, status: { [Op.in]: from }, ...where }, transaction });
    if (n !== 1) return { won: false };
    const task = await M('FriendsTask').findByPk(taskId, { transaction });
    await bumpTaskKarma(task.helperId, task.campusId, { tasksCompleted: 1 }, transaction);
    return { won: true, task };
  });
  if (out.won) {
    await evaluateTaskBadges(out.task.helperId);
    await notify('TASK_COMPLETED', [out.task.helperId, ...(auto || resolution !== undefined ? [out.task.posterId] : [])], {
      id: out.task.id, dedupeKey: `completed:${out.task.id}`, body: `"${out.task.title}" is complete.`, data: { taskId: out.task.id },
    });
    emitTask(out.task, [out.task.posterId, out.task.helperId]);
  }
  return out;
};

const autoConfirmOne = async (task) => {
  if (task.status !== 'submitted' || !task.submittedAt) return false;
  if (Date.now() - new Date(task.submittedAt).getTime() < autoConfirmDays() * DAY) return false;
  const cutoff = new Date(Date.now() - autoConfirmDays() * DAY);
  // A task a moderator hid / flagged is frozen: it must not auto-complete (karma, badge, reviews).
  if (task.modStatus && task.modStatus !== 'visible') return false;
  const r = await completeTask(task.id, { auto: true, where: { submittedAt: { [Op.lt]: cutoff }, modStatus: 'visible' } });
  return r.won;
};

/** Brings one task up to date (expiry, auto-confirm, chat close) and returns the fresh row. */
const maintain = async (task) => {
  if (!task) return task;
  let changed = false;
  if (['open', 'assigned'].includes(task.status) && new Date(task.deadlineAt).getTime() < Date.now()) changed = (await expireOne(task)) || changed;
  if (task.status === 'submitted') changed = (await autoConfirmOne(task)) || changed;
  if (task.status === 'completed' && task.conversationId && task.chatClosesAt && new Date(task.chatClosesAt).getTime() < Date.now()) {
    await closeConversation(task.conversationId);
  }
  return changed ? M('FriendsTask').findByPk(task.id) : task;
};

// ═════════════════════════════════════════════════════════════════════════════
// Loading a task a viewer may see
// ═════════════════════════════════════════════════════════════════════════════

/**
 * 404 when: another campus; not visible (pending / hidden / removed / rejected) unless I am the poster
 * (or the helper of a hidden / removed one); a poster I blocked or who blocked me (non-participants).
 */
const loadTaskFor = async (req, id) => {
  requireUuid(id, 'task');
  const me = req.user.id;
  let task = await M('FriendsTask').findByPk(id);
  const notFound = () => fail(404, 'TASK_NOT_FOUND', 'Task not found.');
  if (!task || String(task.campusId) !== String(campusOf(req))) throw notFound();
  const role = roleOf(task, me);
  if (task.modStatus !== 'visible') {
    const helperMaySee = role === 'helper' && ['hidden', 'removed'].includes(task.modStatus);
    if (role !== 'poster' && !helperMaySee) throw notFound();
  }
  if (!role && (await blocks.blockedIds(me)).has(String(task.posterId))) throw notFound();
  task = await maintain(task);
  return { task, role };
};

const conflict = (task, message) => fail(409, 'STATE_CHANGED', message || 'This task changed. Pull to refresh.', { status: task ? task.status : undefined });

// ═════════════════════════════════════════════════════════════════════════════
// Board, mine, detail, meta
// ═════════════════════════════════════════════════════════════════════════════

const ascAfter = (raw, field) => {
  const c = cursor.decode(raw, 'date');
  if (!c) return null;
  return { [Op.or]: [{ [field]: { [Op.gt]: c.value } }, { [field]: c.value, id: { [Op.gt]: c.id } }] };
};

// GET /?category=&sort=new|deadline|reward&q=&cursor=&limit=
const board = async (req, res) => {
  captureIo(req);
  const me = req.user.id;
  const limit = cursor.pageSize(req.query.limit, 20);
  const sort = req.query.sort ? String(req.query.sort) : 'new';
  if (!['new', 'deadline', 'reward'].includes(sort)) throw fail(400, 'INVALID_SORT', 'sort must be new, deadline or reward.');
  const and = [{ campusId: campusOf(req) }, { status: 'open' }, { modStatus: 'visible' }, { deadlineAt: { [Op.gt]: new Date() } }];
  if (req.query.category) and.push({ category: parseEnum(req.query.category, T.CATEGORIES, 'category', 'INVALID_CATEGORY') });
  const blocked = await blocks.blockedIds(me);
  if (blocked.size) and.push({ posterId: { [Op.notIn]: [...blocked] } });
  const q = typeof req.query.q === 'string' ? req.query.q.trim().replace(/[%_\\]/g, '').slice(0, 60) : '';
  if (q.length >= 2) and.push({ [Op.or]: [{ title: { [likeOp()]: `%${q}%` } }, { description: { [likeOp()]: `%${q}%` } }] });
  let order;
  let field;
  if (sort === 'new') {
    field = 'createdAt';
    const a = cursor.after(req.query.cursor, 'createdAt');
    if (a) and.push(a);
    order = [['createdAt', 'DESC'], ['id', 'DESC']];
  } else if (sort === 'reward') {
    field = 'rewardInr';
    const a = cursor.after(req.query.cursor, 'rewardInr', 'number');
    if (a) and.push(a);
    order = [['rewardInr', 'DESC'], ['id', 'DESC']];
  } else {
    field = 'deadlineAt';
    const a = ascAfter(req.query.cursor, 'deadlineAt');
    if (a) and.push(a);
    order = [['deadlineAt', 'ASC'], ['id', 'ASC']];
  }
  const rows = await M('FriendsTask').findAll({ where: { [Op.and]: and }, order, limit: limit + 1 });
  const { items, nextCursor } = cursor.page(rows, limit, field);
  send(res, 200, { items: await serializeTasks(req, items, me), nextCursor, sort, paymentNotice: T.PAYMENT_NOTICE });
};

const MINE_TABS = ['posted', 'helping', 'applied', 'completed'];

// GET /mine?tab=posted|helping|applied|completed&cursor=
const mine = async (req, res) => {
  captureIo(req);
  const me = req.user.id;
  const tab = req.query.tab ? String(req.query.tab) : 'posted';
  if (!MINE_TABS.includes(tab)) throw fail(400, 'INVALID_TAB', `tab must be one of ${MINE_TABS.join(', ')}.`);
  const limit = cursor.pageSize(req.query.limit, 20);
  const FriendsTask = M('FriendsTask');
  const FriendsTaskApplication = M('FriendsTaskApplication');
  const after = cursor.after(req.query.cursor);
  let items;
  let nextCursor;
  if (tab === 'applied') {
    const and = [{ applicantId: me }, { status: { [Op.ne]: 'withdrawn' } }];
    if (after) and.push(after);
    const apps = await FriendsTaskApplication.findAll({ where: { [Op.and]: and }, order: [['createdAt', 'DESC'], ['id', 'DESC']], limit: limit + 1 });
    const pg = cursor.page(apps, limit);
    nextCursor = pg.nextCursor;
    const tasks = pg.items.length ? await FriendsTask.findAll({ where: { id: { [Op.in]: pg.items.map((a) => a.taskId) }, modStatus: 'visible' } }) : [];
    const byId = new Map(tasks.map((t) => [String(t.id), t]));
    items = pg.items.map((a) => byId.get(String(a.taskId))).filter(Boolean);
  } else {
    const and = [];
    if (tab === 'posted') and.push({ posterId: me }, { status: { [Op.ne]: 'completed' } });
    if (tab === 'helping') and.push({ helperId: me }, { status: { [Op.ne]: 'completed' } }, { modStatus: { [Op.notIn]: ['pending_review', 'rejected'] } });
    if (tab === 'completed') and.push({ status: 'completed' }, { [Op.or]: [{ posterId: me }, { helperId: me }] });
    if (after) and.push(after);
    const rows = await FriendsTask.findAll({ where: { [Op.and]: and }, order: [['createdAt', 'DESC'], ['id', 'DESC']], limit: limit + 1 });
    const pg = cursor.page(rows, limit);
    items = pg.items;
    nextCursor = pg.nextCursor;
  }
  items = await Promise.all(items.map((t) => maintain(t)));
  const [posted, helping, applied, completed] = await Promise.all([
    FriendsTask.count({ where: { posterId: me, status: { [Op.in]: T.ACTIVE_STATUS } } }),
    FriendsTask.count({ where: { helperId: me, status: { [Op.in]: ['assigned', 'in_progress', 'submitted', 'disputed'] } } }),
    FriendsTaskApplication.count({ where: { applicantId: me, status: 'pending' } }),
    FriendsTask.count({ where: { status: 'completed', [Op.or]: [{ posterId: me }, { helperId: me }] } }),
  ]);
  send(res, 200, { tab, items: await serializeTasks(req, items, me), nextCursor, counts: { posted, helping, applied, completed } });
};

// GET /meta — categories, limits, guidance and the payment notice for the composer.
const meta = async (req, res) => {
  captureIo(req);
  const limits = Object.fromEntries(Object.entries(limiter.publicLimits()).filter(([k]) => k.startsWith('task_')));
  send(res, 200, {
    categories: T.CATEGORIES.map((key) => ({ key, label: T.CATEGORY_LABELS[key] })),
    fulfillment: T.FULFILLMENT,
    reward: { min: T.REWARD_MIN, max: T.REWARD_MAX, currency: 'INR' },
    deadline: { minMinutes: T.DEADLINE_MIN_MINUTES, maxDays: T.DEADLINE_MAX_DAYS },
    text: { titleMin: T.TITLE_MIN, titleMax: T.TITLE_MAX, descriptionMin: T.DESCRIPTION_MIN, descriptionMax: T.DESCRIPTION_MAX, noteMax: T.NOTE_MAX, areaHintMax: T.AREA_HINT_MAX, maxSkills: T.MAX_SKILLS, skillMax: T.SKILL_MAX, maxMedia: T.MAX_MEDIA },
    autoConfirmDays: autoConfirmDays(),
    chatOpenDaysAfterCompletion: T.CHAT_OPEN_DAYS_AFTER_COMPLETION,
    reviewWindowDays: T.REVIEW_WINDOW_DAYS,
    integrity: integrity.GUIDANCE,
    paymentNotice: T.PAYMENT_NOTICE,
    upi: { clientOnly: true, note: 'The UPI link is built on your phone from the UPI id you type. ZCS never stores it and never marks a task as paid.' },
    limits,
  });
};

// GET /:id
const getTask = async (req, res) => {
  captureIo(req);
  const { task } = await loadTaskFor(req, req.params.id);
  send(res, 200, { task: await serializeOne(req, task, req.user.id) });
};

// GET /users/:id/reputation — ratings without reviewers; 404 when blocked or on another campus.
const reputation = async (req, res) => {
  const me = req.user.id;
  const id = requireUuid(req.params.id, 'user');
  const p = await M('CampusProfile').findOne({ where: { userId: id }, attributes: ['campusId', 'verificationStatus'] });
  if (!p || String(p.campusId) !== String(campusOf(req)) || (String(id) !== String(me) && (await blocks.blockedIds(me)).has(String(id)))) {
    throw fail(404, 'USER_NOT_FOUND', 'Student not found.');
  }
  const rep = (await reputationOf([id])).get(String(id));
  const rows = await M('FriendsTaskReview').findAll({ where: { revieweeId: id }, order: [['createdAt', 'DESC']], limit: 200, attributes: ['revieweeRole', 'rating', 'text', 'createdAt'] });
  const by = (role) => {
    const rs = rows.filter((r) => r.revieweeRole === role);
    return { ratingCount: rs.length, ratingAvg: rs.length ? Math.round((rs.reduce((s, r) => s + r.rating, 0) / rs.length) * 10) / 10 : null };
  };
  const posted = await M('FriendsTask').count({ where: { posterId: id, status: 'completed' } });
  send(res, 200, {
    userId: id,
    ...rep,
    tasksPostedCompleted: posted,
    asHelper: by('helper'),
    asPoster: by('poster'),
    recent: rows.slice(0, 10).map((r) => ({ rating: r.rating, text: r.text || '', role: r.revieweeRole, createdAt: iso(r.createdAt) })),
  });
};

// ═════════════════════════════════════════════════════════════════════════════
// Create / edit
// ═════════════════════════════════════════════════════════════════════════════

const integrityRejection = async (taskId) => {
  const action = await M('FriendsModAction').findOne({ where: { targetType: 'task', targetId: taskId, action: 'reject' }, order: [['createdAt', 'DESC']] });
  return action ? action.id : null;
};

const integrityError = (reasons, actionId, taskId) => fail(422, 'ACADEMIC_INTEGRITY', integrity.REASON_TEXT[reasons[0]] || 'This task breaks the academic-integrity rules.', {
  reasons,
  details: reasons.map((r) => integrity.REASON_TEXT[r]).filter(Boolean),
  ...(actionId ? { appeal: { actionId, path: '/api/campus/friends/appeals' }, taskId } : {}),
});

// POST / { title, description, category, rewardInr, deadlineAt, skills, fulfillment, areaHint, mediaIds, clientId }
const createTask = async (req, res) => {
  captureIo(req);
  const me = req.user.id;
  const { cfg } = req.friends;
  const b = req.body || {};
  const campusId = campusOf(req);
  const FriendsTask = M('FriendsTask');

  const clientId = b.clientId === undefined || b.clientId === null || b.clientId === '' ? null : requireUuid(String(b.clientId), 'clientId');
  const replay = async (existing) => {
    if (existing.modStatus === 'rejected') throw integrityError(existing.integrityFlags || [], await integrityRejection(existing.id), existing.id);
    return send(res, 200, { task: await serializeOne(req, existing, me), duplicate: true, underReview: existing.modStatus === 'pending_review' });
  };
  if (clientId) {
    const existing = await FriendsTask.findOne({ where: { posterId: me, clientId } });
    if (existing) return replay(existing);
  }

  const f = parseFields(b);
  const media = await resolveMedia(b.mediaIds, me);
  const policy = textChecks(taskText(f), cfg, 'post');
  const integ = integrity.check(f);
  const id = crypto.randomUUID();
  const base = { id, campusId, posterId: me, clientId, ...f, media, status: 'open' };

  if (integ.decision === 'block') {
    // Kept as evidence (never shown to anyone else) so the poster can appeal the decision.
    limiter.enforce(me, 'task_integrity_reject');
    let row;
    try {
      row = await FriendsTask.create({ ...base, modStatus: 'rejected', integrityFlags: integ.reasons, removedReason: 'Academic integrity check' });
    } catch (err) {
      if (!isUniqueError(err) || !clientId) throw err;
      return replay(await FriendsTask.findOne({ where: { posterId: me, clientId } }));
    }
    const action = await audit.record({
      actorId: null,
      actorRole: 'system',
      action: 'reject',
      targetType: 'task',
      targetId: row.id,
      subjectUserId: me,
      reason: `Academic integrity: ${integ.reasons.join(', ')}`,
      meta: { reasons: integ.reasons },
    });
    throw integrityError(integ.reasons, action.id, row.id);
  }

  limiter.enforce(me, 'task_create');
  const flagged = [...(policy.decision === 'flag' ? policy.reasons : []), ...(integ.decision === 'flag' ? integ.reasons : [])];
  let task;
  try {
    task = await FriendsTask.create({ ...base, modStatus: flagged.length ? 'pending_review' : 'visible', integrityFlags: integ.decision === 'flag' ? integ.reasons : [] });
  } catch (err) {
    if (!isUniqueError(err) || !clientId) throw err;
    return replay(await FriendsTask.findOne({ where: { posterId: me, clientId } }));
  }
  if (flagged.length) {
    await reportsSvc.fileSystemReport({ targetType: 'task', targetId: task.id, category: flagCategory(flagged), note: `Automatic check: ${flagged.join(', ')}` });
  }
  send(res, 201, { task: await serializeOne(req, task, me), duplicate: false, underReview: !!flagged.length });
};

// PATCH /:id — poster only, while open (no helper selected). Previous values go to the audit trail.
const updateTask = async (req, res) => {
  captureIo(req);
  const me = req.user.id;
  const { cfg } = req.friends;
  const { task, role } = await loadTaskFor(req, req.params.id);
  if (role !== 'poster') throw fail(403, 'NOT_POSTER', 'Only the poster can edit this task.');
  if (['removed', 'hidden'].includes(task.modStatus)) throw fail(409, 'REMOVED', 'This task was taken down by a moderator. You can appeal the decision.');
  if (task.modStatus === 'rejected') throw fail(409, 'REJECTED', 'This task was refused by the academic-integrity check. You can appeal the decision.');
  if (task.status !== 'open') throw fail(409, 'NOT_EDITABLE', 'A task can only be edited while it is open and nobody is selected.', { status: task.status });
  const b = req.body || {};
  const f = parseFields(b, { partial: true });
  const hasMedia = b.mediaIds !== undefined;
  if (!Object.keys(f).length && !hasMedia) throw fail(400, 'NOTHING_TO_UPDATE', 'Nothing to update.');
  if (hasMedia) f.media = await resolveMedia(b.mediaIds, me);
  const merged = { title: task.title, description: task.description, areaHint: task.areaHint, skills: task.skills, ...f };
  const policy = textChecks(taskText(merged), cfg, 'post');
  const integ = integrity.check(merged);
  if (integ.decision === 'block') throw integrityError(integ.reasons, null, null);
  limiter.enforce(me, 'task_edit');
  const flagged = [...(policy.decision === 'flag' ? policy.reasons : []), ...(integ.decision === 'flag' ? integ.reasons : [])];
  const previous = { title: task.title, description: task.description, category: task.category, rewardInr: task.rewardInr, deadlineAt: iso(task.deadlineAt), skills: task.skills, fulfillment: task.fulfillment, areaHint: task.areaHint };
  const fields = { ...f, editedAt: new Date() };
  if (flagged.length && task.modStatus === 'visible') fields.modStatus = 'pending_review';
  if (flagged.length) fields.integrityFlags = integ.decision === 'flag' ? integ.reasons : task.integrityFlags;
  const [n] = await M('FriendsTask').update(fields, { where: { id: task.id, posterId: me, status: 'open', modStatus: { [Op.in]: ['visible', 'pending_review'] } } });
  if (n !== 1) throw conflict(await M('FriendsTask').findByPk(task.id));
  await audit.recordSafe({ actorId: me, actorRole: 'self', action: 'edit_self', targetType: 'task', targetId: task.id, subjectUserId: me, meta: { previous } });
  if (flagged.length) {
    await reportsSvc.fileSystemReport({ targetType: 'task', targetId: task.id, category: flagCategory(flagged), note: `Automatic check after edit: ${flagged.join(', ')}` });
  }
  const fresh = await M('FriendsTask').findByPk(task.id);
  send(res, 200, { task: await serializeOne(req, fresh, me), underReview: fresh.modStatus === 'pending_review' });
};

// ═════════════════════════════════════════════════════════════════════════════
// Applications
// ═════════════════════════════════════════════════════════════════════════════

const recountApplications = async (taskId, transaction) => {
  await getSequelize().query(
    `UPDATE "FriendsTasks" SET "applicationCount" = (SELECT COUNT(*) FROM "FriendsTaskApplications" a WHERE a."taskId" = :id AND a."status" <> 'withdrawn' AND a."removedByMod" = :f) WHERE "id" = :id`,
    { replacements: { id: taskId, f: false }, transaction },
  );
};

// POST /:id/applications { note }
const apply = async (req, res) => {
  captureIo(req);
  const me = req.user.id;
  const { cfg } = req.friends;
  const { task, role } = await loadTaskFor(req, req.params.id);
  if (role === 'poster') throw fail(403, 'OWN_TASK', 'You cannot apply to your own task.');
  if (task.modStatus !== 'visible' || task.status !== 'open' || new Date(task.deadlineAt).getTime() <= Date.now()) {
    throw fail(409, 'TASK_NOT_OPEN', 'This task is not taking applications.', { status: task.status });
  }
  const note = optText((req.body || {}).note, T.NOTE_MAX, 'Note');
  textChecks(note, cfg, 'post');
  const FriendsTaskApplication = M('FriendsTaskApplication');
  const existing = await FriendsTaskApplication.findOne({ where: { taskId: task.id, applicantId: me } });
  if (existing && existing.status !== 'withdrawn') {
    if (['rejected', 'declined'].includes(existing.status) || existing.removedByMod) throw fail(409, 'APPLICATION_CLOSED', 'You cannot apply to this task again.');
    return send(res, 200, { application: { id: existing.id, status: existing.status, note: existing.note || '', createdAt: iso(existing.createdAt) }, duplicate: true });
  }
  limiter.enforce(me, 'task_apply');
  let app;
  let created = false;
  if (existing) {
    const [n] = await FriendsTaskApplication.update({ status: 'pending', note, decidedAt: null }, { where: { id: existing.id, status: 'withdrawn' } });
    app = await FriendsTaskApplication.findByPk(existing.id);
    created = n === 1;
  } else {
    try {
      app = await FriendsTaskApplication.create({ taskId: task.id, applicantId: me, note, status: 'pending' });
      created = true;
    } catch (err) {
      if (!isUniqueError(err)) throw err;
      app = await FriendsTaskApplication.findOne({ where: { taskId: task.id, applicantId: me } });
    }
  }
  await recountApplications(task.id);
  if (created) {
    await notify('TASK_APPLICATION', [task.posterId], {
      id: task.id, dedupeKey: `apply:${app.id}`, body: `New application for "${task.title}".`, data: { taskId: task.id },
    });
    emitTask(task, [task.posterId]);
  }
  send(res, created ? 201 : 200, { application: { id: app.id, status: app.status, note: app.note || '', createdAt: iso(app.createdAt) }, duplicate: !created });
};

// DELETE /:id/applications/mine — withdraw a pending application.
const withdraw = async (req, res) => {
  captureIo(req);
  const me = req.user.id;
  const id = requireUuid(req.params.id, 'task');
  const FriendsTaskApplication = M('FriendsTaskApplication');
  const app = await FriendsTaskApplication.findOne({ where: { taskId: id, applicantId: me } });
  if (!app) throw fail(404, 'APPLICATION_NOT_FOUND', 'You have not applied to this task.');
  if (app.status === 'withdrawn') return send(res, 200, { withdrawn: true, duplicate: true });
  if (app.status === 'selected') throw fail(409, 'USE_DECLINE', 'You were selected. Use Decline to step back.');
  if (app.status === 'accepted') throw fail(409, 'USE_CANCEL', 'You are the helper on this task. Use Cancel instead.');
  if (app.status !== 'pending') throw fail(409, 'APPLICATION_CLOSED', 'This application is already closed.');
  const [n] = await FriendsTaskApplication.update({ status: 'withdrawn', decidedAt: new Date() }, { where: { id: app.id, status: 'pending' } });
  if (n !== 1) throw fail(409, 'STATE_CHANGED', 'This application changed. Pull to refresh.');
  await recountApplications(id);
  const task = await M('FriendsTask').findByPk(id);
  if (task) emitTask(task, [task.posterId]);
  send(res, 200, { withdrawn: true, duplicate: false });
};

// GET /:id/applications?cursor= — poster only.
const listApplications = async (req, res) => {
  captureIo(req);
  const me = req.user.id;
  const { task, role } = await loadTaskFor(req, req.params.id);
  if (role !== 'poster') throw fail(403, 'NOT_POSTER', 'Only the poster can see the applications.');
  const limit = cursor.pageSize(req.query.limit, 30);
  const blocked = await blocks.blockedIds(me);
  const and = [{ taskId: task.id }, { status: { [Op.ne]: 'withdrawn' } }, { removedByMod: false }];
  if (blocked.size) and.push({ applicantId: { [Op.notIn]: [...blocked] } });
  const a = cursor.after(req.query.cursor);
  if (a) and.push(a);
  const rows = await M('FriendsTaskApplication').findAll({ where: { [Op.and]: and }, order: [['createdAt', 'DESC'], ['id', 'DESC']], limit: limit + 1 });
  const { items, nextCursor } = cursor.page(rows, limit);
  const ids = items.map((x) => x.applicantId);
  const [identities, reps] = await Promise.all([identity.loadIdentities(req, ids, { viewerId: me }), reputationOf(ids)]);
  send(res, 200, {
    items: items.map((x) => ({
      id: x.id,
      applicant: identities.get(String(x.applicantId)) || { userId: null, name: 'Former student', avatarUrl: null, verified: false, badges: [] },
      reputation: reps.get(String(x.applicantId)),
      note: x.note || '',
      status: x.status,
      createdAt: iso(x.createdAt),
      canSelect: task.status === 'open' && task.modStatus === 'visible' && x.status === 'pending',
    })),
    nextCursor,
    taskStatus: task.status,
  });
};

// ═════════════════════════════════════════════════════════════════════════════
// Transitions
// ═════════════════════════════════════════════════════════════════════════════

const requireRole = (role, want, message) => {
  if (!want.includes(role)) throw fail(403, want.length === 1 && want[0] === 'poster' ? 'NOT_POSTER' : want.length === 1 ? 'NOT_HELPER' : 'NOT_PARTICIPANT', message);
};

// POST /:id/select { applicationId } — poster: open -> assigned.
const select = async (req, res) => {
  captureIo(req);
  const me = req.user.id;
  const { task, role } = await loadTaskFor(req, req.params.id);
  requireRole(role, ['poster'], 'Only the poster can choose a helper.');
  const appId = requireUuid(String((req.body || {}).applicationId || ''), 'application');
  limiter.enforce(me, 'task_transition');
  const FriendsTaskApplication = M('FriendsTaskApplication');
  const app = await FriendsTaskApplication.findByPk(appId);
  if (!app || String(app.taskId) !== String(task.id) || app.removedByMod) throw fail(404, 'APPLICATION_NOT_FOUND', 'Application not found.');
  if (await blocks.isBlocked(me, app.applicantId)) throw fail(403, 'BLOCKED', 'You cannot choose someone you blocked or who blocked you.');
  if (task.status !== 'open' || task.modStatus !== 'visible') throw conflict(task, 'This task is not open for choosing a helper.');
  if (app.status !== 'pending') throw fail(409, 'APPLICATION_NOT_AVAILABLE', 'This application is no longer available.', { applicationStatus: app.status });
  const now = new Date();
  try {
    await runTx(async (transaction) => {
      const [n] = await M('FriendsTask').update(
        { status: 'assigned', helperId: app.applicantId, assignedAt: now },
        { where: { id: task.id, posterId: me, status: 'open', modStatus: 'visible', deadlineAt: { [Op.gt]: now } }, transaction },
      );
      if (n !== 1) throw conflict(null, 'Someone was already chosen, or the task changed. Pull to refresh.');
      const [m] = await FriendsTaskApplication.update(
        { status: 'selected', selectedAt: now },
        { where: { id: app.id, taskId: task.id, status: 'pending', removedByMod: false }, transaction },
      );
      if (m !== 1) throw fail(409, 'APPLICATION_NOT_AVAILABLE', 'This application is no longer available.');
    });
  } catch (err) {
    if (isUniqueError(err)) throw conflict(null, 'Someone was already chosen for this task.');
    throw err;
  }
  const fresh = await M('FriendsTask').findByPk(task.id);
  await notify('TASK_SELECTED', [app.applicantId], { id: task.id, dedupeKey: `select:${app.id}:${now.getTime()}`, body: `You were selected for "${task.title}". Accept to start.`, data: { taskId: task.id } });
  emitTask(fresh, [me, app.applicantId]);
  send(res, 200, { task: await serializeOne(req, fresh, me) });
};

// POST /:id/accept — selected helper: assigned -> in_progress; opens the private task chat.
const accept = async (req, res) => {
  captureIo(req);
  const me = req.user.id;
  const { task } = await loadTaskFor(req, req.params.id);
  if (!task.helperId || String(task.helperId) !== String(me)) throw fail(403, 'NOT_HELPER', 'Only the selected helper can accept.');
  if (await blocks.isBlocked(me, task.posterId)) throw fail(403, 'BLOCKED', 'You cannot work with someone you blocked or who blocked you.');
  limiter.enforce(me, 'task_transition');
  const now = new Date();
  const out = await runTx(async (transaction) => {
    const FriendsTask = M('FriendsTask');
    const [n] = await FriendsTask.update(
      { status: 'in_progress', startedAt: now },
      { where: { id: task.id, status: 'assigned', helperId: me, modStatus: 'visible' }, transaction },
    );
    if (n !== 1) {
      const cur = await FriendsTask.findByPk(task.id, { transaction });
      if (cur && cur.status === 'in_progress' && String(cur.helperId) === String(me)) return { duplicate: true };
      throw conflict(cur);
    }
    const [m] = await M('FriendsTaskApplication').update({ status: 'accepted', decidedAt: now }, { where: { taskId: task.id, applicantId: me, status: 'selected' }, transaction });
    if (m !== 1) throw conflict(null);
    const conv = await M('Conversation').create({
      isGroup: false,
      type: 'dm',
      participants: [String(task.posterId), String(me)],
      refType: 'task',
      refId: task.id,
      description: `Task: ${task.title}`.slice(0, 255),
      lastMessageAt: now,
    }, { transaction });
    await FriendsTask.update({ conversationId: conv.id }, { where: { id: task.id }, transaction });
    await M('FriendsTaskApplication').update({ status: 'rejected', decidedAt: now }, { where: { taskId: task.id, status: 'pending' }, transaction });
    return { duplicate: false };
  });
  const fresh = await M('FriendsTask').findByPk(task.id);
  if (!out.duplicate) {
    await notify('TASK_ACCEPTED', [task.posterId], { id: task.id, dedupeKey: `accept:${task.id}`, body: `Your helper accepted "${task.title}". You can chat now.`, data: { taskId: task.id, conversationId: fresh.conversationId } });
    emitTask(fresh, [task.posterId, me]);
  }
  send(res, 200, { task: await serializeOne(req, fresh, me), duplicate: out.duplicate });
};

// POST /:id/decline — selected helper: assigned -> open.
const decline = async (req, res) => {
  captureIo(req);
  const me = req.user.id;
  const { task } = await loadTaskFor(req, req.params.id);
  if (!task.helperId || String(task.helperId) !== String(me)) throw fail(403, 'NOT_HELPER', 'Only the selected helper can decline.');
  limiter.enforce(me, 'task_transition');
  const now = new Date();
  await runTx(async (transaction) => {
    const [n] = await M('FriendsTask').update({ status: 'open', helperId: null, assignedAt: null }, { where: { id: task.id, status: 'assigned', helperId: me }, transaction });
    if (n !== 1) throw conflict(await M('FriendsTask').findByPk(task.id, { transaction }));
    await M('FriendsTaskApplication').update({ status: 'declined', decidedAt: now }, { where: { taskId: task.id, applicantId: me, status: 'selected' }, transaction });
  });
  const fresh = await M('FriendsTask').findByPk(task.id);
  emitTask(fresh, [task.posterId, me]);
  send(res, 200, { task: await serializeOne(req, fresh, me) });
};

// POST /:id/unselect — poster: assigned -> open (before the helper accepts). The application goes back to pending.
const unselect = async (req, res) => {
  captureIo(req);
  const me = req.user.id;
  const { task, role } = await loadTaskFor(req, req.params.id);
  requireRole(role, ['poster'], 'Only the poster can change the helper.');
  limiter.enforce(me, 'task_transition');
  const helper = task.helperId;
  await runTx(async (transaction) => {
    const [n] = await M('FriendsTask').update({ status: 'open', helperId: null, assignedAt: null }, { where: { id: task.id, status: 'assigned', posterId: me }, transaction });
    if (n !== 1) throw conflict(await M('FriendsTask').findByPk(task.id, { transaction }));
    await M('FriendsTaskApplication').update({ status: 'pending', selectedAt: null }, { where: { taskId: task.id, status: 'selected' }, transaction });
  });
  const fresh = await M('FriendsTask').findByPk(task.id);
  emitTask(fresh, [me, helper]);
  send(res, 200, { task: await serializeOne(req, fresh, me) });
};

// POST /:id/submit { note } — helper: in_progress -> submitted.
const submit = async (req, res) => {
  captureIo(req);
  const me = req.user.id;
  const { cfg } = req.friends;
  const { task, role } = await loadTaskFor(req, req.params.id);
  requireRole(role, ['helper'], 'Only the helper can mark the task as done.');
  const note = optText((req.body || {}).note, T.NOTE_MAX, 'Note');
  textChecks(note, cfg, 'chat');
  limiter.enforce(me, 'task_transition');
  const [n] = await M('FriendsTask').update(
    { status: 'submitted', submittedAt: new Date(), submissionNote: note },
    { where: { id: task.id, status: 'in_progress', helperId: me, modStatus: 'visible' } },
  );
  const fresh = await M('FriendsTask').findByPk(task.id);
  if (n !== 1) {
    if (fresh.status === 'submitted') return send(res, 200, { task: await serializeOne(req, fresh, me), duplicate: true });
    throw conflict(fresh);
  }
  await notify('TASK_SUBMITTED', [task.posterId], { id: task.id, dedupeKey: `submit:${task.id}:${fresh.submittedAt.getTime()}`, body: `Your helper marked "${task.title}" as done. Please confirm.`, data: { taskId: task.id } });
  emitTask(fresh, [task.posterId, me]);
  send(res, 200, { task: await serializeOne(req, fresh, me), duplicate: false });
};

// POST /:id/confirm — poster: submitted -> completed.
const confirm = async (req, res) => {
  captureIo(req);
  const me = req.user.id;
  const { task, role } = await loadTaskFor(req, req.params.id);
  requireRole(role, ['poster'], 'Only the poster can confirm completion.');
  limiter.enforce(me, 'task_transition');
  // A task a moderator took down cannot be completed (no karma for removed work) (B26).
  const r = await completeTask(task.id, { where: { posterId: me, modStatus: 'visible' } });
  const fresh = await M('FriendsTask').findByPk(task.id);
  if (!r.won) {
    if (fresh.status === 'completed') return send(res, 200, { task: await serializeOne(req, fresh, me), duplicate: true });
    throw conflict(fresh);
  }
  send(res, 200, { task: await serializeOne(req, fresh, me), duplicate: false });
};

// POST /:id/reject-submission { reason } — poster: submitted -> in_progress (at most 3 times; then confirm or dispute).
const rejectSubmission = async (req, res) => {
  captureIo(req);
  const me = req.user.id;
  const { cfg } = req.friends;
  const { task, role } = await loadTaskFor(req, req.params.id);
  requireRole(role, ['poster'], 'Only the poster can send the work back.');
  const reason = optText((req.body || {}).reason, T.REASON_MAX, 'Reason');
  if (!reason || charLen(reason) < 3) throw fail(400, 'REASON_REQUIRED', 'Tell your helper what is still missing.');
  textChecks(reason, cfg, 'chat');
  limiter.enforce(me, 'task_transition');
  const [n] = await M('FriendsTask').update(
    { status: 'in_progress', submittedAt: null, lastRejectionNote: reason, submissionRejections: getSequelize().literal('"submissionRejections" + 1') },
    { where: { id: task.id, status: 'submitted', posterId: me, submissionRejections: { [Op.lt]: T.MAX_SUBMISSION_REJECTIONS } } },
  );
  const fresh = await M('FriendsTask').findByPk(task.id);
  if (n !== 1) {
    if (fresh.status === 'submitted' && fresh.submissionRejections >= T.MAX_SUBMISSION_REJECTIONS) {
      throw fail(409, 'TOO_MANY_REJECTIONS', 'You have sent this back 3 times. Confirm it, or open a dispute.');
    }
    throw conflict(fresh);
  }
  emitTask(fresh, [me, task.helperId]);
  send(res, 200, { task: await serializeOne(req, fresh, me) });
};

// POST /:id/cancel { reason } — poster from open / assigned / in_progress; helper from in_progress.
const cancel = async (req, res) => {
  captureIo(req);
  const me = req.user.id;
  const { cfg } = req.friends;
  const { task, role } = await loadTaskFor(req, req.params.id);
  requireRole(role, ['poster', 'helper'], 'Only the poster or the helper can cancel.');
  if (role === 'helper' && task.status === 'assigned') throw fail(409, 'USE_DECLINE', 'You have not started yet. Use Decline instead.');
  const from = role === 'poster' ? ['open', 'assigned', 'in_progress'] : ['in_progress'];
  const reason = optText((req.body || {}).reason, T.REASON_MAX, 'Reason');
  if (task.status === 'in_progress' && (!reason || charLen(reason) < 3)) throw fail(400, 'REASON_REQUIRED', 'Tell the other person why you are cancelling.');
  textChecks(reason, cfg, 'chat');
  limiter.enforce(me, 'task_transition');
  const pending = await M('FriendsTaskApplication').findAll({ where: { taskId: task.id, status: { [Op.in]: ['pending', 'selected'] } }, attributes: ['applicantId'] });
  const now = new Date();
  await runTx(async (transaction) => {
    const [n] = await M('FriendsTask').update(
      { status: 'cancelled', cancelledAt: now, cancelledBy: role, cancelReason: reason },
      { where: { id: task.id, status: { [Op.in]: from }, [role === 'poster' ? 'posterId' : 'helperId']: me }, transaction },
    );
    if (n !== 1) throw conflict(await M('FriendsTask').findByPk(task.id, { transaction }));
    await M('FriendsTaskApplication').update({ status: 'rejected', decidedAt: now }, { where: { taskId: task.id, status: { [Op.in]: ['pending', 'selected'] } }, transaction });
    const cur = await M('FriendsTask').findByPk(task.id, { transaction });
    await closeConversation(cur.conversationId, transaction);
  });
  const fresh = await M('FriendsTask').findByPk(task.id);
  const others = [fresh.posterId, fresh.helperId, ...pending.map((p) => p.applicantId)].filter((u) => u && String(u) !== String(me));
  await notify('TASK_CANCELLED', others, { id: task.id, dedupeKey: `cancel:${task.id}`, body: `"${task.title}" was cancelled.`, data: { taskId: task.id } });
  emitTask(fresh, [fresh.posterId, fresh.helperId]);
  send(res, 200, { task: await serializeOne(req, fresh, me) });
};

// POST /:id/dispute { reason, category } — poster or helper from in_progress / submitted. Files a report.
const dispute = async (req, res) => {
  captureIo(req);
  const me = req.user.id;
  const { cfg } = req.friends;
  const { task, role } = await loadTaskFor(req, req.params.id);
  requireRole(role, ['poster', 'helper'], 'Only the poster or the helper can open a dispute.');
  const b = req.body || {};
  const reason = optText(b.reason, T.REASON_MAX, 'Reason');
  if (!reason || charLen(reason) < 10) throw fail(400, 'REASON_REQUIRED', 'Describe the problem in at least 10 characters.');
  textChecks(reason, cfg, 'chat');
  const category = b.category && E.REPORT_CATEGORIES.includes(String(b.category)) ? String(b.category) : 'other';
  limiter.enforce(me, 'task_dispute');
  const [n] = await M('FriendsTask').update(
    { status: 'disputed', disputedAt: new Date(), disputedBy: role, disputeReason: reason, disputeResolution: null },
    { where: { id: task.id, status: { [Op.in]: ['in_progress', 'submitted'] }, [role === 'poster' ? 'posterId' : 'helperId']: me } },
  );
  const fresh = await M('FriendsTask').findByPk(task.id);
  if (n !== 1) throw conflict(fresh);
  const filed = await reportsSvc.fileSystemReport({ targetType: 'task', targetId: task.id, category, note: `Dispute opened by the ${role}: ${reason}` });
  if (filed && filed.duplicate && filed.report && !reportsSvc.OPEN_STATUSES.includes(filed.report.status)) {
    // A second dispute after an earlier one was resolved: reopen the same report row (one per reporter + target).
    await M('FriendsReport').update(
      { status: 'open', category, severity: reportsSvc.SEVERITY[category] || 'low', note: `Dispute opened by the ${role}: ${reason}`.slice(0, 500), resolvedAt: null, resolvedBy: null, resolution: null, decision: null, slaDueAt: new Date(Date.now() + (cfg.slaHours[reportsSvc.SEVERITY[category] || 'low'] || 48) * HOUR) },
      { where: { id: filed.report.id } },
    );
    reportsSvc.notifyAdminSafe('updated', filed.report.id, { scope: 'tasks' });
  }
  emitTask(fresh, [fresh.posterId, fresh.helperId]);
  send(res, 200, { task: await serializeOne(req, fresh, me), reportId: filed && filed.report ? filed.report.id : null });
};

// ═════════════════════════════════════════════════════════════════════════════
// Reviews
// ═════════════════════════════════════════════════════════════════════════════

// POST /:id/reviews { rating 1..5, text }
const createReview = async (req, res) => {
  captureIo(req);
  const me = req.user.id;
  const { cfg } = req.friends;
  const { task, role } = await loadTaskFor(req, req.params.id);
  requireRole(role, ['poster', 'helper'], 'Only the poster and the helper of this task can review it.');
  if (task.status !== 'completed') throw fail(409, 'NOT_COMPLETED', 'You can review once the task is completed.');
  if (!reviewWindowOpen(task)) throw fail(409, 'REVIEW_WINDOW_CLOSED', `Reviews are open for ${T.REVIEW_WINDOW_DAYS} days after completion.`);
  const b = req.body || {};
  const rating = typeof b.rating === 'string' && /^\d$/.test(b.rating) ? Number(b.rating) : b.rating;
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw fail(400, 'INVALID_RATING', 'Rating must be a whole number from 1 to 5.');
  const text = optText(b.text, T.REVIEW_TEXT_MAX, 'Review');
  textChecks(text, cfg, 'post');
  const revieweeId = role === 'poster' ? task.helperId : task.posterId;
  const revieweeRole = role === 'poster' ? 'helper' : 'poster';
  const existing = await M('FriendsTaskReview').findOne({ where: { taskId: task.id, reviewerId: me } });
  if (existing) throw fail(409, 'ALREADY_REVIEWED', 'You have already reviewed this task.');
  limiter.enforce(me, 'task_review');
  let review;
  try {
    review = await runTx(async (transaction) => {
      const r = await M('FriendsTaskReview').create({ taskId: task.id, reviewerId: me, revieweeId, revieweeRole, rating, text }, { transaction });
      await bumpTaskKarma(revieweeId, task.campusId, { taskRatingSum: rating, taskRatingCount: 1 }, transaction);
      return r;
    });
  } catch (err) {
    if (isUniqueError(err)) throw fail(409, 'ALREADY_REVIEWED', 'You have already reviewed this task.');
    throw err;
  }
  await evaluateTaskBadges(revieweeId);
  await notify('TASK_REVIEW', [revieweeId], { id: task.id, dedupeKey: `review:${review.id}`, body: `You received a ${rating}-star review for "${task.title}".`, data: { taskId: task.id } });
  emitTask(task, [task.posterId, task.helperId]);
  const fresh = await M('FriendsTask').findByPk(task.id);
  send(res, 201, { review: reviewOut(review), task: await serializeOne(req, fresh, me) });
};

// GET /:id/reviews — participants only.
const listReviews = async (req, res) => {
  const me = req.user.id;
  const { task, role } = await loadTaskFor(req, req.params.id);
  requireRole(role, ['poster', 'helper'], 'Only the poster and the helper can see these reviews.');
  const rows = await M('FriendsTaskReview').findAll({ where: { taskId: task.id } });
  const mineR = rows.find((r) => String(r.reviewerId) === String(me));
  const theirs = rows.find((r) => String(r.reviewerId) !== String(me));
  send(res, 200, { mine: reviewOut(mineR), theirs: reviewOut(theirs), canReview: reviewWindowOpen(task) && !mineR });
};

// ═════════════════════════════════════════════════════════════════════════════
// Moderation (admin API + unified moderation hooks)
// ═════════════════════════════════════════════════════════════════════════════

const OPEN = reportsSvc.OPEN_STATUSES;

const closeTaskReports = async (taskId, { status, decision, actorId, actionId, note }) => {
  const [n] = await M('FriendsReport').update(
    { status, decision, resolvedBy: actorId, resolvedAt: new Date(), resolution: note || null, actionId },
    { where: { targetType: 'task', targetId: taskId, status: { [Op.in]: OPEN } } },
  );
  if (n) notifyAdmin('friends_report', 'updated', taskId, { scope: 'tasks' });
  return n;
};

/**
 * Moderation state change used by the admin API and the unified queue (targets resolver).
 * removed: active tasks are cancelled (cancelledBy 'moderator'), pending applications rejected and the
 * chat closed. hidden: off the board and chat read-only, lifecycle untouched. visible: restored.
 */
const setModStatus = async (taskId, modStatus, reason, { transaction } = {}) => {
  const exec = async (t) => {
    const task = await M('FriendsTask').findByPk(taskId, { transaction: t });
    if (!task) return null;
    const fields = { modStatus, removedReason: modStatus === 'visible' ? null : (reason ? String(reason).slice(0, 300) : 'Moderation decision') };
    if (modStatus === 'removed' && T.ACTIVE_STATUS.includes(task.status)) {
      Object.assign(fields, { status: 'cancelled', cancelledAt: new Date(), cancelledBy: 'moderator', cancelReason: 'Removed by a moderator' });
    }
    await M('FriendsTask').update(fields, { where: { id: taskId }, transaction: t });
    if (modStatus === 'removed') {
      await M('FriendsTaskApplication').update({ status: 'rejected', decidedAt: new Date() }, { where: { taskId, status: 'pending' }, transaction: t });
      await closeConversation(task.conversationId, t);
    }
    return M('FriendsTask').findByPk(taskId, { transaction: t });
  };
  return transaction ? exec(transaction) : runTx(exec);
};

const ADMIN_ACTIONS = ['remove', 'hide', 'restore', 'approve'];

const moderateTask = async (actorId, task, action, reason) => {
  if (!ADMIN_ACTIONS.includes(action)) throw fail(400, 'INVALID_ACTION', `Action must be one of ${ADMIN_ACTIONS.join(', ')}.`);
  if (['remove', 'hide'].includes(action) && (!reason || reason.length < 3)) throw fail(400, 'REASON_REQUIRED', 'Give a short reason. The poster sees it and can appeal.');
  if (action === 'restore' && !['hidden', 'removed'].includes(task.modStatus)) throw fail(409, 'NOT_REMOVED', 'This task is not hidden or removed.');
  if (action === 'approve' && !['pending_review', 'rejected'].includes(task.modStatus)) throw fail(409, 'NOT_PENDING', 'This task is not waiting for review.');
  const next = action === 'remove' ? 'removed' : action === 'hide' ? 'hidden' : 'visible';
  const wasRejected = task.modStatus === 'rejected';
  const fresh = await setModStatus(task.id, next, reason);
  const row = await audit.record({
    actorId,
    actorRole: 'admin',
    action,
    targetType: 'task',
    targetId: task.id,
    subjectUserId: ['remove', 'hide'].includes(action) || wasRejected ? task.posterId : null,
    reason: reason || null,
    meta: wasRejected ? { integrityFlags: task.integrityFlags || [], overrode: 'academic_integrity' } : {},
  });
  if (['remove', 'hide'].includes(action)) {
    await closeTaskReports(task.id, { status: 'actioned', decision: action, actorId, actionId: row.id, note: reason });
    await notify('MOD_OUTCOME', [task.posterId], { id: row.id, dedupeKey: `decision:${row.id}`, data: { kind: 'decision', actionId: row.id } });
    if (fresh && fresh.helperId) emitTask(fresh, [fresh.posterId, fresh.helperId]);
  }
  if (action === 'approve') {
    await closeTaskReports(task.id, { status: 'dismissed', decision: 'dismiss', actorId, actionId: row.id, note: reason || 'Approved after review' });
    if (wasRejected) await notify('MOD_OUTCOME', [task.posterId], { id: row.id, dedupeKey: `decision:${row.id}`, data: { kind: 'decision', actionId: row.id } });
  }
  return { row, task: fresh };
};

const adminCampus = async (raw) => {
  if (raw === undefined || raw === null || raw === '') return null;
  const id = requireUuid(String(raw), 'campus');
  const c = await M('Campus').findByPk(id);
  if (!c) throw fail(404, 'CAMPUS_NOT_FOUND', 'Campus not found.');
  return c.id;
};

// GET /admin/tasks?campusId=&status=&modStatus=&category=&q=&cursor=
const adminList = async (req, res) => {
  captureIo(req);
  const limit = cursor.pageSize(req.query.limit, 30);
  const and = [];
  const campusId = await adminCampus(req.query.campusId);
  if (campusId) and.push({ campusId });
  if (req.query.status) and.push({ status: parseEnum(req.query.status, T.TASK_STATUS, 'status', 'INVALID_STATUS') });
  if (req.query.modStatus) and.push({ modStatus: parseEnum(req.query.modStatus, T.MOD_STATUS, 'modStatus', 'INVALID_STATUS') });
  if (req.query.category) and.push({ category: parseEnum(req.query.category, T.CATEGORIES, 'category', 'INVALID_CATEGORY') });
  const q = typeof req.query.q === 'string' ? req.query.q.trim().replace(/[%_\\]/g, '').slice(0, 60) : '';
  if (q.length >= 2) and.push({ [Op.or]: [{ title: { [likeOp()]: `%${q}%` } }, { description: { [likeOp()]: `%${q}%` } }] });
  const a = cursor.after(req.query.cursor);
  if (a) and.push(a);
  const rows = await M('FriendsTask').findAll({ where: { [Op.and]: and }, order: [['createdAt', 'DESC'], ['id', 'DESC']], limit: limit + 1 });
  const { items, nextCursor } = cursor.page(rows, limit);
  const dtos = await serializeTasks(req, items, null, { admin: true });
  const ids = items.map((t) => t.id);
  const reportRows = ids.length ? await M('FriendsReport').findAll({ where: { targetType: 'task', targetId: { [Op.in]: ids }, status: { [Op.in]: OPEN } }, attributes: ['targetId'] }) : [];
  const openReports = reportRows.reduce((m, r) => m.set(String(r.targetId), (m.get(String(r.targetId)) || 0) + 1), new Map());
  send(res, 200, { items: dtos.map((d) => ({ ...d, openReports: openReports.get(String(d.id)) || 0 })), nextCursor });
};

// GET /admin/tasks/:id — full detail incl. applications, reviews, reports and the action history.
const adminGet = async (req, res) => {
  captureIo(req);
  const id = requireUuid(req.params.id, 'task');
  const task = await M('FriendsTask').findByPk(id);
  if (!task) throw fail(404, 'TASK_NOT_FOUND', 'Task not found.');
  const [dto] = await serializeTasks(req, [task], null, { admin: true });
  const apps = await M('FriendsTaskApplication').findAll({ where: { taskId: id }, order: [['createdAt', 'ASC']] });
  const ids = apps.map((x) => x.applicantId);
  const identities = await identity.loadIdentities(req, ids, {});
  const [reports, actions] = await Promise.all([
    M('FriendsReport').findAll({ where: { targetType: { [Op.in]: ['task', 'task_application'] }, targetId: { [Op.in]: [id, ...apps.map((x) => x.id)] } }, order: [['createdAt', 'DESC']] }),
    M('FriendsModAction').findAll({ where: { targetType: { [Op.in]: ['task', 'task_application'] }, targetId: { [Op.in]: [id, ...apps.map((x) => x.id)] } }, order: [['createdAt', 'DESC']] }),
  ]);
  send(res, 200, {
    task: dto,
    applications: apps.map((x) => ({ id: x.id, applicant: identities.get(String(x.applicantId)) || null, note: x.note || '', status: x.status, removedByMod: !!x.removedByMod, createdAt: iso(x.createdAt) })),
    reports: reports.map((r) => ({ id: r.id, category: r.category, severity: r.severity, status: r.status, isSystem: !!r.isSystem, note: r.note, targetType: r.targetType, createdAt: iso(r.createdAt) })),
    actions: actions.map(audit.serializeAction),
  });
};

// POST /admin/tasks/:id/:action { reason }   action = remove | hide | restore | approve
const adminModerate = async (req, res) => {
  captureIo(req);
  const id = requireUuid(req.params.id, 'task');
  const task = await M('FriendsTask').findByPk(id);
  if (!task) throw fail(404, 'TASK_NOT_FOUND', 'Task not found.');
  const reason = optText((req.body || {}).reason, 300, 'Reason');
  const out = await moderateTask(req.user.id, task, String(req.params.action), reason);
  send(res, 200, { ok: true, actionId: out.row.id, status: out.task.status, modStatus: out.task.modStatus });
};

// POST /admin/tasks/:id/resolve-dispute { outcome: completed|cancelled|in_progress, note }
const adminResolveDispute = async (req, res) => {
  captureIo(req);
  const id = requireUuid(req.params.id, 'task');
  const b = req.body || {};
  const outcome = parseEnum(b.outcome, T.DISPUTE_OUTCOMES, 'outcome', 'INVALID_OUTCOME');
  const note = optText(b.note, T.REASON_MAX, 'Note');
  if (!note || charLen(note) < 5) throw fail(400, 'REASON_REQUIRED', 'Explain the decision to both students (at least 5 characters).');
  const task = await M('FriendsTask').findByPk(id);
  if (!task) throw fail(404, 'TASK_NOT_FOUND', 'Task not found.');
  if (task.status !== 'disputed') throw fail(409, 'NOT_DISPUTED', 'This task is not in dispute.', { status: task.status });
  if (outcome === 'completed') {
    const r = await completeTask(id, { from: ['disputed'], resolution: note });
    if (!r.won) throw conflict(await M('FriendsTask').findByPk(id));
  } else {
    await runTx(async (transaction) => {
      const fields = outcome === 'cancelled'
        ? { status: 'cancelled', cancelledAt: new Date(), cancelledBy: 'moderator', cancelReason: note, disputeResolution: note }
        : { status: 'in_progress', submittedAt: null, disputeResolution: note };
      const [n] = await M('FriendsTask').update(fields, { where: { id, status: 'disputed' }, transaction });
      if (n !== 1) throw conflict(await M('FriendsTask').findByPk(id, { transaction }));
      if (outcome === 'cancelled') await closeConversation(task.conversationId, transaction);
    });
  }
  const fresh = await M('FriendsTask').findByPk(id);
  const row = await audit.record({ actorId: req.user.id, actorRole: 'admin', action: 'resolve', targetType: 'task', targetId: id, reason: note, meta: { outcome, kind: 'dispute' } });
  await closeTaskReports(id, { status: 'actioned', decision: 'resolve', actorId: req.user.id, actionId: row.id, note });
  await notify('MOD_OUTCOME', [fresh.posterId, fresh.helperId], { id: row.id, dedupeKey: `dispute:${row.id}`, data: { kind: 'dispute', taskId: id, outcome } });
  emitTask(fresh, [fresh.posterId, fresh.helperId]);
  send(res, 200, { ok: true, actionId: row.id, task: (await serializeTasks(req, [fresh], null, { admin: true }))[0] });
};

// GET /admin/stats?campusId=
const adminStats = async (req, res) => {
  const campusId = await adminCampus(req.query.campusId);
  const w = (extra) => ({ ...(campusId ? { campusId } : {}), ...extra });
  const since = new Date(Date.now() - DAY);
  const FriendsTask = M('FriendsTask');
  const byStatus = {};
  for (const s of T.TASK_STATUS) byStatus[s] = await FriendsTask.count({ where: w({ status: s }) });
  send(res, 200, {
    byStatus,
    created24h: await FriendsTask.count({ where: w({ createdAt: { [Op.gte]: since } }) }),
    pendingReview: await FriendsTask.count({ where: w({ modStatus: 'pending_review' }) }),
    integrityRejected: await FriendsTask.count({ where: w({ modStatus: 'rejected' }) }),
    removedOrHidden: await FriendsTask.count({ where: w({ modStatus: { [Op.in]: ['removed', 'hidden'] } }) }),
    openDisputes: byStatus.disputed,
  });
};

// POST /admin/jobs/run — runs expiry / auto-confirm / chat-close now.
const adminRunJobs = async (req, res) => {
  captureIo(req);
  const stats = await require('../jobs/taskJobs').runOnce();
  send(res, 200, { ok: true, stats });
};

// ── Unified moderation resolvers ─────────────────────────────────────────────
const sameCampusViewer = async (viewerId, campusId) => {
  if (!viewerId) return true;
  const p = await M('CampusProfile').findOne({ where: { userId: viewerId }, attributes: ['campusId'] });
  return !!p && String(p.campusId) === String(campusId);
};

targets.register('task', {
  statuses: ['pending_review', 'hidden', 'removed', 'visible'],
  async load(id, { viewerId } = {}) {
    if (!isUuid(String(id))) return null;
    const t = await M('FriendsTask').findByPk(id);
    if (!t) return null;
    if (viewerId) {
      if (!(await sameCampusViewer(viewerId, t.campusId))) return null;
      const role = roleOf(t, viewerId);
      if (t.modStatus !== 'visible' && role !== 'poster') return null;
      if (!role && (await blocks.blockedIds(viewerId)).has(String(t.posterId))) return null;
    }
    return {
      ownerId: t.posterId,
      campusId: t.campusId,
      subTab: 'tasks',
      snapshot: {
        excerpt: targets.excerpt(`${t.title}\n${t.description}`),
        mediaIds: (t.media || []).map((m) => m.mediaId),
        anonymous: false,
        status: t.status,
        category: t.category,
        rewardInr: t.rewardInr,
        createdAt: t.createdAt,
      },
    };
  },
  async setStatus(id, status, { transaction } = {}) {
    const t = await setModStatus(id, status, status === 'visible' ? null : 'Moderation decision', { transaction });
    return !!t;
  },
  async currentState(id) {
    const t = await M('FriendsTask').findByPk(id);
    return t ? { exists: true, status: t.status, modStatus: t.modStatus, category: t.category, applicationCount: t.applicationCount, hasHelper: !!t.helperId, disputed: t.status === 'disputed' } : { exists: false };
  },
});

targets.register('task_application', {
  statuses: ['hidden', 'removed', 'visible'],
  // Only the poster of the task can see (and so report) an application.
  async load(id, { viewerId } = {}) {
    if (!isUuid(String(id))) return null;
    const a = await M('FriendsTaskApplication').findByPk(id);
    if (!a) return null;
    const t = await M('FriendsTask').findByPk(a.taskId);
    if (!t) return null;
    if (viewerId && String(t.posterId) !== String(viewerId)) return null;
    return {
      ownerId: a.applicantId,
      campusId: t.campusId,
      subTab: 'tasks',
      snapshot: { excerpt: targets.excerpt(a.note || ''), mediaIds: [], anonymous: false, taskId: t.id, status: a.status, createdAt: a.createdAt },
    };
  },
  async setStatus(id, status, { transaction } = {}) {
    const exec = async (tr) => {
      const a = await M('FriendsTaskApplication').findByPk(id, { transaction: tr });
      if (!a) return false;
      const removed = status !== 'visible';
      await M('FriendsTaskApplication').update({ removedByMod: removed, ...(removed && a.status === 'pending' ? { status: 'rejected', decidedAt: new Date() } : {}) }, { where: { id }, transaction: tr });
      if (removed && a.status === 'selected') {
        await M('FriendsTask').update({ status: 'open', helperId: null, assignedAt: null }, { where: { id: a.taskId, status: 'assigned', helperId: a.applicantId }, transaction: tr });
        await M('FriendsTaskApplication').update({ status: 'rejected', decidedAt: new Date() }, { where: { id, status: 'selected' }, transaction: tr });
      }
      await recountApplications(a.taskId, tr);
      return true;
    };
    return transaction ? exec(transaction) : runTx(exec);
  },
  async currentState(id) {
    const a = await M('FriendsTaskApplication').findByPk(id);
    return a ? { exists: true, status: a.status, removed: !!a.removedByMod } : { exists: false };
  },
});

module.exports = {
  meta,
  board,
  mine,
  getTask,
  reputation,
  createTask,
  updateTask,
  apply,
  withdraw,
  listApplications,
  select,
  accept,
  decline,
  unselect,
  submit,
  confirm,
  rejectSubmission,
  cancel,
  dispute,
  createReview,
  listReviews,
  adminList,
  adminGet,
  adminModerate,
  adminResolveDispute,
  adminStats,
  adminRunJobs,
  // for jobs/taskJobs.js and tests
  _internal: { runTx, completeTask, expireOne, autoConfirmOne, closeConversation, emitTask, autoConfirmDays, stageOf, paymentCheck, setModStatus },
};
