/**
 * Who may use Friends, decided on the server only from the database (never from client fields).
 *
 * Eligible = account exists and is active + campus profile has a campus + verificationStatus 'verified'
 *            + that campus is active + no active Friends sanction (scope 'friends') + Friends master switch on.
 * Per feature: the feature flag (featureFlags.isEnabled) and no sanction for that feature.
 * Writes additionally need the current guidelines version accepted (428 GUIDELINES_REQUIRED).
 *
 * The per-user context is cached 30 s; clearEligibility(userId) drops it (profile / verification /
 * sanction / guideline changes call it).
 */
const { Op } = require('sequelize');
const { getModel } = require('../index');
const flags = require('./featureFlags');
const { fail, sendError } = require('./http');

const TTL_MS = 30 * 1000;
const MAX_ENTRIES = 5000;
const cache = new Map(); // userId -> { at, ctx }

const userModel = () => getModel('User') || require('../../../models/User').getUserModel();
const profileModel = () => getModel('CampusProfile') || require('../../campus/models/CampusProfile').getCampusProfileModel();
const campusModel = () => getModel('Campus') || require('../../campus/models/Campus').getCampusModel();

// B1: with REDIS_URL set the same entry is dropped on every instance (utils/cacheBus; a remote null = all).
const clearEligibilityLocal = (userId) => {
  if (userId === undefined) cache.clear();
  else cache.delete(String(userId));
};
const eligibilityBus = require('../../../utils/cacheBus');
eligibilityBus.register('friends.eligibility', (userId) => clearEligibilityLocal(userId === null ? undefined : userId), { resync: () => cache.clear() });
const clearEligibility = (...args) => {
  clearEligibilityLocal(...args);
  eligibilityBus.broadcast('friends.eligibility', ...args);
};

const plainSanction = (s) => ({ id: s.id, scope: s.scope, until: s.until ? new Date(s.until).toISOString() : null });

/** Loads (or returns the cached) Friends context for one user. */
const loadContext = async (userId, { fresh = false } = {}) => {
  const key = String(userId || '');
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < TTL_MS) return hit.ctx;

  const User = userModel();
  const user = key ? await User.findByPk(key, { attributes: ['id', 'name', 'role', 'isActive', 'profileImage', 'friendCode'] }) : null;
  let profile = null;
  let campus = null;
  let sanctions = [];
  let settings = null;
  if (user) {
    const CampusProfile = profileModel();
    profile = CampusProfile ? await CampusProfile.findOne({ where: { userId: key } }) : null;
    if (profile && profile.campusId) {
      const Campus = campusModel();
      campus = Campus ? await Campus.findByPk(profile.campusId) : null;
    }
    const FriendsSanction = getModel('FriendsSanction');
    if (FriendsSanction) {
      const rows = await FriendsSanction.findAll({
        where: { userId: key, liftedAt: null, [Op.or]: [{ until: null }, { until: { [Op.gt]: new Date() } }] },
        order: [['createdAt', 'DESC']],
      });
      sanctions = rows.map(plainSanction);
    }
    const FriendsSettings = getModel('FriendsSettings');
    settings = FriendsSettings ? await FriendsSettings.findOne({ where: { userId: key } }) : null;
  }

  const ctx = {
    userId: key,
    user: user ? { id: user.id, name: user.name, role: user.role || 'student', isActive: user.isActive !== false, profileImage: user.profileImage, friendCode: user.friendCode } : null,
    profile: profile ? {
      campusId: profile.campusId || null,
      verificationStatus: profile.verificationStatus || 'unverified',
      verifiedAt: profile.verifiedAt || null,
      year: profile.year,
      branch: profile.branch,
      dob: profile.dob || null,
      isAdult: !!profile.isAdult,
      dobLockedAt: profile.dobLockedAt || null,
      roles: Array.isArray(profile.roles) ? profile.roles : ['student'],
    } : null,
    campus: campus ? { id: campus.id, code: campus.code, name: campus.name, isActive: campus.isActive !== false } : null,
    sanctions,
    settings: settings ? settings.get({ plain: true }) : null,
  };
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), ctx });
  return ctx;
};

/** Active sanction covering this scope (or the whole of Friends), if any. */
const activeSanction = (ctx, feature) => {
  const now = Date.now();
  return (ctx.sanctions || []).find((s) => (s.scope === 'friends' || (feature && s.scope === feature))
    && (!s.until || new Date(s.until).getTime() > now)) || null;
};

/** Base reasons (empty = eligible for the Friends foundation). Ordered most fundamental first. */
const baseReasons = (ctx, cfg) => {
  const reasons = [];
  if (!ctx.user) return ['ACCOUNT_REQUIRED'];
  // Switched off by the admin: that is what every student should be told (not "verify your campus first").
  if (cfg && !cfg.enabled) reasons.push('FRIENDS_OFF');
  if (!ctx.user.isActive) reasons.push('ACCOUNT_SUSPENDED');
  if (!ctx.profile || !ctx.profile.campusId) reasons.push('CAMPUS_REQUIRED');
  if (!ctx.profile || ctx.profile.verificationStatus !== 'verified') reasons.push('VERIFICATION_REQUIRED');
  if (ctx.profile && ctx.profile.campusId && (!ctx.campus || !ctx.campus.isActive)) reasons.push('CAMPUS_INACTIVE');
  if (activeSanction(ctx, null)) reasons.push('FRIENDS_SANCTIONED');
  return reasons;
};

const guidelinesAccepted = (ctx, cfg) => !!(ctx.settings && ctx.settings.guidelinesAcceptedAt
  && Number(ctx.settings.guidelinesVersion) >= cfg.guidelines.version);

/** Connect pre-checks available in Phase 0 (Phase 4 adds consent / liveness state from its tables). */
const connectReasons = (ctx, cfg) => {
  const reasons = [];
  if (!flags.isEnabled(cfg, 'connect')) reasons.push('FEATURE_OFF');
  if (!ctx.profile || !ctx.profile.dob) reasons.push('DOB_REQUIRED');
  else if (!ctx.profile.isAdult) reasons.push('NOT_ADULT');
  if (activeSanction(ctx, 'connect')) reasons.push('FRIENDS_SANCTIONED');
  return reasons;
};

/**
 * Throws the right FriendsError when this user may not use `feature` (null = foundation).
 * opts.write: also require accepted guidelines. opts.minimal: only require a real, active account
 * (reports, appeals and "my moderation" stay available to unverified or sanctioned users).
 */
const assertAllowed = (ctx, cfg, feature, opts = {}) => {
  if (!ctx.user) throw fail(403, 'ACCOUNT_REQUIRED', 'Sign in with a student account to use Friends.');
  if (!ctx.user.isActive) throw fail(403, 'ACCOUNT_SUSPENDED', 'Your account is suspended.');
  if (opts.minimal) return;
  const reasons = baseReasons(ctx, cfg);
  const verification = reasons.find((r) => ['CAMPUS_REQUIRED', 'VERIFICATION_REQUIRED', 'CAMPUS_INACTIVE'].includes(r));
  if (verification) {
    throw fail(403, 'VERIFICATION_REQUIRED', 'Verify your college to use Friends.', { reason: verification, reasons });
  }
  const sanction = activeSanction(ctx, feature);
  if (sanction) {
    throw fail(403, 'FRIENDS_SANCTIONED', sanction.until
      ? 'You cannot use this part of Friends until your restriction ends.'
      : 'You cannot use this part of Friends. You can appeal from Friends privacy & safety.', { scope: sanction.scope, until: sanction.until });
  }
  if (!flags.isEnabled(cfg, feature)) {
    throw fail(403, 'FEATURE_OFF', 'This part of Friends is not available yet.', { feature: feature || 'friends' });
  }
  if (opts.write && !guidelinesAccepted(ctx, cfg)) {
    throw fail(428, 'GUIDELINES_REQUIRED', 'Please read and accept the Friends guidelines first.', { version: cfg.guidelines.version });
  }
};

/**
 * Express middleware: protect -> requireFriends(feature, { write, minimal }).
 * Sets req.friends = { ctx, cfg }. Client-sent role / campusId / verified fields are never read.
 */
const requireFriends = (feature = null, opts = {}) => async (req, res, next) => {
  try {
    const [ctx, cfg] = await Promise.all([loadContext(req.user && req.user.id), flags.getConfig()]);
    assertAllowed(ctx, cfg, feature, opts);
    req.friends = { ctx, cfg };
    return next();
  } catch (err) {
    return sendError(res, err, 'FRIENDS_GATE');
  }
};

/** Full GET /eligibility payload. */
const describe = (ctx, cfg, { limits } = {}) => {
  const reasons = baseReasons(ctx, cfg);
  const eligible = reasons.length === 0;
  const sanction = activeSanction(ctx, null);
  const cReasons = eligible ? connectReasons(ctx, cfg) : ['NOT_ELIGIBLE', ...connectReasons(ctx, cfg)];
  return {
    eligible,
    reasons,
    campus: ctx.campus ? { id: ctx.campus.id, code: ctx.campus.code, name: ctx.campus.name } : null,
    verification: {
      status: ctx.profile ? ctx.profile.verificationStatus : 'unverified',
      verifiedAt: ctx.profile ? ctx.profile.verifiedAt : null,
    },
    features: eligible ? flags.featureMap(cfg) : Object.fromEntries(Object.keys(flags.featureMap(cfg)).map((f) => [f, false])),
    sanctions: (ctx.sanctions || []).map((s) => ({ scope: s.scope, until: s.until })),
    sanction: sanction ? { scope: sanction.scope, until: sanction.until } : null,
    guidelines: {
      version: cfg.guidelines.version,
      accepted: guidelinesAccepted(ctx, cfg),
      acceptedVersion: ctx.settings ? ctx.settings.guidelinesVersion || null : null,
      url: process.env.FRIENDS_GUIDELINES_URL || null,
    },
    connect: { eligible: cReasons.length === 0, reasons: cReasons },
    limits: limits || {},
  };
};

module.exports = {
  loadContext,
  clearEligibility,
  requireFriends,
  assertAllowed,
  describe,
  activeSanction,
  baseReasons,
  guidelinesAccepted,
};
