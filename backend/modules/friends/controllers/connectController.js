/**
 * Friends > Connect (Phase 4): /api/campus/connect. Contract: backend_contract.md "Friends (connect)".
 *
 * Optional, verified, 18+, same-campus discovery (dating / friends / study buddy / event buddy).
 *
 * Gate (server only, on top of requireFriends('connect') = verified + campus + not sanctioned + flag):
 *   1. date of birth set and the age computed from it >= 18      403 DOB_REQUIRED / NOT_ADULT
 *   2. Connect consent at the current version                     403 CONSENT_REQUIRED {version}
 *   3. explicit 18+ declaration                                   403 AGE_DECLARATION_REQUIRED
 *   4. liveness passed (CONNECT_REQUIRE_LIVENESS, default true)   403 LIVENESS_REQUIRED / 503 LIVENESS_NOT_CONFIGURED
 *   5. an active, complete profile for discovery and swiping      409 PROFILE_NOT_ACTIVE / PAUSED, 403 PROFILE_REMOVED
 * Consent locks the date of birth (CampusProfiles.dobLockedAt) so it cannot be changed to get in.
 *
 * Privacy: Connect payloads never carry another person's account id, real name, phone, email, avatar or
 * campus profile. Others are addressed by their Connect profile id; photos are private CampusMedia shown
 * through 1-hour signed links, and only after an admin approved them (D5). No GPS anywhere.
 * Matching: one swipe per direction (cs_uq) and one match per pair (cm_pair_uq, ordered pair, insert-or-
 * ignore + "the row with my id won"), so parallel likes create exactly one match and one chat.
 * Chat: an ordinary Conversation (refType 'connect') authorised per event by guards/connectGuard.js;
 * no calls (D6). Unmatch / block / delete stop delivery at once, including on sockets already joined.
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
const flags = require('../services/featureFlags');
const eligibility = require('../services/eligibility');
const liveness = require('../services/liveness');
const deletion = require('../services/connectDeletion');
const { notify } = require('../services/notify');
const { fail, requireUuid, isUuid, isUniqueError } = require('../services/http');
const C = require('../models/connect/enums');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

limiter.define('connect_swipe', 300, DAY);
limiter.define('connect_like', 100, DAY);
limiter.define('connect_like_burst', 30, MIN);
limiter.define('connect_profile', 30, HOUR);
limiter.define('connect_photo', 20, DAY);
limiter.define('connect_consent', 20, HOUR);
limiter.define('connect_liveness_start', 5, DAY);
limiter.define('connect_liveness_submit', 3, DAY);
limiter.define('connect_unmatch', 30, DAY);
limiter.define('connect_block', 30, DAY);
limiter.define('connect_status', 60, HOUR); // pause / resume / activate

const M = (name) => getModel(name);
const send = (res, status, payload) => res.status(status).json(identity.scrub(payload));
const lc = (v) => String(v || '').toLowerCase();
const charLen = (s) => Array.from(String(s || '')).length;
const notifyAdmin = (type, action, id, extra) => {
  try { require('../../../utils/realtime').notifyAdmin(type, action, id, extra); } catch { /* optional */ }
};
const captureIo = (req) => {
  try { deletion.setIo(req.app && req.app.get('io')); } catch { /* optional */ }
};

// ═════════════════════════════════════════════════════════════════════════════
// Connect settings (privacy notice, helplines, Spark prompts): GlobalConfig "friends.connect"
// ═════════════════════════════════════════════════════════════════════════════

const SETTINGS_KEY = 'friends.connect';

const DEFAULT_POLICY = [
  'ZCS Connect — privacy notice',
  '',
  'What Connect is: an optional, 18+ way to meet verified students of your own campus for dating, friendship, study or events. It is off until you turn it on, and you can pause or delete it at any time.',
  '',
  'What we collect for Connect: the Connect profile you write (first name, bio, interests, what you are looking for, which years and branches you hide from), the photos you add, your likes and passes, your matches and Connect chats, your consent records, and — for the selfie check — one selfie taken while doing a random gesture.',
  'What we reuse from your ZCS account: your college verification, campus, year and branch (shown only if you allow it) and your date of birth, from which we show your age in whole years. We never use or show your location.',
  '',
  'Why: only to show your profile to eligible students of your campus, to make matches when two people like each other, to let matches chat, and to keep Connect safe (age and liveness checks, reports, moderation). We do not sell your data, use it for ads, or show it outside Connect.',
  '',
  'Who sees what: other eligible Connect users on your campus see your Connect profile and only the photos a ZCS admin has approved. They never see your full name, phone number, email, room or account details. Photos are served through private links that expire within an hour. ZCS admins can see Connect data only to review photos, selfie checks and reports, and every such access is logged.',
  '',
  'Selfie check: the selfie is used only to confirm that a real person matching your photos made the profile. It is viewed by a ZCS admin and deleted as soon as they decide (or after 30 days if it was never reviewed). We do not build a face template.',
  '',
  'How long we keep it: your Connect profile, photos, likes, matches and chats are deleted when you delete Connect. Chats of ended matches are deleted 30 days after the match ended. Reports you or others filed keep a short text copy as evidence for up to 180 days. A record that you consented and later withdrew is kept as proof of consent.',
  '',
  'Your rights: you can see your Connect data (Connect > Safety > My data), correct it by editing your profile, pause Connect, withdraw consent by deleting Connect, and report or block anyone. Deleting Connect removes your profile from discovery immediately and deletes your Connect data.',
  '',
  'Safety: never share your phone number, address or money details with someone you have not met. Meet in public places on campus. Report anyone who makes you uncomfortable; blocking someone ends the match and they can never contact you through Connect again.',
  '',
  'Grievances: use Report, or write to the ZCS team from the app\'s help section. This notice may change; if a change needs your consent again, Connect will ask you before you can continue.',
].join('\n');

const DEFAULT_HELPLINES = [
  { name: 'Emergency (Police, Fire, Ambulance)', phone: '112', note: 'All-India emergency number, 24x7' },
  { name: 'Tele-MANAS mental health support', phone: '14416', note: 'Free, 24x7, Government of India' },
  { name: 'Women Helpline', phone: '181', note: '24x7' },
  { name: 'National Cyber Crime Helpline', phone: '1930', url: 'https://cybercrime.gov.in', note: 'Report online harassment, blackmail or fraud' },
];

const DEFAULT_GUIDANCE = [
  'Only verified students of your campus who turned Connect on can see you.',
  'Nobody can message you unless you both liked each other.',
  'Keep chats inside ZCS until you trust someone. Never share OTPs, money or intimate photos.',
  'Meet for the first time in a public place on campus and tell a friend where you are.',
  '"No" means no. Unmatching or blocking ends the chat at once, for both of you.',
  'Report anything that feels wrong. Reports are reviewed by people, and the other person is not told who reported them.',
];

const DEFAULT_SPARKS = [
  'What is the best thing you have eaten on campus this week?',
  'Which club or fest would you never miss?',
  'Morning person or late-night study person?',
  'What song is on repeat for you right now?',
  'If you could add one thing to this campus, what would it be?',
  'Best place on campus to clear your head?',
  'What is a subject you secretly enjoy?',
  'Chai or coffee, and from where?',
  'What is something you learned recently that surprised you?',
  'Weekend plan: explore the city or recharge in the hostel?',
  'What would your perfect study playlist have?',
  'Which movie or series could you rewatch forever?',
  'What is one skill you want to pick up before you graduate?',
  'Describe your ideal Sunday in three words.',
  'Which campus event should everyone go to at least once?',
];

let settingsCache = null; // { at, value }

const settingsModel = () => {
  try { return M('GlobalConfig') || require('../../../models/GlobalConfig').getGlobalConfigModel(); } catch { return null; }
};

const mergeSettings = (s) => {
  const v = s && typeof s === 'object' ? s : {};
  return {
    policy: {
      version: Number.isInteger(v.policy && v.policy.version) && v.policy.version >= 1 ? v.policy.version : 1,
      text: v.policy && typeof v.policy.text === 'string' && v.policy.text.trim() ? v.policy.text : DEFAULT_POLICY,
      updatedAt: (v.policy && v.policy.updatedAt) || null,
    },
    helplines: Array.isArray(v.helplines) ? v.helplines : DEFAULT_HELPLINES,
    campusHelplines: v.campusHelplines && typeof v.campusHelplines === 'object' ? v.campusHelplines : {},
    sparkPrompts: Array.isArray(v.sparkPrompts) && v.sparkPrompts.length ? v.sparkPrompts : DEFAULT_SPARKS,
    guidance: Array.isArray(v.guidance) && v.guidance.length ? v.guidance : DEFAULT_GUIDANCE,
  };
};

const getSettings = async ({ fresh = false } = {}) => {
  if (!fresh && settingsCache && Date.now() - settingsCache.at < 30 * 1000) return settingsCache.value;
  let stored = null;
  try {
    const GC = settingsModel();
    const row = GC ? await GC.findOne({ where: { key: SETTINGS_KEY } }) : null;
    stored = row ? row.value : null;
    if (typeof stored === 'string') { try { stored = JSON.parse(stored); } catch { stored = null; } }
  } catch (err) {
    console.warn('[CONNECT_SETTINGS_WARN]', err.message);
  }
  const value = mergeSettings(stored);
  settingsCache = { at: Date.now(), value };
  return value;
};

const policyUrl = () => {
  const u = String(process.env.FRIENDS_POLICY_URL || '').trim();
  return /^https:\/\//i.test(u) ? u : null;
};

const helplinesFor = (settings, campusId) => [
  ...((campusId && Array.isArray(settings.campusHelplines[campusId])) ? settings.campusHelplines[campusId] : []),
  ...settings.helplines,
];

// ═════════════════════════════════════════════════════════════════════════════
// Helpers
// ═════════════════════════════════════════════════════════════════════════════

/** Whole years from a DATEONLY / Date; null when unknown or invalid. */
const ageFrom = (dob, now = new Date()) => {
  if (!dob) return null;
  const d = new Date(typeof dob === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dob) ? `${dob}T00:00:00Z` : dob);
  if (Number.isNaN(d.getTime())) return null;
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age--;
  return age >= 0 && age < 120 ? age : null;
};

const orderedPair = (a, b) => (lc(a) < lc(b) ? [lc(a), lc(b)] : [lc(b), lc(a)]);

const signedPhotoUrl = (req, mediaId) => {
  if (!mediaId) return null;
  try {
    return require('../../campus/controllers/mediaController').signedMediaUrl(req, `/api/campus/media/${mediaId}`);
  } catch {
    return null;
  }
};

const ipHash = (req) => {
  const ip = String((req && (req.ip || (req.socket && req.socket.remoteAddress))) || '');
  if (!ip) return null;
  return crypto.createHmac('sha256', `friends-consent:${process.env.JWT_SECRET || ''}`).update(ip).digest('hex');
};

const normBranch = (b) => String(b || '').trim().toUpperCase();

const istDate = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

const sparkFor = (settings, matchId, date = istDate()) => {
  const list = settings.sparkPrompts;
  const h = crypto.createHash('sha256').update(`${matchId}|${date}`).digest();
  return { date, prompt: list[h.readUInt32BE(0) % list.length] };
};

const activeSanctionFor = async (userIds) => {
  const FriendsSanction = M('FriendsSanction');
  if (!FriendsSanction || !userIds.length) return new Set();
  const rows = await FriendsSanction.findAll({
    where: {
      userId: { [Op.in]: userIds },
      scope: { [Op.in]: ['friends', 'connect'] },
      liftedAt: null,
      [Op.or]: [{ until: null }, { until: { [Op.gt]: new Date() } }],
    },
    attributes: ['userId'],
  });
  return new Set(rows.map((r) => String(r.userId)));
};

// ═════════════════════════════════════════════════════════════════════════════
// Gate
// ═════════════════════════════════════════════════════════════════════════════

const ctxOf = (req) => (req.friends && req.friends.ctx) || null;
const cfgOf = (req) => (req.friends && req.friends.cfg) || flags.peekConfig();

const myProfile = (userId, opts = {}) => M('ConnectProfile').findOne({ where: { userId: String(userId) }, ...opts });

const consentCurrent = (profile, cfg) => !!profile && Number(profile.consentVersion) >= cfg.connectConsentVersion && !!profile.consentAt;

/**
 * Every reason this user cannot use Connect discovery right now, most fundamental first.
 * Stage: 'age' -> 'consent' -> 'liveness' -> 'profile' -> 'ready'.
 */
const connectReasons = (ctx, cfg, profile) => {
  const reasons = [];
  const age = ctx.profile ? ageFrom(ctx.profile.dob) : null;
  if (!ctx.profile || !ctx.profile.dob || age === null) reasons.push('DOB_REQUIRED');
  else if (age < C.MIN_AGE) reasons.push('NOT_ADULT');
  if (!consentCurrent(profile, cfg)) reasons.push('CONSENT_REQUIRED');
  if (!profile || !profile.ageDeclaredAt) reasons.push('AGE_DECLARATION_REQUIRED');
  const lv = liveness.describe();
  if (lv.required) {
    if (!profile || profile.livenessStatus !== 'passed') reasons.push(lv.configured ? 'LIVENESS_REQUIRED' : 'LIVENESS_NOT_CONFIGURED');
  }
  if (profile && ['removed', 'hidden'].includes(profile.modStatus)) reasons.push('PROFILE_REMOVED');
  if (!profile || !profile.displayName || !(profile.lookingFor || []).length) reasons.push('PROFILE_INCOMPLETE');
  if (!profile || profile.status === 'setup') reasons.push('PROFILE_NOT_ACTIVE');
  else if (profile.status === 'paused') reasons.push('PAUSED');
  return reasons;
};

const stageOf = (reasons) => {
  if (reasons.includes('DOB_REQUIRED') || reasons.includes('NOT_ADULT')) return 'age';
  if (reasons.includes('CONSENT_REQUIRED') || reasons.includes('AGE_DECLARATION_REQUIRED')) return 'consent';
  if (reasons.includes('LIVENESS_REQUIRED') || reasons.includes('LIVENESS_NOT_CONFIGURED')) return 'liveness';
  if (reasons.includes('PROFILE_REMOVED')) return 'removed';
  if (reasons.includes('PROFILE_INCOMPLETE') || reasons.includes('PROFILE_NOT_ACTIVE')) return 'profile';
  if (reasons.includes('PAUSED')) return 'paused';
  return 'ready';
};

const assertAdult = (ctx) => {
  const age = ctx.profile ? ageFrom(ctx.profile.dob) : null;
  if (!ctx.profile || !ctx.profile.dob || age === null) {
    throw fail(403, 'DOB_REQUIRED', 'Add your date of birth in your campus profile to use Connect.');
  }
  if (age < C.MIN_AGE) throw fail(403, 'NOT_ADULT', 'Connect is only for students who are 18 or older.');
};

const assertConsent = (profile, cfg) => {
  if (!consentCurrent(profile, cfg)) {
    throw fail(403, 'CONSENT_REQUIRED', 'Please read and accept the Connect consent first.', { version: cfg.connectConsentVersion });
  }
  if (!profile.ageDeclaredAt) throw fail(403, 'AGE_DECLARATION_REQUIRED', 'Please confirm that you are 18 or older.');
};

const assertLiveness = (profile) => {
  const lv = liveness.describe();
  if (!lv.required) return;
  if (!lv.configured) throw fail(503, 'LIVENESS_NOT_CONFIGURED', "The selfie check isn't available yet, so Connect can't be used. Please check back later.");
  if (profile.livenessStatus !== 'passed') {
    throw fail(403, 'LIVENESS_REQUIRED', 'Complete the selfie check to use Connect.', { livenessStatus: profile.livenessStatus });
  }
};

const assertNotRemoved = (profile) => {
  if (['removed', 'hidden'].includes(profile.modStatus)) {
    throw fail(403, 'PROFILE_REMOVED', 'Your Connect profile was taken down by a moderator. You can appeal from Friends privacy & safety.');
  }
};

/** adult + consent (+ the profile row). For profile, photos, liveness. */
const gateSetup = async (req, opts = {}) => {
  const ctx = ctxOf(req);
  const cfg = cfgOf(req);
  assertAdult(ctx);
  const profile = await myProfile(req.user.id, opts);
  assertConsent(profile, cfg);
  return { ctx, cfg, profile };
};

/** Everything, plus an active profile. For discovery, swiping and matches. */
const gateReady = async (req, { allowPaused = false } = {}) => {
  const g = await gateSetup(req);
  assertLiveness(g.profile);
  assertNotRemoved(g.profile);
  if (g.profile.status === 'setup') throw fail(409, 'PROFILE_NOT_ACTIVE', 'Finish and turn on your Connect profile first.');
  if (g.profile.status === 'paused' && !allowPaused) throw fail(409, 'PAUSED', 'Connect is paused. Resume it to see people.');
  return g;
};

// ═════════════════════════════════════════════════════════════════════════════
// Who may see whom
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Loads the campus side of many users and returns userId -> { ready, age, year, branch, campusId }
 * where ready = active account + verified on that campus + 18+ + no Connect / Friends sanction.
 */
const loadCandidateInfo = async (userIds) => {
  const ids = [...new Set(userIds.map(String))];
  const out = new Map();
  if (!ids.length) return out;
  const [users, cps, sanctioned] = await Promise.all([
    M('User').findAll({ where: { id: { [Op.in]: ids } }, attributes: ['id', 'isActive'] }),
    M('CampusProfile').findAll({ where: { userId: { [Op.in]: ids } }, attributes: ['userId', 'campusId', 'verificationStatus', 'dob', 'year', 'branch'] }),
    activeSanctionFor(ids),
  ]);
  const activeUsers = new Set(users.filter((u) => u.isActive !== false).map((u) => String(u.id)));
  for (const cp of cps) {
    const id = String(cp.userId);
    const age = ageFrom(cp.dob);
    out.set(id, {
      campusId: cp.campusId ? String(cp.campusId) : null,
      age,
      year: cp.year || null,
      branch: cp.branch || null,
      ready: activeUsers.has(id) && cp.verificationStatus === 'verified' && !!cp.campusId && age !== null && age >= C.MIN_AGE && !sanctioned.has(id),
    });
  }
  return out;
};

/** Is this Connect profile complete, consented, checked and switched on? (for being discoverable) */
const profileDiscoverable = (p, cfg) => !!p && p.status === 'active' && p.modStatus === 'visible'
  && consentCurrent(p, cfg) && !!p.ageDeclaredAt && !!p.displayName
  && (!liveness.required() || p.livenessStatus === 'passed');

/** Hidden in either direction (branch / year lists). */
const hiddenBetween = (viewerProfile, viewerInfo, target, targetInfo) => {
  const tb = (target.hiddenBranches || []).map(normBranch);
  const ty = (target.hiddenYears || []).map(Number);
  const vb = (viewerProfile.hiddenBranches || []).map(normBranch);
  const vy = (viewerProfile.hiddenYears || []).map(Number);
  if (viewerInfo.branch && tb.includes(normBranch(viewerInfo.branch))) return true;
  if (viewerInfo.year && ty.includes(Number(viewerInfo.year))) return true;
  if (targetInfo.branch && vb.includes(normBranch(targetInfo.branch))) return true;
  if (targetInfo.year && vy.includes(Number(targetInfo.year))) return true;
  return false;
};

const activeMatchBetween = async (a, b) => {
  const [low, high] = orderedPair(a, b);
  return M('ConnectMatch').findOne({ where: { userLowId: low, userHighId: high, status: 'active' } });
};

/**
 * May viewer (a Connect user) see target's profile and approved photos?
 * True for: the owner, an active match, or a current discovery candidate (both discoverable, same
 * campus, not blocked, not hidden either way).
 */
const canView = async (viewerId, target, cfg) => {
  if (!target) return false;
  const v = String(viewerId);
  const t = String(target.userId);
  if (v === t) return true;
  // A profile a moderator hid / removed is not shown to anyone but its owner (matches included).
  if (target.modStatus && target.modStatus !== 'visible') return false;
  if (await blocks.isBlocked(v, t)) return false;
  if (await activeMatchBetween(v, t)) return true;
  const viewerProfile = await myProfile(v);
  if (!profileDiscoverable(viewerProfile, cfg) || !profileDiscoverable(target, cfg)) return false;
  const info = await loadCandidateInfo([v, t]);
  const vi = info.get(v);
  const ti = info.get(t);
  if (!vi || !ti || !vi.ready || !ti.ready || !vi.campusId || vi.campusId !== ti.campusId) return false;
  if (String(target.campusId) !== vi.campusId) return false;
  return !hiddenBetween(viewerProfile, vi, target, ti);
};

// ═════════════════════════════════════════════════════════════════════════════
// Serializers (the only shapes that leave this file)
// ═════════════════════════════════════════════════════════════════════════════

const approvedPhotos = async (userIds) => {
  const out = new Map();
  if (!userIds.length) return out;
  const rows = await M('ConnectPhoto').findAll({
    where: { userId: { [Op.in]: userIds.map(String) }, status: 'approved', mediaId: { [Op.ne]: null } },
    order: [['position', 'ASC']],
  });
  rows.forEach((r) => {
    const k = String(r.userId);
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(r);
  });
  return out;
};

/** What another Connect user sees. No account id, real name, contact or avatar. */
const cardOf = (req, p, info, photos) => ({
  profileId: p.id,
  displayName: p.displayName,
  age: info ? info.age : null,
  ...(p.showYear && info && info.year ? { year: info.year } : {}),
  ...(p.showBranch && info && info.branch ? { branch: info.branch } : {}),
  bio: p.bio || '',
  interests: p.interests || [],
  lookingFor: p.lookingFor || [],
  photos: (photos || []).map((ph) => ({ id: ph.id, url: signedPhotoUrl(req, ph.mediaId) })),
});

const myPhotoDto = (req, ph) => ({
  id: ph.id,
  position: ph.position,
  status: ph.status,
  rejectReason: ph.status === 'rejected' ? ph.rejectReason || null : null,
  url: ph.mediaId ? signedPhotoUrl(req, ph.mediaId) : null,
  createdAt: ph.createdAt,
});

const livenessDto = (p) => {
  const lv = liveness.describe();
  const challengeOpen = p && p.livenessChallenge && p.livenessChallengeAt
    && Date.now() - new Date(p.livenessChallengeAt).getTime() < require('../services/liveness/manual').CHALLENGE_TTL_MS;
  return {
    required: lv.required,
    configured: lv.configured,
    mode: lv.mode,
    status: p ? p.livenessStatus : 'none',
    note: p && p.livenessStatus === 'failed' ? p.livenessNote || null : (p && p.livenessStatus === 'none' ? p.livenessNote || null : null),
    submittedAt: p ? p.livenessSubmittedAt || null : null,
    checkedAt: p ? p.livenessCheckedAt || null : null,
    challenge: challengeOpen && p.livenessStatus !== 'passed' && p.livenessStatus !== 'pending' ? {
      text: p.livenessChallenge,
      expiresAt: new Date(new Date(p.livenessChallengeAt).getTime() + require('../services/liveness/manual').CHALLENGE_TTL_MS).toISOString(),
    } : null,
  };
};

const mineDto = async (req, p, ctx) => {
  if (!p) return null;
  const photos = await M('ConnectPhoto').findAll({ where: { userId: p.userId }, order: [['position', 'ASC']] });
  return {
    profileId: p.id,
    status: p.status,
    underReview: p.modStatus === 'pending_review',
    removed: ['removed', 'hidden'].includes(p.modStatus),
    displayName: p.displayName || '',
    bio: p.bio || '',
    interests: p.interests || [],
    lookingFor: p.lookingFor || [],
    showYear: !!p.showYear,
    showBranch: !!p.showBranch,
    hiddenBranches: p.hiddenBranches || [],
    hiddenYears: p.hiddenYears || [],
    // What others would see from the verified campus profile.
    age: ctx && ctx.profile ? ageFrom(ctx.profile.dob) : null,
    year: ctx && ctx.profile ? ctx.profile.year || null : null,
    branch: ctx && ctx.profile ? ctx.profile.branch || null : null,
    photos: photos.map((ph) => myPhotoDto(req, ph)),
    liveness: livenessDto(p),
    consentVersion: p.consentVersion,
    consentAt: p.consentAt,
    ageDeclaredAt: p.ageDeclaredAt,
    activatedAt: p.activatedAt,
    pausedAt: p.pausedAt,
  };
};

// ═════════════════════════════════════════════════════════════════════════════
// Status, policy, consent
// ═════════════════════════════════════════════════════════════════════════════

// GET /status
const status = async (req, res) => {
  const ctx = ctxOf(req);
  const cfg = cfgOf(req);
  const [profile, settings] = await Promise.all([myProfile(req.user.id), getSettings()]);
  const reasons = connectReasons(ctx, cfg, profile);
  send(res, 200, {
    eligible: reasons.length === 0,
    reasons,
    stage: stageOf(reasons),
    profile: await mineDto(req, profile, ctx),
    consent: {
      version: cfg.connectConsentVersion,
      accepted: consentCurrent(profile, cfg),
      acceptedVersion: profile ? profile.consentVersion || null : null,
      ageDeclared: !!(profile && profile.ageDeclaredAt),
    },
    dob: { set: !!(ctx.profile && ctx.profile.dob), locked: !!(ctx.profile && ctx.profile.dobLockedAt) },
    liveness: livenessDto(profile),
    policy: { version: settings.policy.version, url: policyUrl(), inApp: true },
    policyUrl: policyUrl(),
    consentVersion: cfg.connectConsentVersion,
    helplines: helplinesFor(settings, ctx.profile && ctx.profile.campusId),
    guidance: settings.guidance,
    lookingForOptions: C.LOOKING_FOR.map((k) => ({ key: k, label: C.LOOKING_FOR_LABELS[k] })),
    limits: {
      interestsMax: C.INTERESTS_MAX,
      bioMax: C.BIO_MAX,
      displayNameMax: C.DISPLAY_NAME_MAX,
      photosMax: C.PHOTOS_MAX,
      hiddenBranchesMax: C.HIDDEN_BRANCHES_MAX,
      likesPerDay: limiter.LIMITS.connect_like.max,
      swipesPerDay: limiter.LIMITS.connect_swipe.max,
    },
    callsEnabled: false,
  });
};

// GET /policy — the in-app privacy notice (until the owner hosts one at FRIENDS_POLICY_URL).
const policy = async (req, res) => {
  const ctx = ctxOf(req);
  const settings = await getSettings();
  send(res, 200, {
    version: settings.policy.version,
    text: settings.policy.text,
    updatedAt: settings.policy.updatedAt,
    url: policyUrl(),
    consentVersion: cfgOf(req).connectConsentVersion,
    helplines: helplinesFor(settings, ctx.profile && ctx.profile.campusId),
    guidance: settings.guidance,
  });
};

const recordConsent = async (userId, kind, version, req, transaction) => {
  const FriendsConsent = M('FriendsConsent');
  const existing = await FriendsConsent.findOne({ where: { userId, kind, version, withdrawnAt: null }, transaction });
  if (existing) return existing;
  return FriendsConsent.create({ userId, kind, version, acceptedAt: new Date(), ipHash: ipHash(req) }, { transaction });
};

const defaultDisplayName = (ctx) => {
  const first = String((ctx.user && ctx.user.name) || '').trim().split(/\s+/)[0] || '';
  const clean = first.replace(/[^\p{L}\p{M}' -]/gu, '').slice(0, C.DISPLAY_NAME_MAX);
  return charLen(clean) >= C.DISPLAY_NAME_MIN ? clean : null;
};

// POST /consent {version, ageConfirmed:true, livenessConsent?}
const consent = async (req, res) => {
  const me = String(req.user.id);
  const ctx = ctxOf(req);
  const cfg = cfgOf(req);
  assertAdult(ctx);
  const b = req.body || {};
  if (b.version !== cfg.connectConsentVersion) {
    throw fail(409, 'CONSENT_VERSION_MISMATCH', 'The Connect consent was updated. Please read it again.', { version: cfg.connectConsentVersion });
  }
  if (b.ageConfirmed !== true) throw fail(400, 'AGE_CONFIRMATION_REQUIRED', 'Please confirm that you are 18 or older.');
  limiter.enforce(me, 'connect_consent');
  const now = new Date();
  const out = await deletion.runTx(async (transaction) => {
    let profile = await myProfile(me, { transaction });
    const duplicate = !!profile && consentCurrent(profile, cfg) && !!profile.ageDeclaredAt && !(b.livenessConsent === true);
    await recordConsent(me, 'connect', cfg.connectConsentVersion, req, transaction);
    await recordConsent(me, 'connect_age_declaration', cfg.connectConsentVersion, req, transaction);
    if (b.livenessConsent === true) await recordConsent(me, 'liveness', cfg.connectConsentVersion, req, transaction);
    if (!profile) {
      try {
        profile = await M('ConnectProfile').create({
          userId: me,
          campusId: ctx.profile.campusId,
          status: 'setup',
          displayName: defaultDisplayName(ctx),
          consentVersion: cfg.connectConsentVersion,
          consentAt: now,
          ageDeclaredAt: now,
        }, { transaction });
      } catch (err) {
        if (!isUniqueError(err)) throw err;
        profile = await myProfile(me, { transaction });
      }
    }
    if (!consentCurrent(profile, cfg) || !profile.ageDeclaredAt || String(profile.campusId) !== String(ctx.profile.campusId)) {
      await M('ConnectProfile').update(
        { consentVersion: cfg.connectConsentVersion, consentAt: now, ageDeclaredAt: profile.ageDeclaredAt || now, campusId: ctx.profile.campusId },
        { where: { id: profile.id }, transaction },
      );
    }
    // Lock the date of birth so it cannot be edited to get into (or stay in) Connect.
    await M('CampusProfile').update({ dobLockedAt: now }, { where: { userId: me, dobLockedAt: null }, transaction });
    return { duplicate };
  });
  eligibility.clearEligibility(me);
  const fresh = await myProfile(me);
  send(res, out.duplicate ? 200 : 201, { accepted: true, version: cfg.connectConsentVersion, duplicate: out.duplicate, profile: await mineDto(req, fresh, ctx) });
};

// ═════════════════════════════════════════════════════════════════════════════
// Profile
// ═════════════════════════════════════════════════════════════════════════════

const PROFILE_KEYS = ['displayName', 'bio', 'interests', 'lookingFor', 'showYear', 'showBranch', 'hiddenBranches', 'hiddenYears'];

/** Validates a profile patch; returns { fields, text } (text = everything others will read). */
const validateProfile = (body) => {
  const b = body && typeof body === 'object' ? body : {};
  const fields = {};
  if (b.displayName !== undefined) {
    if (typeof b.displayName !== 'string') throw fail(400, 'INVALID_INPUT', 'Name must be text.', { field: 'displayName' });
    const v = b.displayName.trim().replace(/\s+/g, ' ');
    if (charLen(v) < C.DISPLAY_NAME_MIN) throw fail(400, 'TOO_SHORT', `Name needs at least ${C.DISPLAY_NAME_MIN} characters.`, { field: 'displayName', min: C.DISPLAY_NAME_MIN });
    if (charLen(v) > C.DISPLAY_NAME_MAX) throw fail(400, 'TOO_LONG', `Name can be at most ${C.DISPLAY_NAME_MAX} characters.`, { field: 'displayName', max: C.DISPLAY_NAME_MAX });
    if (!/^[\p{L}\p{M}' .-]+$/u.test(v)) throw fail(400, 'INVALID_NAME', 'Use letters only in your Connect name.', { field: 'displayName' });
    fields.displayName = v;
  }
  if (b.bio !== undefined) {
    if (b.bio !== null && typeof b.bio !== 'string') throw fail(400, 'INVALID_INPUT', 'Bio must be text.', { field: 'bio' });
    const v = (b.bio || '').trim();
    if (charLen(v) > C.BIO_MAX) throw fail(400, 'TOO_LONG', `Bio can be at most ${C.BIO_MAX} characters.`, { field: 'bio', max: C.BIO_MAX });
    fields.bio = v || null;
  }
  if (b.interests !== undefined) {
    const list = b.interests;
    if (!Array.isArray(list) || list.length > C.INTERESTS_MAX || list.some((x) => typeof x !== 'string' || charLen(x.trim()) < C.INTEREST_MIN || charLen(x.trim()) > C.INTEREST_MAX)) {
      throw fail(400, 'INVALID_INTERESTS', `Pick up to ${C.INTERESTS_MAX} interests of ${C.INTEREST_MIN}-${C.INTEREST_MAX} characters.`, { field: 'interests', max: C.INTERESTS_MAX });
    }
    const seen = new Set();
    fields.interests = list.map((x) => x.trim().replace(/\s+/g, ' ')).filter((x) => {
      const k = x.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  if (b.lookingFor !== undefined) {
    const list = b.lookingFor;
    if (!Array.isArray(list) || !list.length || list.some((x) => !C.LOOKING_FOR.includes(x))) {
      throw fail(400, 'INVALID_LOOKING_FOR', 'Choose what you are looking for: dating, friends, study or event.', { field: 'lookingFor', allowed: C.LOOKING_FOR });
    }
    fields.lookingFor = [...new Set(list)];
  }
  for (const k of ['showYear', 'showBranch']) {
    if (b[k] !== undefined) {
      if (typeof b[k] !== 'boolean') throw fail(400, 'INVALID_INPUT', `${k} must be true or false.`, { field: k });
      fields[k] = b[k];
    }
  }
  if (b.hiddenBranches !== undefined) {
    const list = b.hiddenBranches;
    if (!Array.isArray(list) || list.length > C.HIDDEN_BRANCHES_MAX || list.some((x) => typeof x !== 'string' || !x.trim() || x.length > 50)) {
      throw fail(400, 'INVALID_HIDDEN', `Hide up to ${C.HIDDEN_BRANCHES_MAX} branches.`, { field: 'hiddenBranches' });
    }
    fields.hiddenBranches = [...new Set(list.map(normBranch))];
  }
  if (b.hiddenYears !== undefined) {
    const list = b.hiddenYears;
    if (!Array.isArray(list) || list.length > C.HIDDEN_YEARS_MAX || list.some((x) => !Number.isInteger(x) || x < C.YEAR_MIN || x > C.YEAR_MAX)) {
      throw fail(400, 'INVALID_HIDDEN', `Hidden years must be whole numbers ${C.YEAR_MIN}-${C.YEAR_MAX}.`, { field: 'hiddenYears' });
    }
    fields.hiddenYears = [...new Set(list)];
  }
  const text = [fields.displayName, fields.bio, ...(fields.interests || [])].filter(Boolean).join('\n');
  return { fields, text };
};

/** Applies a validated patch (content policy included). Returns { profile, underReview }. */
const applyProfilePatch = async (req, profile, body) => {
  const { fields, text } = validateProfile(body);
  const unknown = Object.keys(body || {}).filter((k) => !PROFILE_KEYS.includes(k));
  if (unknown.length) throw fail(400, 'UNKNOWN_FIELDS', 'Some fields cannot be changed here.', { fields: unknown });
  let underReview = false;
  if (text) {
    const r = contentPolicy.enforce(text, { kind: 'bio' });
    if (fields.bio && require('../guards/connectGuard').explicitCheck(fields.bio)) {
      throw fail(422, 'CONTENT_BLOCKED', 'Your profile has text that is not allowed in Connect.', { reasons: ['EXPLICIT'] });
    }
    if (r.decision === 'flag') underReview = true;
  }
  if (!Object.keys(fields).length) return { profile, underReview: false };
  if (underReview && profile.modStatus === 'visible') fields.modStatus = 'pending_review';
  await M('ConnectProfile').update(fields, { where: { id: profile.id } });
  if (underReview) {
    await reportsSvc.fileSystemReport({ targetType: 'connect_profile', targetId: profile.id, category: 'other', note: 'Connect profile text flagged by the content policy' });
  }
  return { profile: await M('ConnectProfile').findByPk(profile.id), underReview };
};

// PATCH|PUT /profile
const updateProfile = async (req, res) => {
  const me = req.user.id;
  const { ctx, profile } = await gateSetup(req);
  assertNotRemoved(profile);
  limiter.enforce(me, 'connect_profile');
  const out = await applyProfilePatch(req, profile, req.body);
  send(res, 200, { profile: await mineDto(req, out.profile, ctx), underReview: out.underReview });
};

// POST /activate {...optional profile fields}
const activate = async (req, res) => {
  captureIo(req);
  const me = req.user.id;
  const g = await gateSetup(req);
  assertNotRemoved(g.profile);
  limiter.enforce(me, 'connect_status');
  let profile = g.profile;
  const patch = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => PROFILE_KEYS.includes(k)));
  if (Object.keys(patch).length) profile = (await applyProfilePatch(req, profile, patch)).profile;
  assertLiveness(profile);
  if (!profile.displayName) throw fail(400, 'PROFILE_INCOMPLETE', 'Add the name you want to show in Connect.', { field: 'displayName' });
  if (!(profile.lookingFor || []).length) throw fail(400, 'PROFILE_INCOMPLETE', 'Choose what you are looking for.', { field: 'lookingFor' });
  if (profile.status === 'active') return send(res, 200, { profile: await mineDto(req, profile, g.ctx), duplicate: true });
  const now = new Date();
  await M('ConnectProfile').update(
    { status: 'active', activatedAt: profile.activatedAt || now, pausedAt: null, lastActiveAt: now },
    { where: { id: profile.id, status: { [Op.in]: ['setup', 'paused'] } } },
  );
  const fresh = await M('ConnectProfile').findByPk(profile.id);
  send(res, 200, { profile: await mineDto(req, fresh, g.ctx), duplicate: false });
};

// POST /pause (also when the flag is off or the user is sanctioned: pausing is always allowed)
const pause = async (req, res) => {
  const me = req.user.id;
  const profile = await myProfile(me);
  if (!profile) throw fail(404, 'NO_PROFILE', 'You have not turned on Connect.');
  if (profile.status === 'paused') return send(res, 200, { status: 'paused', duplicate: true });
  await M('ConnectProfile').update({ status: 'paused', pausedAt: new Date() }, { where: { id: profile.id } });
  send(res, 200, { status: 'paused', duplicate: false });
};

// POST /resume
const resume = async (req, res) => {
  const me = req.user.id;
  const g = await gateSetup(req);
  assertLiveness(g.profile);
  assertNotRemoved(g.profile);
  limiter.enforce(me, 'connect_status');
  if (g.profile.status === 'active') return send(res, 200, { status: 'active', duplicate: true });
  if (g.profile.status !== 'paused') throw fail(409, 'PROFILE_NOT_ACTIVE', 'Finish and turn on your Connect profile first.');
  await M('ConnectProfile').update({ status: 'active', pausedAt: null, lastActiveAt: new Date() }, { where: { id: g.profile.id, status: 'paused' } });
  send(res, 200, { status: 'active', duplicate: false });
};

// DELETE /profile — always allowed (DPDP: withdrawal of consent = deletion), even with the flag off.
const deleteProfile = async (req, res) => {
  captureIo(req);
  const me = String(req.user.id);
  const summary = await deletion.deleteConnectData(me);
  await audit.recordSafe({ actorId: me, actorRole: 'self', action: 'delete_self', targetType: 'connect_profile', subjectUserId: me, meta: { summary } });
  eligibility.clearEligibility(me);
  send(res, 200, { deleted: true, summary, retained: ['Reports filed about Connect content keep a short text copy as evidence.', 'A record that you consented and withdrew is kept as proof of consent.'] });
};

// GET /me/data — right of access: everything Connect holds about me (no one else's identity).
const myData = async (req, res) => {
  const me = String(req.user.id);
  const profile = await myProfile(me);
  const [photos, likes, passes, likedBy, matches, consents] = await Promise.all([
    M('ConnectPhoto').findAll({ where: { userId: me }, order: [['position', 'ASC']] }),
    M('ConnectSwipe').count({ where: { fromUserId: me, action: 'like' } }),
    M('ConnectSwipe').count({ where: { fromUserId: me, action: 'pass' } }),
    M('ConnectSwipe').count({ where: { toUserId: me, action: 'like' } }),
    M('ConnectMatch').findAll({ where: { [Op.or]: [{ userLowId: me }, { userHighId: me }] }, attributes: ['id', 'status', 'matchedAt', 'endedAt'] }),
    M('FriendsConsent').findAll({ where: { userId: me, kind: { [Op.in]: ['connect', 'connect_age_declaration', 'liveness'] } }, order: [['createdAt', 'ASC']] }),
  ]);
  send(res, 200, {
    profile: profile ? {
      profileId: profile.id, status: profile.status, displayName: profile.displayName, bio: profile.bio, interests: profile.interests,
      lookingFor: profile.lookingFor, showYear: profile.showYear, showBranch: profile.showBranch, hiddenBranches: profile.hiddenBranches,
      hiddenYears: profile.hiddenYears, livenessStatus: profile.livenessStatus, consentVersion: profile.consentVersion,
      consentAt: profile.consentAt, ageDeclaredAt: profile.ageDeclaredAt, activatedAt: profile.activatedAt, createdAt: profile.createdAt,
    } : null,
    photos: photos.map((ph) => myPhotoDto(req, ph)),
    swipes: { likesGiven: likes, passesGiven: passes, likesReceived: likedBy },
    matches: matches.map((m) => ({ id: m.id, status: m.status, matchedAt: m.matchedAt, endedAt: m.endedAt })),
    consents: consents.map((c) => ({ kind: c.kind, version: c.version, acceptedAt: c.acceptedAt, withdrawnAt: c.withdrawnAt })),
    selfieStored: !!(profile && profile.livenessMediaId),
    location: 'Connect never collects your location.',
  });
};

// ═════════════════════════════════════════════════════════════════════════════
// Photos (private, admin-approved: D5)
// ═════════════════════════════════════════════════════════════════════════════

// POST /photos {mediaId, position}
const addPhoto = async (req, res) => {
  const me = String(req.user.id);
  const { ctx, profile } = await gateSetup(req);
  assertNotRemoved(profile);
  const b = req.body || {};
  const mediaId = requireUuid(b.mediaId, 'photo');
  const position = b.position === undefined ? null : b.position;
  if (position !== null && (!Number.isInteger(position) || position < 0 || position >= C.PHOTOS_MAX)) {
    throw fail(400, 'INVALID_POSITION', `Photo position must be 0-${C.PHOTOS_MAX - 1}.`);
  }
  const media = await M('CampusMedia').findByPk(mediaId, { attributes: ['id', 'ownerId', 'purpose', 'isPrivate', 'mime'] });
  if (!media || String(media.ownerId) !== me || media.purpose !== 'connect' || !media.isPrivate) {
    throw fail(400, 'INVALID_MEDIA', 'Upload the photo for Connect first, then add it.');
  }
  if (await M('ConnectPhoto').findOne({ where: { mediaId } })) throw fail(409, 'PHOTO_IN_USE', 'That photo is already on your profile.');
  limiter.enforce(me, 'connect_photo');
  const out = await deletion.runTx(async (transaction) => {
    const existing = await M('ConnectPhoto').findAll({ where: { userId: me }, transaction });
    let pos = position;
    if (pos === null) {
      const used = new Set(existing.map((p) => p.position));
      pos = [...Array(C.PHOTOS_MAX).keys()].find((i) => !used.has(i));
      if (pos === undefined) throw fail(409, 'TOO_MANY_PHOTOS', `You can have at most ${C.PHOTOS_MAX} photos. Replace or delete one.`);
    }
    const old = existing.find((p) => p.position === pos);
    if (old) {
      await M('ConnectPhoto').destroy({ where: { id: old.id }, transaction });
      if (old.mediaId) await M('CampusMedia').destroy({ where: { id: old.mediaId, ownerId: me }, transaction });
    }
    const photo = await M('ConnectPhoto').create({ userId: me, mediaId, position: pos, status: 'pending' }, { transaction });
    return { photo, replaced: !!old };
  });
  notifyAdmin('friends_review', 'created', out.photo.id, { scope: 'connect_photo' });
  send(res, 201, { photo: myPhotoDto(req, out.photo), replaced: out.replaced, profile: await mineDto(req, await myProfile(me), ctx) });
};

// DELETE /photos/:id (owner only; the bytes are deleted too)
const deletePhoto = async (req, res) => {
  const me = String(req.user.id);
  const id = requireUuid(req.params.id, 'photo');
  const photo = await M('ConnectPhoto').findByPk(id);
  if (!photo || String(photo.userId) !== me) throw fail(404, 'PHOTO_NOT_FOUND', 'Photo not found.');
  await deletion.runTx(async (transaction) => {
    await M('ConnectPhoto').destroy({ where: { id }, transaction });
    if (photo.mediaId) await M('CampusMedia').destroy({ where: { id: photo.mediaId, ownerId: me }, transaction });
  });
  send(res, 200, { deleted: true });
};

// GET /photos/:id — 302 to a 1-hour signed link, only for someone allowed to see it.
const viewPhoto = async (req, res) => {
  const me = String(req.user.id);
  const id = requireUuid(req.params.id, 'photo');
  const photo = await M('ConnectPhoto').findByPk(id);
  const notFound = () => fail(404, 'PHOTO_NOT_FOUND', 'Photo not found.');
  if (!photo || !photo.mediaId) throw notFound();
  if (String(photo.userId) !== me) {
    if (photo.status !== 'approved') throw notFound();
    const owner = await myProfile(photo.userId);
    const g = await gateReady(req, { allowPaused: true });
    if (!g || !(await canView(me, owner, cfgOf(req)))) throw notFound();
  }
  const url = signedPhotoUrl(req, photo.mediaId);
  res.set('Cache-Control', 'private, no-store');
  res.redirect(302, url);
};

// ═════════════════════════════════════════════════════════════════════════════
// Liveness
// ═════════════════════════════════════════════════════════════════════════════

// POST /liveness/start {consent:true}
const livenessStart = async (req, res) => {
  const me = String(req.user.id);
  const { profile } = await gateSetup(req);
  assertNotRemoved(profile);
  const lv = liveness.describe();
  if (!lv.required) throw fail(409, 'LIVENESS_NOT_REQUIRED', 'The selfie check is not needed right now.');
  const a = liveness.adapter();
  if (!a) throw fail(503, 'LIVENESS_NOT_CONFIGURED', "The selfie check isn't available yet. Please check back later.");
  if (profile.livenessStatus === 'passed') throw fail(409, 'LIVENESS_ALREADY_PASSED', 'Your selfie check is already done.');
  if (profile.livenessStatus === 'pending') throw fail(409, 'LIVENESS_PENDING', 'Your selfie is waiting for review.');
  const hasConsent = await M('FriendsConsent').findOne({ where: { userId: me, kind: 'liveness', withdrawnAt: null } });
  if (!hasConsent) {
    if ((req.body || {}).consent !== true) {
      throw fail(400, 'LIVENESS_CONSENT_REQUIRED', 'Agree to the selfie check first: one selfie, seen only by a ZCS admin, deleted after review.');
    }
    await recordConsent(me, 'liveness', cfgOf(req).connectConsentVersion, req);
  }
  limiter.enforce(me, 'connect_liveness_start');
  const s = a.start(profile);
  if (s.mode === 'manual') {
    await M('ConnectProfile').update({ livenessChallenge: s.challenge, livenessChallengeAt: new Date(), livenessProvider: 'manual' }, { where: { id: profile.id } });
  }
  send(res, 200, { ...s, uploadPurpose: 'liveness_selfie' });
};

// POST /liveness/manual {mediaId}
const livenessManual = async (req, res) => {
  const me = String(req.user.id);
  const { profile } = await gateSetup(req);
  assertNotRemoved(profile);
  const a = liveness.adapter();
  if (!liveness.required()) throw fail(409, 'LIVENESS_NOT_REQUIRED', 'The selfie check is not needed right now.');
  if (!a) throw fail(503, 'LIVENESS_NOT_CONFIGURED', "The selfie check isn't available yet. Please check back later.");
  if (a.name !== 'manual') throw fail(409, 'WRONG_LIVENESS_MODE', 'Use the selfie check link shown in the app.');
  if (profile.livenessStatus === 'passed') throw fail(409, 'LIVENESS_ALREADY_PASSED', 'Your selfie check is already done.');
  if (profile.livenessStatus === 'pending') throw fail(409, 'LIVENESS_PENDING', 'Your selfie is waiting for review.');
  const ttl = require('../services/liveness/manual').CHALLENGE_TTL_MS;
  const startedAt = profile.livenessChallengeAt ? new Date(profile.livenessChallengeAt).getTime() : 0;
  if (!profile.livenessChallenge || !startedAt || Date.now() - startedAt > ttl) {
    throw fail(409, 'LIVENESS_CHALLENGE_EXPIRED', 'That selfie prompt expired. Start the selfie check again.');
  }
  const mediaId = requireUuid((req.body || {}).mediaId, 'selfie');
  const media = await M('CampusMedia').findByPk(mediaId, { attributes: ['id', 'ownerId', 'purpose', 'isPrivate', 'createdAt'] });
  if (!media || String(media.ownerId) !== me || media.purpose !== 'liveness_selfie' || !media.isPrivate) {
    throw fail(400, 'INVALID_MEDIA', 'Upload the selfie for the check first.');
  }
  // The selfie must be taken after the prompt was shown (a fresh photo, not an old one).
  const createdAt = new Date(media.createdAt).getTime();
  if (!Number.isFinite(createdAt) || createdAt < startedAt - 5000) throw fail(400, 'SELFIE_TOO_OLD', 'Take a new selfie now, doing the gesture shown.');
  limiter.enforce(me, 'connect_liveness_submit');
  const [n] = await M('ConnectProfile').update(
    { livenessStatus: 'pending', livenessMediaId: mediaId, livenessSubmittedAt: new Date(), livenessNote: null, livenessProvider: 'manual' },
    { where: { id: profile.id, livenessStatus: { [Op.in]: ['none', 'failed'] } } },
  );
  if (n !== 1) throw fail(409, 'STATE_CHANGED', 'Your selfie check changed. Refresh and try again.');
  // Any older selfie that was never attached is deleted (minimal retention).
  await M('CampusMedia').destroy({ where: { ownerId: me, purpose: 'liveness_selfie', id: { [Op.ne]: mediaId } } });
  notifyAdmin('friends_review', 'created', profile.id, { scope: 'connect_liveness' });
  send(res, 200, { liveness: livenessDto(await myProfile(me)) });
};

// POST /liveness/webhook — provider callbacks (signature checked by the adapter). No adapter: 503.
const livenessWebhook = async (req, res) => {
  const a = liveness.adapter();
  if (!a) throw fail(503, 'LIVENESS_NOT_CONFIGURED', 'Liveness provider is not configured.');
  if (typeof a.verifyWebhook !== 'function') throw fail(404, 'NOT_FOUND', 'Not found.');
  const r = await a.verifyWebhook(req);
  if (!r || !isUuid(String(r.userId || ''))) throw fail(401, 'BAD_SIGNATURE', 'Invalid signature.');
  await M('ConnectProfile').update(
    { livenessStatus: r.passed ? 'passed' : 'failed', livenessCheckedAt: new Date(), livenessProvider: a.name, livenessNote: r.passed ? null : String(r.note || 'The check did not pass.').slice(0, 300) },
    { where: { userId: r.userId } },
  );
  res.status(200).json({ ok: true });
};

// ═════════════════════════════════════════════════════════════════════════════
// Discovery and matching
// ═════════════════════════════════════════════════════════════════════════════

const splitList = (raw, max) => {
  if (raw === undefined || raw === null || raw === '') return [];
  const list = (Array.isArray(raw) ? raw : String(raw).split(',')).map((s) => String(s).trim()).filter(Boolean);
  if (list.length > max) throw fail(400, 'INVALID_FILTER', `Use at most ${max} values in a filter.`);
  return list;
};

// GET /discover?interests=&year=&branch=&lookingFor=&cursor=&limit=
const discover = async (req, res) => {
  const me = String(req.user.id);
  const { ctx, cfg, profile } = await gateReady(req);
  const q = req.query || {};
  const interests = splitList(q.interests, 5).map((s) => s.toLowerCase());
  const lookingFor = splitList(q.lookingFor, 4);
  if (lookingFor.some((x) => !C.LOOKING_FOR.includes(x))) throw fail(400, 'INVALID_FILTER', 'Unknown "looking for" filter.');
  let year = null;
  if (q.year !== undefined && q.year !== '') {
    year = Number(q.year);
    if (!Number.isInteger(year) || year < C.YEAR_MIN || year > C.YEAR_MAX) throw fail(400, 'INVALID_FILTER', 'Year filter must be 1-6.');
  }
  const branch = q.branch ? normBranch(q.branch) : null;
  if (branch && branch.length > 50) throw fail(400, 'INVALID_FILTER', 'Branch filter is too long.');
  const limit = Math.min(cursor.pageSize(q.limit, C.DISCOVER_PAGE), C.DISCOVER_PAGE);
  const after = cursor.after(q.cursor, 'lastActiveAt');

  const campusId = String(ctx.profile.campusId);
  const myInfo = { year: ctx.profile.year || null, branch: ctx.profile.branch || null };
  const [blocked, swiped] = await Promise.all([
    blocks.blockedIds(me),
    M('ConnectSwipe').findAll({ where: { fromUserId: me }, attributes: ['toUserId'] }),
  ]);
  const exclude = [me, ...blocked, ...swiped.map((s) => String(s.toUserId))];

  const items = [];
  let lastScanned = null;
  let exhausted = false;
  let cond = after;
  for (let round = 0; round < 6 && items.length < limit; round++) {
    const rows = await M('ConnectProfile').findAll({
      where: {
        campusId,
        status: 'active',
        modStatus: 'visible',
        userId: { [Op.notIn]: exclude },
        lastActiveAt: { [Op.ne]: null },
        ...(cond ? { [Op.and]: [cond] } : {}),
      },
      order: [['lastActiveAt', 'DESC'], ['id', 'DESC']],
      limit: 60,
    });
    if (!rows.length) { exhausted = true; break; }
    const info = await loadCandidateInfo(rows.map((r) => r.userId));
    const photos = await approvedPhotos(rows.map((r) => r.userId));
    for (const p of rows) {
      lastScanned = p;
      const ti = info.get(String(p.userId));
      if (!ti || !ti.ready || ti.campusId !== campusId) continue;
      if (!profileDiscoverable(p, cfg)) continue;
      if (hiddenBetween(profile, myInfo, p, ti)) continue;
      if (year !== null && !(p.showYear && Number(ti.year) === year)) continue;
      if (branch && !(p.showBranch && normBranch(ti.branch) === branch)) continue;
      if (interests.length && !(p.interests || []).some((x) => interests.includes(String(x).toLowerCase()))) continue;
      if (lookingFor.length && !(p.lookingFor || []).some((x) => lookingFor.includes(x))) continue;
      items.push(cardOf(req, p, ti, photos.get(String(p.userId))));
      if (items.length >= limit) break;
    }
    if (rows.length < 60 && items.length < limit) { exhausted = true; break; }
    cond = { [Op.or]: [{ lastActiveAt: { [Op.lt]: lastScanned.lastActiveAt } }, { lastActiveAt: lastScanned.lastActiveAt, id: { [Op.lt]: lastScanned.id } }] };
  }
  // Being active keeps me near the top of other people's decks (at most every 5 minutes).
  if (!profile.lastActiveAt || Date.now() - new Date(profile.lastActiveAt).getTime() > 5 * MIN) {
    await M('ConnectProfile').update({ lastActiveAt: new Date() }, { where: { id: profile.id } });
  }
  const nextCursor = !exhausted && lastScanned ? cursor.encode(lastScanned, 'lastActiveAt') : null;
  send(res, 200, { items, nextCursor });
};

/** Creates the match + chat when both people liked each other. Exactly one caller wins per pair. */
const matchIfMutual = async (a, b, campusId) => {
  const [low, high] = orderedPair(a, b);
  const out = await deletion.runTx(async (transaction) => {
    const likes = await M('ConnectSwipe').count({
      where: {
        action: 'like',
        [Op.or]: [{ fromUserId: low, toUserId: high }, { fromUserId: high, toUserId: low }],
      },
      transaction,
    });
    if (likes < 2) return { match: null, created: false };
    const id = crypto.randomUUID();
    const now = new Date();
    // Insert-or-ignore on the ordered pair (cm_pair_uq): Postgres ON CONFLICT DO NOTHING, SQLite INSERT OR IGNORE.
    await M('ConnectMatch').bulkCreate([{ id, userLowId: low, userHighId: high, campusId, status: 'active', matchedAt: now }], { ignoreDuplicates: true, transaction });
    const match = await M('ConnectMatch').findOne({ where: { userLowId: low, userHighId: high }, transaction });
    if (!match || match.id !== id) return { match, created: false };
    const conv = await M('Conversation').create({
      isGroup: false,
      type: 'dm',
      participants: [low, high],
      refType: 'connect',
      refId: id,
      description: 'Connect match',
      lastMessageAt: now,
    }, { transaction });
    await M('ConnectMatch').update({ conversationId: conv.id }, { where: { id }, transaction });
    match.conversationId = conv.id;
    return { match, created: true };
  });
  if (out.created) {
    await notify('CONNECT_MATCH', [low, high], { id: out.match.id, dedupeKey: `match:${out.match.id}`, data: { matchId: out.match.id } });
    deletion.emitTo([low, high], 'friends:connect_match', { matchId: out.match.id });
  }
  return out;
};

// POST /swipe {profileId, action: like|pass}
const swipe = async (req, res) => {
  captureIo(req);
  const me = String(req.user.id);
  const { ctx, cfg } = await gateReady(req);
  const b = req.body || {};
  const profileId = requireUuid(b.profileId, 'profile');
  if (!C.SWIPE_ACTIONS.includes(b.action)) throw fail(400, 'INVALID_ACTION', 'Choose like or pass.');
  const target = await M('ConnectProfile').findByPk(profileId);
  if (target && String(target.userId) === me) throw fail(400, 'CANNOT_SWIPE_SELF', 'That is your own profile.');
  if (!target || !(await canView(me, target, cfg))) throw fail(404, 'PROFILE_NOT_FOUND', 'This profile is not available.');
  const to = String(target.userId);
  const existing = await M('ConnectSwipe').findOne({ where: { fromUserId: me, toUserId: to } });
  const matchState = async () => {
    const m = await activeMatchBetween(me, to);
    return m ? { matched: true, matchId: m.id, conversationId: m.conversationId } : { matched: false };
  };
  if (existing) return send(res, 200, { action: existing.action, duplicate: true, ...(await matchState()) });

  limiter.enforce(me, 'connect_swipe');
  if (b.action === 'like') {
    limiter.enforce(me, 'connect_like');
    limiter.enforce(me, 'connect_like_burst');
  }
  let duplicate = false;
  try {
    await deletion.runTx((transaction) => M('ConnectSwipe').create({ fromUserId: me, toUserId: to, campusId: ctx.profile.campusId, action: b.action }, { transaction }));
  } catch (err) {
    if (!isUniqueError(err)) throw err;
    duplicate = true;
  }
  let result = { matched: false };
  if (b.action === 'like' || duplicate) {
    const swipeRow = await M('ConnectSwipe').findOne({ where: { fromUserId: me, toUserId: to } });
    if (swipeRow && swipeRow.action === 'like') {
      const out = await matchIfMutual(me, to, ctx.profile.campusId);
      if (out.match && out.match.status === 'active') result = { matched: true, matchId: out.match.id, conversationId: out.match.conversationId };
    }
    if (duplicate) return send(res, 200, { action: swipeRow ? swipeRow.action : b.action, duplicate: true, ...result });
  }
  send(res, 201, { action: b.action, duplicate: false, ...result });
};

const otherOf = (m, me) => (String(m.userLowId) === String(me) ? String(m.userHighId) : String(m.userLowId));

const matchDtos = async (req, matches, me) => {
  const others = matches.map((m) => otherOf(m, me));
  const [profiles, info, photos, settings] = await Promise.all([
    others.length ? M('ConnectProfile').findAll({ where: { userId: { [Op.in]: others } } }) : [],
    loadCandidateInfo(others),
    approvedPhotos(others),
    getSettings(),
  ]);
  const byUser = new Map(profiles.map((p) => [String(p.userId), p]));
  return matches.map((m) => {
    const o = otherOf(m, me);
    const p = byUser.get(o);
    return {
      id: m.id,
      status: m.status,
      matchedAt: m.matchedAt,
      conversationId: m.conversationId,
      profile: p && !['removed', 'hidden'].includes(p.modStatus) ? cardOf(req, p, info.get(o), photos.get(o)) : { profileId: p ? p.id : null, displayName: p ? p.displayName : 'Connect user', photos: [], unavailable: true },
      spark: sparkFor(settings, m.id),
      callsEnabled: false,
    };
  });
};

// GET /matches?cursor=
const listMatches = async (req, res) => {
  const me = String(req.user.id);
  await gateReady(req, { allowPaused: true });
  const limit = cursor.pageSize(req.query.limit, 30);
  const after = cursor.after(req.query.cursor);
  const blocked = await blocks.blockedIds(me);
  const rows = await M('ConnectMatch').findAll({
    where: {
      status: 'active',
      [Op.or]: [{ userLowId: me }, { userHighId: me }],
      ...(after ? { [Op.and]: [after] } : {}),
    },
    order: [['createdAt', 'DESC'], ['id', 'DESC']],
    limit: limit + 1,
  });
  // Page (and cursor) from the rows as fetched: dropping blocked rows first lost the next cursor
  // whenever one of the limit+1 rows was a block, so later matches became unreachable.
  const pg = cursor.page(rows, limit);
  const visible = [];
  for (const m of pg.items) {
    if (blocked.has(otherOf(m, me))) {
      await deletion.endMatch(m.id, { status: 'blocked' });
      continue;
    }
    visible.push(m);
  }
  send(res, 200, { items: await matchDtos(req, visible, me), nextCursor: pg.nextCursor });
};

const loadMyMatch = async (req) => {
  const me = String(req.user.id);
  const id = requireUuid(req.params.id, 'match');
  const m = await M('ConnectMatch').findByPk(id);
  if (!m || (String(m.userLowId) !== me && String(m.userHighId) !== me)) throw fail(404, 'MATCH_NOT_FOUND', 'Match not found.');
  return m;
};

// GET /matches/:id
const getMatch = async (req, res) => {
  const me = String(req.user.id);
  await gateReady(req, { allowPaused: true });
  const m = await loadMyMatch(req);
  if (m.status !== 'active') throw fail(404, 'MATCH_NOT_FOUND', 'This match has ended.');
  if (await blocks.isBlocked(me, otherOf(m, me))) {
    await deletion.endMatch(m.id, { status: 'blocked' });
    throw fail(404, 'MATCH_NOT_FOUND', 'This match has ended.');
  }
  send(res, 200, { match: (await matchDtos(req, [m], me))[0] });
};

// POST /matches/:id/unmatch
const unmatch = async (req, res) => {
  captureIo(req);
  const me = String(req.user.id);
  const m = await loadMyMatch(req);
  if (m.status !== 'active') return send(res, 200, { unmatched: true, duplicate: true });
  limiter.enforce(me, 'connect_unmatch');
  const won = await deletion.endMatch(m.id, { status: 'unmatched', by: me });
  send(res, 200, { unmatched: true, duplicate: !won });
};

/** Global block (Friendship status 'blocked'), same as /api/friends/block, recorded with source
 * 'connect' so the block list always masks this person (B2) and directional so the other side's own
 * block survives either unblock (B5). */
const blockUser = async (me, other) => {
  await require('../../../utils/friendshipBlocks').applyBlock(M('Friendship'), me, other, 'connect');
  blocks.clearBlocks(me, other);
  // The pair can never meet in Connect again: an ended match and a pass from me.
  const [low, high] = orderedPair(me, other);
  const m = await M('ConnectMatch').findOne({ where: { userLowId: low, userHighId: high, status: 'active' } });
  if (m) await deletion.endMatch(m.id, { status: 'blocked', by: me });
  try {
    await M('ConnectSwipe').create({ fromUserId: me, toUserId: other, action: 'pass' });
  } catch (err) {
    if (!isUniqueError(err)) throw err;
  }
};

// POST /matches/:id/block
const blockMatch = async (req, res) => {
  captureIo(req);
  const me = String(req.user.id);
  const m = await loadMyMatch(req);
  limiter.enforce(me, 'connect_block');
  await blockUser(me, otherOf(m, me));
  send(res, 200, { blocked: true });
};

// POST /block {profileId} — from a discovery card (or a match).
const blockProfile = async (req, res) => {
  captureIo(req);
  const me = String(req.user.id);
  const profileId = requireUuid((req.body || {}).profileId, 'profile');
  const target = await M('ConnectProfile').findByPk(profileId);
  if (!target || String(target.userId) === me) throw fail(404, 'PROFILE_NOT_FOUND', 'This profile is not available.');
  const cp = await M('CampusProfile').findOne({ where: { userId: me }, attributes: ['campusId'] });
  if (!cp || String(cp.campusId) !== String(target.campusId)) throw fail(404, 'PROFILE_NOT_FOUND', 'This profile is not available.');
  // Only a profile I can actually see (B2): otherwise any profile id would create a block row with
  // its owner. An existing block between us is re-applied idempotently (same answer either way).
  if (!(await blocks.isBlocked(me, String(target.userId))) && !(await canView(me, target, cfgOf(req)))) {
    throw fail(404, 'PROFILE_NOT_FOUND', 'This profile is not available.');
  }
  limiter.enforce(me, 'connect_block');
  await blockUser(me, String(target.userId));
  send(res, 200, { blocked: true });
};

// ═════════════════════════════════════════════════════════════════════════════
// Admin (/api/campus/connect/admin, protect + admin; works while the flag is off)
// Every read of Connect data is audited as view_connect BEFORE the data is returned (fail closed).
// ═════════════════════════════════════════════════════════════════════════════

const viewAudit = (req, targetType, targetId, meta) => audit.record({
  actorId: req.user.id, actorRole: 'admin', action: 'view_connect', targetType, targetId: targetId || null, meta: meta || {},
});

const adminIdentity = async (req, userIds) => {
  const ids = [...new Set(userIds.map(String))];
  const users = ids.length ? await M('User').findAll({ where: { id: { [Op.in]: ids } }, attributes: ['id', 'name', 'profileImage', 'isActive'] }) : [];
  const out = new Map();
  let avatarUrlFor = () => null;
  try { ({ avatarUrlFor } = require('../../campus/campusHelpers')); } catch { /* optional */ }
  users.forEach((u) => out.set(String(u.id), { userId: u.id, name: u.name, avatarUrl: avatarUrlFor(req, u), isActive: u.isActive !== false }));
  return out;
};

const PHOTO_FILTER = ['pending', 'approved', 'rejected'];

// GET /admin/photos?status=pending&cursor=
const adminListPhotos = async (req, res) => {
  const st = req.query.status || 'pending';
  if (!PHOTO_FILTER.includes(st)) throw fail(400, 'INVALID_FILTER', 'Unknown status.');
  const limit = cursor.pageSize(req.query.limit, 30);
  const after = st === 'pending'
    ? (() => { const c = cursor.decode(req.query.cursor); return c ? { [Op.or]: [{ createdAt: { [Op.gt]: c.value } }, { createdAt: c.value, id: { [Op.gt]: c.id } }] } : null; })()
    : cursor.after(req.query.cursor);
  const rows = await M('ConnectPhoto').findAll({
    where: { status: st, ...(after ? { [Op.and]: [after] } : {}) },
    // Oldest first for the review queue, newest first otherwise.
    order: st === 'pending' ? [['createdAt', 'ASC'], ['id', 'ASC']] : [['createdAt', 'DESC'], ['id', 'DESC']],
    limit: limit + 1,
  });
  const pg = cursor.page(rows, limit);
  await viewAudit(req, 'connect_photo', null, { list: 'photos', status: st, count: pg.items.length });
  const userIds = pg.items.map((p) => String(p.userId));
  const [ids, profiles] = await Promise.all([
    adminIdentity(req, userIds),
    userIds.length ? M('ConnectProfile').findAll({ where: { userId: { [Op.in]: userIds } } }) : [],
  ]);
  const prof = new Map(profiles.map((p) => [String(p.userId), p]));
  res.json({
    items: pg.items.map((p) => ({
      id: p.id,
      status: p.status,
      position: p.position,
      url: p.mediaId ? signedPhotoUrl(req, p.mediaId) : null,
      rejectReason: p.rejectReason,
      createdAt: p.createdAt,
      reviewedAt: p.reviewedAt,
      user: ids.get(String(p.userId)) || null,
      profile: prof.get(String(p.userId)) ? { profileId: prof.get(String(p.userId)).id, displayName: prof.get(String(p.userId)).displayName, status: prof.get(String(p.userId)).status } : null,
    })),
    nextCursor: pg.nextCursor,
  });
};

const decidePhoto = async (req, res, decision) => {
  const id = requireUuid(req.params.id, 'photo');
  const reason = typeof (req.body || {}).reason === 'string' ? req.body.reason.trim().slice(0, 200) : '';
  if (decision === 'reject' && reason.length < 3) throw fail(400, 'REASON_REQUIRED', 'Give a short reason the student will see.');
  const photo = await M('ConnectPhoto').findByPk(id);
  if (!photo) throw fail(404, 'PHOTO_NOT_FOUND', 'Photo not found.');
  const from = decision === 'approve' ? ['pending', 'rejected'] : ['pending', 'approved'];
  if (decision === 'approve' && !photo.mediaId) throw fail(409, 'PHOTO_DELETED', 'This photo was already deleted.');
  const won = await deletion.runTx(async (transaction) => {
    const [n] = await M('ConnectPhoto').update(
      decision === 'approve'
        ? { status: 'approved', rejectReason: null, reviewedBy: req.user.id, reviewedAt: new Date() }
        : { status: 'rejected', rejectReason: reason, reviewedBy: req.user.id, reviewedAt: new Date(), mediaId: null },
      { where: { id, status: { [Op.in]: from } }, transaction },
    );
    if (n !== 1) return false;
    // A rejected photo's bytes are deleted at once (nobody may see it, and it is not kept).
    if (decision === 'reject' && photo.mediaId) await M('CampusMedia').destroy({ where: { id: photo.mediaId }, transaction });
    await audit.record({
      actorId: req.user.id, actorRole: 'admin', action: decision === 'approve' ? 'approve' : 'reject', targetType: 'connect_photo', targetId: id, subjectUserId: photo.userId, reason: reason || null,
    }, { transaction });
    return true;
  });
  if (!won) throw fail(409, 'ALREADY_DECIDED', 'This photo was already reviewed.');
  await notify('MOD_OUTCOME', [photo.userId], { id, dedupeKey: `connect_photo:${id}:${decision}`, data: { kind: 'connect_photo', decision } });
  res.json({ id, status: decision === 'approve' ? 'approved' : 'rejected' });
};
const adminApprovePhoto = (req, res) => decidePhoto(req, res, 'approve');
const adminRejectPhoto = (req, res) => decidePhoto(req, res, 'reject');

// GET /admin/liveness?status=pending
const adminListLiveness = async (req, res) => {
  const st = req.query.status || 'pending';
  if (!C.LIVENESS_STATUS.includes(st)) throw fail(400, 'INVALID_FILTER', 'Unknown status.');
  const rows = await M('ConnectProfile').findAll({
    where: { livenessStatus: st },
    order: st === 'pending' ? [['livenessSubmittedAt', 'ASC']] : [['updatedAt', 'DESC']],
    limit: 50,
  });
  await viewAudit(req, 'connect_profile', null, { list: 'liveness', status: st, count: rows.length });
  const userIds = rows.map((p) => String(p.userId));
  const [ids, photoRows] = await Promise.all([
    adminIdentity(req, userIds),
    userIds.length ? M('ConnectPhoto').findAll({ where: { userId: { [Op.in]: userIds }, mediaId: { [Op.ne]: null } }, order: [['position', 'ASC']] }) : [],
  ]);
  res.json({
    provider: liveness.describe(),
    items: rows.map((p) => ({
      userId: p.userId,
      profileId: p.id,
      displayName: p.displayName,
      user: ids.get(String(p.userId)) || null,
      status: p.livenessStatus,
      challenge: p.livenessChallenge,
      selfieUrl: p.livenessMediaId ? signedPhotoUrl(req, p.livenessMediaId) : null,
      submittedAt: p.livenessSubmittedAt,
      checkedAt: p.livenessCheckedAt,
      note: p.livenessNote,
      photos: photoRows.filter((ph) => String(ph.userId) === String(p.userId)).map((ph) => ({ id: ph.id, status: ph.status, url: signedPhotoUrl(req, ph.mediaId) })),
    })),
  });
};

const decideLiveness = async (req, res, passed) => {
  const userId = requireUuid(req.params.userId, 'user');
  const reason = typeof (req.body || {}).reason === 'string' ? req.body.reason.trim().slice(0, 300) : '';
  if (!passed && reason.length < 3) throw fail(400, 'REASON_REQUIRED', 'Give a short reason the student will see.');
  const profile = await myProfile(userId);
  if (!profile) throw fail(404, 'NO_PROFILE', 'No Connect profile.');
  const won = await deletion.runTx(async (transaction) => {
    const [n] = await M('ConnectProfile').update(
      { livenessStatus: passed ? 'passed' : 'failed', livenessCheckedAt: new Date(), livenessMediaId: null, livenessNote: passed ? null : reason, livenessChallenge: null, livenessChallengeAt: null },
      { where: { id: profile.id, livenessStatus: 'pending' }, transaction },
    );
    if (n !== 1) return false;
    // Minimal biometric retention: the selfie is deleted as soon as a decision is made.
    if (profile.livenessMediaId) await M('CampusMedia').destroy({ where: { id: profile.livenessMediaId }, transaction });
    await audit.record({
      actorId: req.user.id, actorRole: 'admin', action: passed ? 'approve' : 'reject', targetType: 'connect_profile', targetId: profile.id, subjectUserId: userId, reason: reason || null, meta: { kind: 'liveness' },
    }, { transaction });
    return true;
  });
  if (!won) throw fail(409, 'ALREADY_DECIDED', 'This selfie check was already decided.');
  await notify('MOD_OUTCOME', [userId], { id: profile.id, dedupeKey: `connect_liveness:${profile.id}:${passed}`, data: { kind: 'connect_liveness', decision: passed ? 'passed' : 'failed' } });
  res.json({ userId, livenessStatus: passed ? 'passed' : 'failed', selfieDeleted: true });
};
const adminPassLiveness = (req, res) => decideLiveness(req, res, true);
const adminFailLiveness = (req, res) => decideLiveness(req, res, false);

// GET /admin/profiles?status=&modStatus=&q=&cursor=
const adminListProfiles = async (req, res) => {
  const q = req.query || {};
  const where = {};
  if (q.status) { if (!C.PROFILE_STATUS.includes(q.status)) throw fail(400, 'INVALID_FILTER', 'Unknown status.'); where.status = q.status; }
  if (q.modStatus) { if (!C.MOD_STATUS.includes(q.modStatus)) throw fail(400, 'INVALID_FILTER', 'Unknown moderation status.'); where.modStatus = q.modStatus; }
  if (q.campusId) where.campusId = requireUuid(q.campusId, 'campus');
  if (q.q) {
    const like = getSequelize().getDialect() === 'postgres' ? Op.iLike : Op.like;
    where.displayName = { [like]: `%${String(q.q).slice(0, 40)}%` };
  }
  const limit = cursor.pageSize(q.limit, 30);
  const after = cursor.after(q.cursor);
  const rows = await M('ConnectProfile').findAll({ where: { ...where, ...(after ? { [Op.and]: [after] } : {}) }, order: [['createdAt', 'DESC'], ['id', 'DESC']], limit: limit + 1 });
  const pg = cursor.page(rows, limit);
  await viewAudit(req, 'connect_profile', null, { list: 'profiles', count: pg.items.length });
  const ids = await adminIdentity(req, pg.items.map((p) => p.userId));
  res.json({
    items: pg.items.map((p) => ({
      profileId: p.id, user: ids.get(String(p.userId)) || null, campusId: p.campusId, status: p.status, modStatus: p.modStatus,
      displayName: p.displayName, livenessStatus: p.livenessStatus, consentVersion: p.consentVersion, createdAt: p.createdAt, lastActiveAt: p.lastActiveAt,
    })),
    nextCursor: pg.nextCursor,
  });
};

// GET /admin/profiles/:id
const adminGetProfile = async (req, res) => {
  const id = requireUuid(req.params.id, 'profile');
  const p = await M('ConnectProfile').findByPk(id);
  if (!p) throw fail(404, 'PROFILE_NOT_FOUND', 'Profile not found.');
  await viewAudit(req, 'connect_profile', p.id, { detail: true });
  const [ids, photos, matches, reports, actions] = await Promise.all([
    adminIdentity(req, [p.userId]),
    M('ConnectPhoto').findAll({ where: { userId: p.userId }, order: [['position', 'ASC']] }),
    M('ConnectMatch').count({ where: { [Op.or]: [{ userLowId: p.userId }, { userHighId: p.userId }], status: 'active' } }),
    M('FriendsReport').findAll({ where: { targetType: { [Op.in]: ['connect_profile', 'connect_photo'] }, targetOwnerId: p.userId }, order: [['createdAt', 'DESC']], limit: 50 }),
    M('FriendsModAction').findAll({ where: { targetType: { [Op.in]: ['connect_profile', 'connect_photo'] }, subjectUserId: p.userId }, order: [['createdAt', 'DESC']], limit: 50 }),
  ]);
  res.json({
    profile: {
      profileId: p.id, user: ids.get(String(p.userId)) || null, campusId: p.campusId, status: p.status, modStatus: p.modStatus, modReason: p.modReason,
      displayName: p.displayName, bio: p.bio, interests: p.interests, lookingFor: p.lookingFor, showYear: p.showYear, showBranch: p.showBranch,
      hiddenBranches: p.hiddenBranches, hiddenYears: p.hiddenYears, consentVersion: p.consentVersion, consentAt: p.consentAt, ageDeclaredAt: p.ageDeclaredAt,
      livenessStatus: p.livenessStatus, livenessCheckedAt: p.livenessCheckedAt, activatedAt: p.activatedAt, lastActiveAt: p.lastActiveAt, createdAt: p.createdAt,
    },
    photos: photos.map((ph) => ({ id: ph.id, position: ph.position, status: ph.status, rejectReason: ph.rejectReason, url: ph.mediaId ? signedPhotoUrl(req, ph.mediaId) : null })),
    activeMatches: matches,
    reports: reports.map((r) => ({ id: r.id, targetType: r.targetType, category: r.category, status: r.status, severity: r.severity, createdAt: r.createdAt })),
    actions: actions.map(audit.serializeAction),
  });
};

const setProfileMod = async (profileId, modStatus, reason, transaction) => {
  const [n] = await M('ConnectProfile').update({ modStatus, modReason: modStatus === 'visible' ? null : (reason || 'Moderation decision') }, { where: { id: profileId }, transaction });
  return n === 1;
};

// POST /admin/profiles/:id/:action  (remove | hide | restore | delete)
const adminModerateProfile = async (req, res) => {
  captureIo(req);
  const id = requireUuid(req.params.id, 'profile');
  const action = req.params.action;
  if (!['remove', 'hide', 'restore', 'delete'].includes(action)) throw fail(404, 'NOT_FOUND', 'Unknown action.');
  const reason = typeof (req.body || {}).reason === 'string' ? req.body.reason.trim().slice(0, 300) : '';
  if (action !== 'restore' && reason.length < 3) throw fail(400, 'REASON_REQUIRED', 'Give a reason.');
  const p = await M('ConnectProfile').findByPk(id);
  if (!p) throw fail(404, 'PROFILE_NOT_FOUND', 'Profile not found.');
  if (action === 'delete') {
    await audit.record({ actorId: req.user.id, actorRole: 'admin', action: 'remove', targetType: 'connect_profile', targetId: id, subjectUserId: p.userId, reason, meta: { deleted: true } });
    const summary = await deletion.deleteConnectData(p.userId);
    await notify('MOD_OUTCOME', [p.userId], { id, dedupeKey: `connect_profile:${id}:delete`, data: { kind: 'connect_profile', decision: 'deleted' } });
    return res.json({ deleted: true, summary });
  }
  const modStatus = action === 'remove' ? 'removed' : action === 'hide' ? 'hidden' : 'visible';
  const actionRow = await audit.record({ actorId: req.user.id, actorRole: 'admin', action: action === 'restore' ? 'restore' : action, targetType: 'connect_profile', targetId: id, subjectUserId: p.userId, reason: reason || null });
  await setProfileMod(id, modStatus, reason);
  if (action === 'remove') {
    // A removed profile's open matches end (the people it may have harmed stop hearing from it).
    const active = await M('ConnectMatch').findAll({ where: { status: 'active', [Op.or]: [{ userLowId: p.userId }, { userHighId: p.userId }] } });
    for (const m of active) await deletion.endMatch(m.id, { status: 'unmatched', by: null });
  }
  await notify('MOD_OUTCOME', [p.userId], { id, dedupeKey: `connect_profile:${id}:${action}`, data: { kind: 'connect_profile', decision: modStatus, actionId: actionRow.id } });
  res.json({ profileId: id, modStatus, actionId: actionRow.id });
};

// GET /admin/stats
const adminStats = async (req, res) => {
  const [profiles, active, paused, photosPending, livenessPending, matches, swipes] = await Promise.all([
    M('ConnectProfile').count(),
    M('ConnectProfile').count({ where: { status: 'active' } }),
    M('ConnectProfile').count({ where: { status: 'paused' } }),
    M('ConnectPhoto').count({ where: { status: 'pending' } }),
    M('ConnectProfile').count({ where: { livenessStatus: 'pending' } }),
    M('ConnectMatch').count({ where: { status: 'active' } }),
    M('ConnectSwipe').count(),
  ]);
  res.json({ profiles, active, paused, photosPending, livenessPending, activeMatches: matches, swipes, liveness: liveness.describe(), retentionDays: deletion.retentionDays() });
};

// GET /admin/settings
const adminGetSettings = async (req, res) => {
  const s = await getSettings({ fresh: true });
  const cfg = await flags.getConfig();
  res.json({ ...s, defaults: { helplines: DEFAULT_HELPLINES, sparkPrompts: DEFAULT_SPARKS, guidance: DEFAULT_GUIDANCE }, connectConsentVersion: cfg.connectConsentVersion, policyUrl: policyUrl(), liveness: liveness.describe() });
};

const validHelpline = (h) => h && typeof h === 'object'
  && typeof h.name === 'string' && h.name.trim().length >= 2 && h.name.length <= 80
  && (h.phone === undefined || h.phone === null || (typeof h.phone === 'string' && /^[0-9+\- ]{3,20}$/.test(h.phone)))
  && (h.url === undefined || h.url === null || (typeof h.url === 'string' && /^https:\/\/[^\s]{4,300}$/i.test(h.url)))
  && (h.note === undefined || h.note === null || (typeof h.note === 'string' && h.note.length <= 160))
  && (h.phone || h.url);
const cleanHelpline = (h) => ({ name: h.name.trim(), ...(h.phone ? { phone: h.phone.trim() } : {}), ...(h.url ? { url: h.url.trim() } : {}), ...(h.note ? { note: h.note.trim() } : {}) });

// PUT /admin/settings {policyText?, helplines?, campusHelplines?, sparkPrompts?, guidance?, connectConsentVersion?}
const adminPutSettings = async (req, res) => {
  const b = req.body || {};
  const errors = [];
  const current = await getSettings({ fresh: true });
  const next = JSON.parse(JSON.stringify(current));
  if (b.policyText !== undefined) {
    if (typeof b.policyText !== 'string' || b.policyText.trim().length < 50 || b.policyText.length > 20000) errors.push('policyText must be 50-20000 characters');
    else if (b.policyText !== current.policy.text) next.policy = { version: current.policy.version + 1, text: b.policyText, updatedAt: new Date().toISOString() };
  }
  if (b.helplines !== undefined) {
    if (!Array.isArray(b.helplines) || b.helplines.length > 20 || !b.helplines.every(validHelpline)) errors.push('helplines must be up to 20 of {name, phone|url, note}');
    else next.helplines = b.helplines.map(cleanHelpline);
  }
  if (b.campusHelplines !== undefined) {
    const ch = b.campusHelplines;
    if (!ch || typeof ch !== 'object' || Array.isArray(ch) || Object.entries(ch).some(([k, v]) => !isUuid(k) || !Array.isArray(v) || v.length > 10 || !v.every(validHelpline))) {
      errors.push('campusHelplines must map campus ids to up to 10 helplines');
    } else next.campusHelplines = Object.fromEntries(Object.entries(ch).map(([k, v]) => [k, v.map(cleanHelpline)]));
  }
  for (const key of ['sparkPrompts', 'guidance']) {
    if (b[key] === undefined) continue;
    const list = b[key];
    if (!Array.isArray(list) || !list.length || list.length > 100 || list.some((x) => typeof x !== 'string' || x.trim().length < 5 || x.length > 240)) errors.push(`${key} must be 1-100 lines of 5-240 characters`);
    else next[key] = list.map((x) => x.trim());
  }
  if (b.connectConsentVersion !== undefined) {
    const r = await flags.setConfig({ connectConsentVersion: b.connectConsentVersion });
    if (r.errors) errors.push(...r.errors);
  }
  if (errors.length) throw fail(400, 'INVALID_SETTINGS', errors[0], { errors });
  const GC = settingsModel();
  if (!GC) throw fail(500, 'SERVER_ERROR', 'Settings storage is not available.');
  const stored = { policy: next.policy, helplines: next.helplines, campusHelplines: next.campusHelplines, sparkPrompts: next.sparkPrompts, guidance: next.guidance };
  const row = await GC.findOne({ where: { key: SETTINGS_KEY } });
  if (row) {
    row.value = stored;
    row.changed('value', true);
    await row.save();
  } else {
    await GC.create({ key: SETTINGS_KEY, value: stored, description: 'ZCS Friends Connect: privacy notice, helplines, Spark prompts' });
  }
  settingsCache = null;
  await audit.recordSafe({ actorId: req.user.id, actorRole: 'admin', action: 'config_update', targetType: 'connect_settings', meta: { keys: Object.keys(b) } });
  eligibility.clearEligibility();
  return adminGetSettings(req, res);
};

// POST /admin/jobs/run
const adminRunJobs = async (req, res) => {
  const stats = await deletion.runJobs();
  res.json({ stats });
};

// ═════════════════════════════════════════════════════════════════════════════
// Unified moderation targets (reports from students land in /api/campus/mod/queue)
// ═════════════════════════════════════════════════════════════════════════════

/** A viewer may report a Connect profile they can see, or one they swiped on / matched with before. */
const viewerKnows = async (viewerId, profile) => {
  const v = String(viewerId);
  const t = String(profile.userId);
  if (v === t) return true;
  const [low, high] = orderedPair(v, t);
  const [swiped, matched] = await Promise.all([
    M('ConnectSwipe').findOne({ where: { [Op.or]: [{ fromUserId: v, toUserId: t }, { fromUserId: t, toUserId: v, action: 'like' }] }, attributes: ['id'] }),
    M('ConnectMatch').findOne({ where: { userLowId: low, userHighId: high }, attributes: ['id'] }),
  ]);
  if (swiped || matched) return true;
  return canView(v, profile, await flags.getConfig());
};

const profileSnapshot = async (p) => {
  const photos = await M('ConnectPhoto').findAll({ where: { userId: p.userId, status: 'approved', mediaId: { [Op.ne]: null } }, attributes: ['mediaId'] });
  return {
    excerpt: targets.excerpt([p.displayName, p.bio, (p.interests || []).join(', ')].filter(Boolean).join(' | ')),
    mediaIds: photos.map((x) => x.mediaId),
    anonymous: false,
    status: p.status,
    createdAt: p.createdAt,
  };
};

targets.register('connect_profile', {
  statuses: ['pending_review', 'hidden', 'removed', 'visible'],
  async load(id, { viewerId } = {}) {
    if (!isUuid(String(id))) return null;
    const p = await M('ConnectProfile').findByPk(id);
    if (!p) return null;
    if (viewerId && !(await viewerKnows(viewerId, p))) return null;
    return { ownerId: p.userId, campusId: p.campusId, subTab: 'connect', snapshot: await profileSnapshot(p) };
  },
  async setStatus(id, st, { transaction } = {}) {
    const ok = await setProfileMod(id, st === 'pending_review' ? 'pending_review' : st, 'Moderation decision', transaction);
    if (ok && st === 'removed') {
      const p = await M('ConnectProfile').findByPk(id, { transaction });
      const active = p ? await M('ConnectMatch').findAll({ where: { status: 'active', [Op.or]: [{ userLowId: p.userId }, { userHighId: p.userId }] }, transaction }) : [];
      for (const m of active) await deletion.endMatch(m.id, { status: 'unmatched', by: null, transaction });
    }
    return ok;
  },
  async currentState(id) {
    const p = await M('ConnectProfile').findByPk(id);
    return p ? { exists: true, status: p.status, modStatus: p.modStatus, livenessStatus: p.livenessStatus } : { exists: false, deleted: true };
  },
});

targets.register('connect_photo', {
  statuses: ['hidden', 'removed', 'visible'],
  async load(id, { viewerId } = {}) {
    if (!isUuid(String(id))) return null;
    const ph = await M('ConnectPhoto').findByPk(id);
    if (!ph) return null;
    const p = await myProfile(ph.userId);
    if (!p) return null;
    if (viewerId && (ph.status !== 'approved' || !(await viewerKnows(viewerId, p)))) return null;
    return {
      ownerId: ph.userId,
      campusId: p.campusId,
      subTab: 'connect',
      snapshot: { excerpt: `Photo ${ph.position + 1} of ${p.displayName || 'a Connect profile'}`, mediaIds: ph.mediaId ? [ph.mediaId] : [], anonymous: false, status: ph.status, createdAt: ph.createdAt },
    };
  },
  async setStatus(id, st, { transaction } = {}) {
    const ph = await M('ConnectPhoto').findByPk(id, { transaction });
    if (!ph) return false;
    if (st === 'visible') {
      if (!ph.mediaId) return false;
      await M('ConnectPhoto').update({ status: 'approved', rejectReason: null }, { where: { id }, transaction });
      return true;
    }
    await M('ConnectPhoto').update({ status: 'rejected', rejectReason: 'Removed by a moderator', mediaId: null }, { where: { id }, transaction });
    if (ph.mediaId) await M('CampusMedia').destroy({ where: { id: ph.mediaId }, transaction });
    return true;
  },
  async currentState(id) {
    const ph = await M('ConnectPhoto').findByPk(id);
    return ph ? { exists: true, status: ph.status, hasMedia: !!ph.mediaId } : { exists: false };
  },
});

module.exports = {
  status,
  policy,
  consent,
  updateProfile,
  activate,
  pause,
  resume,
  deleteProfile,
  myData,
  addPhoto,
  deletePhoto,
  viewPhoto,
  livenessStart,
  livenessManual,
  livenessWebhook,
  discover,
  swipe,
  listMatches,
  getMatch,
  unmatch,
  blockMatch,
  blockProfile,
  adminListPhotos,
  adminApprovePhoto,
  adminRejectPhoto,
  adminListLiveness,
  adminPassLiveness,
  adminFailLiveness,
  adminListProfiles,
  adminGetProfile,
  adminModerateProfile,
  adminStats,
  adminGetSettings,
  adminPutSettings,
  adminRunJobs,
  _internal: { ageFrom, orderedPair, matchIfMutual, canView, connectReasons, sparkFor, getSettings, DEFAULT_POLICY, DEFAULT_HELPLINES },
};
