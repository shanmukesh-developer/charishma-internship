/**
 * Friends > Forum (Phase 1): /api/campus/forum. Contract: backend_contract.md "Friends (forum)".
 *
 * Communities (8 defaults per campus + admin-approved custom ones), posts of six types, threaded
 * comments (depth <= 5), up/down votes with exact concurrent totals, Hot/New/Top, best answer,
 * bookmarks, search, pinned Freshers Guides (official vs student advice), karma + badges with
 * anti-farming, structured reviews (one active review per reviewer per target, reviewer never
 * exposed), faculty-review safety, right of reply, scoped community moderators with conflict-of-
 * interest checks and a mod log. Reports / appeals / reveal-author reuse the Phase 0 services via
 * the target resolvers registered at the bottom of this file.
 *
 * Privacy rules enforced here:
 *  - authorId / targetAuthorId / the reviewer never leave the server (identity.authorOf + scrub).
 *  - Anonymous content earns no karma and its audit rows carry no actor id (only reveal-author,
 *    which is itself audited, links an anonymous row to a person).
 *  - Blocks and mutes filter NAMED content only. Filtering anonymous content by its real author
 *    would let anyone de-anonymise a post by blocking candidates and watching it disappear.
 */
const crypto = require('crypto');
const { Op } = require('sequelize');
const { getModel, getSequelize } = require('../index');
const pgLock = require('../../../utils/pgLock');
const flags = require('../services/featureFlags');
const limiter = require('../services/limiter');
const identity = require('../services/identity');
const cursor = require('../services/cursor');
const blocks = require('../services/blocks');
const reportsSvc = require('../services/reports');
const targets = require('../services/targets');
const audit = require('../services/audit');
const alias = require('../services/alias');
const contentPolicy = require('../services/contentPolicy');
const reviewSafety = require('../services/reviewSafety');
const rank = require('../services/forumRank');
const { notify } = require('../services/notify');
const { fail, requireUuid, isUuid, isUniqueError, optText } = require('../services/http');
const F = require('../models/forum/enums');
const seed = require('../seed/communities');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

limiter.define('forum_post', 10, HOUR);
limiter.define('forum_comment', 60, HOUR);
limiter.define('forum_vote', 300, HOUR);
limiter.define('forum_review', 5, DAY);
limiter.define('forum_edit', 30, HOUR);
limiter.define('forum_bookmark', 120, HOUR);
limiter.define('forum_join', 60, HOUR);
limiter.define('forum_mod', 120, HOUR);
limiter.define('community_request', 3, DAY);
limiter.define('review_target', 10, DAY);
limiter.define('review_response', 20, DAY);

const KARMA_PER_PAIR_PER_DAY = 3;
const RESOURCE_CREDIT_UPVOTES = 3;
const PIN_LIMIT = 5;
const BADGE_RULES = [
  { code: 'helpful_answer', field: 'helpfulAnswers', min: 1 },
  { code: 'community_helper', field: 'helpfulAnswers', min: 5 },
  { code: 'resource_sharer', field: 'resourcesShared', min: 3 },
  { code: 'top_contributor', field: 'karma', min: 50 },
];
const MEDIA_PURPOSES = ['forum', 'post', 'other', 'chat'];
const OFFICIAL_ENTITY_TYPES = ['official', 'department'];

const M = (name) => getModel(name);
const likeOp = () => (getSequelize().getDialect() === 'postgres' ? Op.iLike : Op.like);

const send = (res, status, payload) => res.status(status).json(identity.scrub(payload));

const notifyAdmin = (type, action, id, extra) => {
  try { require('../../../utils/realtime').notifyAdmin(type, action, id, extra); } catch { /* optional */ }
};

const requiredText = (value, min, max, field) => {
  if (typeof value !== 'string') throw fail(400, 'INVALID_INPUT', `${field} is required.`, { field });
  const v = value.trim();
  if (v.length < min) throw fail(400, 'TOO_SHORT', `${field} must be at least ${min} characters.`, { field, min });
  if (v.length > max) throw fail(400, 'TOO_LONG', `${field} can be at most ${max} characters.`, { field, max });
  return v;
};

const escapeLike = (s) => String(s).replace(/[%_\\]/g, '');

const ctxOf = (req) => (req.friends && req.friends.ctx) || null;
const campusOf = (req) => {
  const ctx = ctxOf(req);
  return ctx && ctx.profile ? ctx.profile.campusId : null;
};

// ── Shared lookups ───────────────────────────────────────────────────────────
const myRoles = async (userId) => {
  const rows = await M('FriendsCommunityRole').findAll({ where: { userId }, attributes: ['communityId', 'role'] });
  return new Map(rows.map((r) => [String(r.communityId), r.role]));
};

const roleIn = async (communityId, userId) => {
  if (!userId) return null;
  const r = await M('FriendsCommunityRole').findOne({ where: { communityId, userId }, attributes: ['role'] });
  return r ? r.role : null;
};

/** Active, verified entities of a campus that this user manages (optionally of some types). */
const managedEntities = async (userId, campusId, types) => {
  if (!userId || !campusId) return [];
  const where = { campusId, status: 'active', verified: true };
  if (types) where.type = { [Op.in]: types };
  const rows = await M('FriendsEntity').findAll({ where, attributes: ['id', 'type', 'managerIds'] });
  return rows.filter((e) => (e.managerIds || []).map(String).includes(String(userId)));
};

const isOfficialAuthor = async (ctx) => {
  if (!ctx || !ctx.user) return false;
  if (ctx.user.role === 'admin') return true;
  return (await managedEntities(ctx.user.id, ctx.profile && ctx.profile.campusId, OFFICIAL_ENTITY_TYPES)).length > 0;
};

/** Community of the caller's campus (404 for another campus, an archived one, or a bad id). */
const loadCommunity = async (idOrSlug, campusId, { allowPendingFor } = {}) => {
  const where = isUuid(idOrSlug) ? { id: idOrSlug } : { slug: String(idOrSlug || '').toLowerCase().slice(0, 40), campusId };
  const c = await M('FriendsCommunity').findOne({ where });
  if (!c || String(c.campusId) !== String(campusId)) throw fail(404, 'COMMUNITY_NOT_FOUND', 'Community not found.');
  if (c.status === 'active') return c;
  if (c.status === 'pending' && allowPendingFor && String(c.createdBy) === String(allowPendingFor)) return c;
  throw fail(404, 'COMMUNITY_NOT_FOUND', 'Community not found.');
};

const resolveMedia = async (mediaIds, ownerId) => {
  if (mediaIds === undefined || mediaIds === null) return [];
  if (!Array.isArray(mediaIds)) throw fail(400, 'INVALID_MEDIA', 'mediaIds must be a list.');
  const ids = [...new Set(mediaIds.map(String))];
  if (ids.length > 4) throw fail(400, 'TOO_MANY_MEDIA', 'You can attach at most 4 images.', { max: 4 });
  if (!ids.length) return [];
  if (!ids.every(isUuid)) throw fail(400, 'INVALID_MEDIA', 'One of the images is not valid.');
  const rows = await M('CampusMedia').findAll({ where: { id: { [Op.in]: ids } }, attributes: ['id', 'ownerId', 'isPrivate', 'purpose'] });
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  for (const id of ids) {
    const r = byId.get(id);
    if (!r || String(r.ownerId) !== String(ownerId) || r.isPrivate || !MEDIA_PURPOSES.includes(r.purpose)) {
      throw fail(400, 'INVALID_MEDIA', 'Upload the image again and attach it from this device.');
    }
  }
  return ids.map((id) => ({ mediaId: id }));
};

/** Structured links: http(s) only, <= 5, denylist checked. Returns { links, flagged }. */
const parseLinks = (raw, cfg) => {
  if (raw === undefined || raw === null) return { links: [], flagged: false };
  if (!Array.isArray(raw)) throw fail(400, 'INVALID_LINKS', 'links must be a list.');
  if (raw.length > 5) throw fail(400, 'TOO_MANY_LINKS', 'You can add at most 5 links.', { max: 5 });
  let flagged = false;
  const links = raw.map((l) => {
    const url = typeof l === 'string' ? l : l && l.url;
    const r = contentPolicy.checkLink(url, cfg);
    if (!r.ok) {
      throw fail(422, 'CONTENT_BLOCKED', contentPolicy.REASON_TEXT[r.reason] || 'That link is not allowed.', { reasons: [r.reason] });
    }
    if (r.flag) flagged = true;
    return { url: String(url).trim(), host: r.host };
  });
  return { links, flagged };
};

const flagCategory = (reasons) => {
  if (reasons.includes('SELF_HARM')) return 'self_harm';
  if (reasons.includes('ALLEGATION') || reasons.includes('PERSONAL_DETAILS')) return 'defamation';
  if (reasons.some((r) => /SPAM|LINK/.test(r))) return 'spam';
  return 'other';
};

// ── Counters (always recounted from the source rows: exact under concurrency) ──
const recountVotes = async (targetType, targetId) => {
  const table = targetType === 'forum_post' ? 'FriendsForumPosts' : 'FriendsForumComments';
  const sub = (v) => `(SELECT COUNT(*) FROM "FriendsVotes" WHERE "targetType" = :tt AND "targetId" = :id AND "value" = ${v})`;
  await getSequelize().query(
    `UPDATE "${table}" SET "upCount" = ${sub(1)}, "downCount" = ${sub(-1)}, "score" = ${sub(1)} - ${sub(-1)} WHERE "id" = :id`,
    { replacements: { tt: targetType, id: targetId } },
  );
};

const refreshHot = async (postId) => {
  const post = await M('FriendsForumPost').findByPk(postId, { attributes: ['id', 'score', 'createdAt', 'commentCount'] });
  if (!post) return null;
  const hot = rank.hotRank(post.score, post.createdAt, post.commentCount);
  await M('FriendsForumPost').update({ hotRank: hot }, { where: { id: postId }, silent: true });
  return hot;
};

const recountComments = async (postId) => {
  await getSequelize().query(
    'UPDATE "FriendsForumPosts" SET "commentCount" = (SELECT COUNT(*) FROM "FriendsForumComments" WHERE "postId" = :id AND "status" = \'visible\') WHERE "id" = :id',
    { replacements: { id: postId } },
  );
  await refreshHot(postId);
};

const recountCommunity = async (communityId) => {
  await getSequelize().query(
    `UPDATE "FriendsCommunities" SET
      "postCount" = (SELECT COUNT(*) FROM "FriendsForumPosts" WHERE "communityId" = :id AND "status" = 'visible'),
      "memberCount" = (SELECT COUNT(*) FROM "FriendsEdges" WHERE "kind" = 'member' AND "targetType" = 'community' AND "targetId" = :id)
     WHERE "id" = :id`,
    { replacements: { id: communityId } },
  );
};

const recomputeTarget = async (targetId) => {
  await getSequelize().query(
    `UPDATE "FriendsReviewTargets" SET
      "ratingSum" = (SELECT COALESCE(SUM("rating"), 0) FROM "FriendsReviews" WHERE "targetId" = :id AND "active" = :t AND "status" = 'published'),
      "reviewCount" = (SELECT COUNT(*) FROM "FriendsReviews" WHERE "targetId" = :id AND "active" = :t AND "status" = 'published')
     WHERE "id" = :id`,
    { replacements: { id: targetId, t: true } },
  );
};

// ── Karma & badges ───────────────────────────────────────────────────────────
const karmaRow = async (userId, campusId) => {
  const FriendsKarma = M('FriendsKarma');
  const found = await FriendsKarma.findOne({ where: { userId } });
  if (found) return found;
  try {
    return await FriendsKarma.create({ userId, campusId: campusId || null });
  } catch (err) {
    if (!isUniqueError(err)) throw err;
    return FriendsKarma.findOne({ where: { userId } });
  }
};

const KARMA_FIELDS = ['karma', 'helpfulAnswers', 'resourcesShared'];
const bumpKarma = async (userId, campusId, field, by) => {
  if (!userId || !KARMA_FIELDS.includes(field) || !by) return;
  await karmaRow(userId, campusId);
  if (by > 0) {
    await getSequelize().query(`UPDATE "FriendsKarma" SET "${field}" = "${field}" + :by WHERE "userId" = :u`, { replacements: { by, u: userId } });
  } else {
    await getSequelize().query(`UPDATE "FriendsKarma" SET "${field}" = CASE WHEN "${field}" >= :n THEN "${field}" - :n ELSE 0 END WHERE "userId" = :u`, { replacements: { n: -by, u: userId } });
  }
  await evaluateBadges(userId);
};

/** Auto badges; earned badges are kept (karma can never grant any admin power). */
const evaluateBadges = async (userId) => {
  try {
    const k = await M('FriendsKarma').findOne({ where: { userId } });
    if (!k) return [];
    const FriendsBadge = M('FriendsBadge');
    const granted = [];
    for (const rule of BADGE_RULES) {
      if ((Number(k[rule.field]) || 0) < rule.min) continue;
      try {
        const [, created] = await FriendsBadge.findOrCreate({ where: { userId, code: rule.code }, defaults: { userId, code: rule.code, source: 'auto' } });
        if (created) granted.push(rule.code);
      } catch (err) {
        if (!isUniqueError(err)) throw err;
      }
    }
    return granted;
  } catch (err) {
    console.warn('[FORUM_BADGE_WARN]', err.message);
    return [];
  }
};

// ── Serialization ────────────────────────────────────────────────────────────
const mediaOut = (req, media) => (media || []).map((m) => ({
  mediaId: m.mediaId,
  url: require('../../campus/campusHelpers').absolutize(req, `/api/campus/media/${m.mediaId}`),
}));

const canSee = (row, viewerId, isMod) => {
  if (row.status === 'visible') return true;
  if (row.status === 'deleted') return false;
  return (viewerId && String(row.authorId) === String(viewerId)) || !!isMod;
};

const loadResponses = async (req, reviewIds, viewerId) => {
  if (!reviewIds.length) return new Map();
  const rows = await M('FriendsReviewResponse').findAll({ where: { reviewId: { [Op.in]: reviewIds }, status: 'visible' } });
  const ids = await identity.loadIdentities(req, rows.map((r) => r.responderId), { viewerId });
  return new Map(rows.map((r) => [String(r.reviewId), {
    id: r.id,
    body: r.body,
    responderRole: r.responderRole,
    responder: r.responderRole === 'admin'
      ? { name: 'ZenWe Friends team', official: true }
      : { ...(ids.get(String(r.responderId)) || { name: 'Faculty' }), official: true },
    createdAt: r.createdAt,
    editedAt: r.editedAt,
  }]));
};

const reviewOut = (rv, target, response, viewerId) => ({
  id: rv.id,
  targetId: rv.targetId,
  target: target ? { id: target.id, kind: target.kind, name: target.name } : null,
  rating: rv.rating,
  pros: rv.pros,
  cons: rv.cons,
  periodLabel: rv.periodLabel,
  context: rv.context || {},
  status: rv.status,
  underReview: rv.status === 'pending_review',
  isMine: !!viewerId && String(rv.authorId) === String(viewerId) ? true : undefined,
  response: response || null,
  createdAt: rv.createdAt,
  editedAt: rv.editedAt,
});

/**
 * Post DTOs for a viewer. full=false returns a 300-char body excerpt for lists.
 * Never copies authorId; anonymous authors become { anonymous, alias, isMine? }.
 */
const serializePosts = async (req, rows, viewerId, { full = false, roles = null } = {}) => {
  if (!rows.length) return [];
  const postIds = rows.map((p) => p.id);
  const named = rows.filter((p) => !p.isAnonymous).map((p) => p.authorId);
  const communityIds = [...new Set(rows.map((p) => String(p.communityId)))];
  const reviewPostIds = rows.filter((p) => p.type === 'review').map((p) => p.id);
  const [ids, communities, myVotes, myMarks, reviews] = await Promise.all([
    identity.loadIdentities(req, named, { viewerId }),
    M('FriendsCommunity').findAll({ where: { id: { [Op.in]: communityIds } }, attributes: ['id', 'slug', 'name'] }),
    viewerId ? M('FriendsVote').findAll({ where: { userId: viewerId, targetType: 'forum_post', targetId: { [Op.in]: postIds } }, attributes: ['targetId', 'value'] }) : [],
    viewerId ? M('FriendsReaction').findAll({ where: { userId: viewerId, targetType: 'forum_post', kind: 'bookmark', targetId: { [Op.in]: postIds } }, attributes: ['targetId'] }) : [],
    reviewPostIds.length ? M('FriendsReview').findAll({ where: { forumPostId: { [Op.in]: reviewPostIds } } }) : [],
  ]);
  const commOf = new Map(communities.map((c) => [String(c.id), { id: c.id, slug: c.slug, name: c.name }]));
  const voteOf = new Map(myVotes.map((v) => [String(v.targetId), v.value]));
  const marked = new Set(myMarks.map((m) => String(m.targetId)));
  const reviewOf = new Map(reviews.map((r) => [String(r.forumPostId), r]));
  const targetIds = [...new Set(reviews.map((r) => String(r.targetId)))];
  const reviewTargets = targetIds.length ? await M('FriendsReviewTarget').findAll({ where: { id: { [Op.in]: targetIds } } }) : [];
  const targetOf = new Map(reviewTargets.map((t) => [String(t.id), t]));
  const responses = await loadResponses(req, reviews.map((r) => r.id), viewerId);

  return rows.map((p) => {
    const mine = !!viewerId && String(p.authorId) === String(viewerId);
    const body = p.body || '';
    const rv = reviewOf.get(String(p.id));
    const role = roles ? roles.get(String(p.communityId)) || null : null;
    return {
      id: p.id,
      communityId: p.communityId,
      community: commOf.get(String(p.communityId)) || null,
      type: p.type,
      title: p.title,
      body: full || body.length <= 300 ? body : `${body.slice(0, 300)}...`,
      bodyTruncated: !full && body.length > 300,
      media: mediaOut(req, p.media),
      links: p.links || [],
      author: identity.authorOf(p, ids, viewerId),
      isOfficial: !!p.isOfficial,
      label: p.isOfficial ? 'official' : 'student',
      isPinned: !!p.isPinned,
      isFreshersGuide: !!p.isFreshersGuide,
      isLocked: !!p.isLocked,
      bestCommentId: p.bestCommentId || null,
      status: p.status,
      underReview: p.status === 'pending_review',
      removedReason: (mine || role) && ['removed', 'hidden'].includes(p.status) ? (p.removedReason || null) : undefined,
      up: p.upCount,
      down: p.downCount,
      score: p.score,
      commentCount: p.commentCount,
      myVote: voteOf.get(String(p.id)) || 0,
      bookmarked: marked.has(String(p.id)),
      canEdit: mine && !['removed', 'hidden', 'deleted'].includes(p.status),
      canModerate: !!role,
      review: rv ? reviewOut(rv, targetOf.get(String(rv.targetId)), responses.get(String(rv.id)), viewerId) : undefined,
      createdAt: p.createdAt,
      editedAt: p.editedAt,
      lastActivityAt: p.lastActivityAt || p.createdAt,
    };
  });
};

const serializeComments = async (req, rows, viewerId, { isMod = false, blocked = null } = {}) => {
  if (!rows.length) return [];
  const named = rows.filter((c) => !c.isAnonymous && c.status === 'visible').map((c) => c.authorId);
  const [ids, myVotes] = await Promise.all([
    identity.loadIdentities(req, named, { viewerId }),
    viewerId ? M('FriendsVote').findAll({ where: { userId: viewerId, targetType: 'forum_comment', targetId: { [Op.in]: rows.map((c) => c.id) } }, attributes: ['targetId', 'value'] }) : [],
  ]);
  const voteOf = new Map(myVotes.map((v) => [String(v.targetId), v.value]));
  return rows.map((c) => {
    const mine = !!viewerId && String(c.authorId) === String(viewerId);
    if (blocked && !c.isAnonymous && !mine && blocked.has(String(c.authorId)) && c.status !== 'deleted') {
      return { id: c.id, postId: c.postId, parentId: c.parentId, depth: c.depth, status: 'blocked', body: null, author: null, createdAt: c.createdAt };
    }
    if (!canSee(c, viewerId, isMod)) {
      // Tombstone keeps the thread shape; no author, no text.
      return { id: c.id, postId: c.postId, parentId: c.parentId, depth: c.depth, status: c.status === 'deleted' ? 'deleted' : 'removed', body: null, author: null, createdAt: c.createdAt };
    }
    return {
      id: c.id,
      postId: c.postId,
      parentId: c.parentId,
      depth: c.depth,
      body: c.body,
      author: identity.authorOf(c, ids, viewerId),
      status: c.status,
      underReview: c.status === 'pending_review',
      removedReason: ['removed', 'hidden'].includes(c.status) ? c.removedReason || null : undefined,
      isOfficialReply: !!c.isOfficialReply,
      up: c.upCount,
      down: c.downCount,
      score: c.score,
      myVote: voteOf.get(String(c.id)) || 0,
      canEdit: mine && c.status !== 'removed' && c.status !== 'hidden',
      createdAt: c.createdAt,
      editedAt: c.editedAt,
    };
  });
};

/** Named authors blocked either way are filtered; anonymous rows never are (see header). */
const blockFilter = (blocked) => (blocked.size
  ? { [Op.or]: [{ isAnonymous: true }, { authorId: { [Op.notIn]: [...blocked] } }] }
  : null);

const communityOut = (c, { isMember, myRole, guide }) => ({
  id: c.id,
  slug: c.slug,
  name: c.name,
  description: c.description,
  rules: c.rules || [],
  kind: c.kind,
  allowAnonymous: !!c.allowAnonymous,
  allowedTypes: c.allowedTypes || [],
  status: c.status,
  memberCount: c.memberCount,
  postCount: c.postCount,
  isMember: !!isMember,
  myRole: myRole || null,
  freshersGuide: guide ? { postId: guide.id, title: guide.title, isOfficial: !!guide.isOfficial, label: guide.isOfficial ? 'official' : 'student', updatedAt: guide.editedAt || guide.createdAt } : null,
});

// ═════════════════════════════════════════════════════════════════════════════
// Communities
// ═════════════════════════════════════════════════════════════════════════════

// GET /communities
const listCommunities = async (req, res) => {
  const me = req.user.id;
  const campusId = campusOf(req);
  await seed.ensureDefaults(getSequelize(), campusId);
  const rows = await M('FriendsCommunity').findAll({
    where: { campusId, [Op.or]: [{ status: 'active' }, { status: 'pending', createdBy: me }] },
    order: [['sortOrder', 'ASC'], ['name', 'ASC']],
  });
  const ids = rows.map((c) => c.id);
  const [edges, roles, guides] = await Promise.all([
    M('FriendsEdge').findAll({ where: { userId: me, kind: 'member', targetType: 'community', targetId: { [Op.in]: ids } }, attributes: ['targetId'] }),
    myRoles(me),
    M('FriendsForumPost').findAll({ where: { communityId: { [Op.in]: ids }, isFreshersGuide: true, status: 'visible' }, attributes: ['id', 'communityId', 'title', 'isOfficial', 'createdAt', 'editedAt'] }),
  ]);
  const member = new Set(edges.map((e) => String(e.targetId)));
  const guideOf = new Map(guides.map((g) => [String(g.communityId), g]));
  send(res, 200, {
    items: rows.map((c) => communityOut(c, { isMember: member.has(String(c.id)), myRole: roles.get(String(c.id)), guide: guideOf.get(String(c.id)) })),
  });
};

// GET /communities/:idOrSlug
const getCommunity = async (req, res) => {
  const me = req.user.id;
  const campusId = campusOf(req);
  await seed.ensureDefaults(getSequelize(), campusId);
  const c = await loadCommunity(req.params.id, campusId, { allowPendingFor: me });
  const [edge, role, guide, mods] = await Promise.all([
    M('FriendsEdge').findOne({ where: { userId: me, kind: 'member', targetType: 'community', targetId: c.id } }),
    roleIn(c.id, me),
    M('FriendsForumPost').findOne({ where: { communityId: c.id, isFreshersGuide: true, status: 'visible' } }),
    M('FriendsCommunityRole').findAll({ where: { communityId: c.id }, order: [['createdAt', 'ASC']] }),
  ]);
  const ids = await identity.loadIdentities(req, mods.map((m) => m.userId), { viewerId: me });
  send(res, 200, {
    community: {
      ...communityOut(c, { isMember: !!edge, myRole: role, guide }),
      moderators: mods.map((m) => ({ role: m.role, user: ids.get(String(m.userId)) || null })).filter((m) => m.user),
    },
  });
};

// POST /communities { name, description, rules[] } — students request; admins approve (admin API).
const requestCommunity = async (req, res) => {
  const me = req.user.id;
  const campusId = campusOf(req);
  const b = req.body || {};
  const name = requiredText(b.name, 3, 60, 'Name');
  const description = optText(b.description, 300, 'Description');
  const rules = Array.isArray(b.rules) ? b.rules.slice(0, 10).map((r) => requiredText(r, 3, 200, 'Rule')) : [];
  contentPolicy.enforce([name, description, ...rules].filter(Boolean).join('\n'), { kind: 'forum_post' });
  const slug = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  if (slug.length < 3) throw fail(400, 'INVALID_NAME', 'Use letters or numbers in the community name.');
  const pending = await M('FriendsCommunity').count({ where: { createdBy: me, status: 'pending' } });
  if (pending >= 3) throw fail(429, 'TOO_MANY_REQUESTS', 'You already have 3 community requests waiting for review.');
  limiter.enforce(me, 'community_request');
  let row;
  try {
    row = await M('FriendsCommunity').create({
      campusId, slug, name, description, rules, kind: 'custom', allowAnonymous: true, allowedTypes: F.POST_TYPES, status: 'pending', createdBy: me,
    });
  } catch (err) {
    if (isUniqueError(err)) throw fail(409, 'SLUG_TAKEN', 'A community with that name already exists.');
    throw err;
  }
  notifyAdmin('friends_review', 'created', row.id, { scope: 'community' });
  send(res, 201, { community: communityOut(row, {}), status: 'pending' });
};

// PUT /communities/:id — community owner (admins use the admin API). Description, rules, anonymity, types.
const updateCommunity = async (req, res) => {
  const me = req.user.id;
  const c = await loadCommunity(req.params.id, campusOf(req));
  const role = await roleIn(c.id, me);
  if (role !== 'owner') throw fail(403, 'NOT_OWNER', 'Only the community owner can change these settings.');
  const patch = parseCommunityPatch(req.body || {}, { allowName: c.kind === 'custom' });
  await c.update(patch);
  await audit.recordSafe({ actorId: me, actorRole: 'community_mod', action: 'entity_update', targetType: 'community', targetId: c.id, communityId: c.id, meta: { fields: Object.keys(patch) } });
  send(res, 200, { community: communityOut(c, { myRole: role }) });
};

const parseCommunityPatch = (b, { allowName = true, admin = false } = {}) => {
  const patch = {};
  if (b.name !== undefined && allowName) patch.name = requiredText(b.name, 3, 60, 'Name');
  if (b.description !== undefined) patch.description = optText(b.description, 300, 'Description');
  if (b.rules !== undefined) {
    if (!Array.isArray(b.rules) || b.rules.length > 10) throw fail(400, 'INVALID_RULES', 'Rules must be a list of up to 10.');
    patch.rules = b.rules.map((r) => requiredText(r, 3, 200, 'Rule'));
  }
  if (b.allowAnonymous !== undefined) {
    if (typeof b.allowAnonymous !== 'boolean') throw fail(400, 'INVALID_INPUT', 'allowAnonymous must be true or false.');
    patch.allowAnonymous = b.allowAnonymous;
  }
  if (b.allowedTypes !== undefined) {
    if (!Array.isArray(b.allowedTypes) || !b.allowedTypes.length || b.allowedTypes.some((t) => !F.POST_TYPES.includes(t))) {
      throw fail(400, 'INVALID_TYPES', `allowedTypes must be a non-empty list of ${F.POST_TYPES.join(', ')}.`);
    }
    patch.allowedTypes = [...new Set(b.allowedTypes)];
  }
  if (admin && b.sortOrder !== undefined) {
    if (!Number.isInteger(b.sortOrder) || b.sortOrder < 0 || b.sortOrder > 10000) throw fail(400, 'INVALID_INPUT', 'sortOrder must be 0-10000.');
    patch.sortOrder = b.sortOrder;
  }
  if (Object.values(patch).some((v) => typeof v === 'string')) {
    contentPolicy.enforce(Object.values(patch).filter((v) => typeof v === 'string').join('\n'), { kind: 'forum_post' });
  }
  return patch;
};

// POST /communities/:id/join  ·  POST /communities/:id/leave
const joinCommunity = async (req, res) => {
  const me = req.user.id;
  const c = await loadCommunity(req.params.id, campusOf(req));
  limiter.enforce(me, 'forum_join');
  let duplicate = false;
  try {
    await M('FriendsEdge').create({ userId: me, kind: 'member', targetType: 'community', targetId: c.id });
  } catch (err) {
    if (!isUniqueError(err)) throw err;
    duplicate = true;
  }
  await recountCommunity(c.id);
  await c.reload();
  send(res, duplicate ? 200 : 201, { isMember: true, duplicate, memberCount: c.memberCount });
};

const leaveCommunity = async (req, res) => {
  const me = req.user.id;
  const c = await loadCommunity(req.params.id, campusOf(req));
  const removed = await M('FriendsEdge').destroy({ where: { userId: me, kind: 'member', targetType: 'community', targetId: c.id } });
  await recountCommunity(c.id);
  await c.reload();
  send(res, 200, { isMember: false, removed: removed > 0, memberCount: c.memberCount });
};

// ═════════════════════════════════════════════════════════════════════════════
// Posts
// ═════════════════════════════════════════════════════════════════════════════

const parseSort = (raw) => {
  const sort = String(raw || 'hot');
  if (!rank.SORTS.includes(sort)) throw fail(400, 'INVALID_SORT', 'Sort must be hot, new or top.');
  return sort;
};

const typeFilter = (raw) => {
  if (raw === undefined || raw === null || raw === '') return null;
  const t = String(raw);
  if (!F.POST_TYPES.includes(t)) throw fail(400, 'INVALID_TYPE', `Type must be one of ${F.POST_TYPES.join(', ')}.`);
  return t;
};

// GET /communities/:id/posts?sort=hot|new|top&t=day|week|month|year|all&type=&q=&cursor=&limit=
const listPosts = async (req, res) => {
  const me = req.user.id;
  const c = await loadCommunity(req.params.id, campusOf(req));
  const q = req.query || {};
  const sort = parseSort(q.sort);
  const type = typeFilter(q.type);
  const spec = rank.sortSpec(sort);
  const limit = cursor.pageSize(q.limit, 20);
  const blocked = await blocks.blockedIds(me);
  const and = [{ communityId: c.id, status: 'visible' }];
  if (type) and.push({ type });
  const bf = blockFilter(blocked);
  if (bf) and.push(bf);
  if (q.q) {
    const term = escapeLike(String(q.q).trim().slice(0, 80));
    if (term) and.push({ [Op.or]: [{ title: { [likeOp()]: `%${term}%` } }, { body: { [likeOp()]: `%${term}%` } }] });
  }
  if (sort === 'top' && q.t && q.t !== 'all') {
    if (!Object.prototype.hasOwnProperty.call(rank.TOP_WINDOWS, q.t)) throw fail(400, 'INVALID_WINDOW', 'Window must be day, week, month, year or all.');
    and.push({ createdAt: { [Op.gte]: new Date(Date.now() - rank.TOP_WINDOWS[q.t]) } });
  }
  const pinnedWhere = [...and, { isPinned: true }];
  and.push({ isPinned: false });
  const after = cursor.after(q.cursor, spec.field, spec.kind);
  if (after) and.push(after);
  const rows = await M('FriendsForumPost').findAll({ where: { [Op.and]: and }, order: [[spec.field, 'DESC'], ['id', 'DESC']], limit: limit + 1 });
  const { items, nextCursor } = cursor.page(rows, limit, spec.field);
  const roles = await myRoles(me);
  const pinned = q.cursor ? [] : await M('FriendsForumPost').findAll({ where: { [Op.and]: pinnedWhere }, order: [['isFreshersGuide', 'DESC'], ['createdAt', 'DESC']], limit: PIN_LIMIT + 1 });
  send(res, 200, {
    sort,
    pinned: await serializePosts(req, pinned, me, { roles }),
    items: await serializePosts(req, items, me, { roles }),
    nextCursor,
  });
};

// GET /search?q=&communityId=&type=&cursor=
const search = async (req, res) => {
  const me = req.user.id;
  const campusId = campusOf(req);
  const q = req.query || {};
  const term = escapeLike(String(q.q || '').trim().slice(0, 80));
  if (term.length < 2) throw fail(400, 'QUERY_TOO_SHORT', 'Type at least 2 characters to search.');
  const type = typeFilter(q.type);
  const limit = cursor.pageSize(q.limit, 20);
  const active = await M('FriendsCommunity').findAll({ where: { campusId, status: 'active' }, attributes: ['id'] });
  let communityIds = active.map((c) => String(c.id));
  if (q.communityId) {
    const cid = requireUuid(String(q.communityId), 'community');
    communityIds = communityIds.filter((id) => id === cid);
  }
  const blocked = await blocks.blockedIds(me);
  const and = [
    { campusId, status: 'visible', communityId: { [Op.in]: communityIds } },
    { [Op.or]: [{ title: { [likeOp()]: `%${term}%` } }, { body: { [likeOp()]: `%${term}%` } }] },
  ];
  if (type) and.push({ type });
  const bf = blockFilter(blocked);
  if (bf) and.push(bf);
  const after = cursor.after(q.cursor);
  if (after) and.push(after);
  const rows = communityIds.length
    ? await M('FriendsForumPost').findAll({ where: { [Op.and]: and }, order: [['createdAt', 'DESC'], ['id', 'DESC']], limit: limit + 1 })
    : [];
  const { items, nextCursor } = cursor.page(rows, limit);
  send(res, 200, { items: await serializePosts(req, items, me), nextCursor });
};

// GET /mine?cursor= — my own posts in every state (so I can see "Under review" / removal reasons).
const myPosts = async (req, res) => {
  const me = req.user.id;
  const limit = cursor.pageSize(req.query.limit, 20);
  const and = [{ authorId: me, status: { [Op.ne]: 'deleted' } }];
  const after = cursor.after(req.query.cursor);
  if (after) and.push(after);
  const rows = await M('FriendsForumPost').findAll({ where: { [Op.and]: and }, order: [['createdAt', 'DESC'], ['id', 'DESC']], limit: limit + 1 });
  const { items, nextCursor } = cursor.page(rows, limit);
  send(res, 200, { items: await serializePosts(req, items, me), nextCursor });
};

/** Post the viewer may see (404 otherwise: another campus, deleted, hidden from them, blocked author). */
const loadPostFor = async (req, id, { allowHidden = false } = {}) => {
  requireUuid(id, 'post');
  const me = req.user.id;
  const post = await M('FriendsForumPost').findByPk(id);
  if (!post || String(post.campusId) !== String(campusOf(req))) throw fail(404, 'POST_NOT_FOUND', 'Post not found.');
  const community = await M('FriendsCommunity').findByPk(post.communityId);
  if (!community || community.status !== 'active') throw fail(404, 'POST_NOT_FOUND', 'Post not found.');
  const role = await roleIn(post.communityId, me);
  if (!canSee(post, me, allowHidden && !!role)) throw fail(404, 'POST_NOT_FOUND', 'Post not found.');
  if (!post.isAnonymous && String(post.authorId) !== String(me) && (await blocks.blockedIds(me)).has(String(post.authorId))) {
    throw fail(404, 'POST_NOT_FOUND', 'Post not found.');
  }
  return { post, community, role };
};

// GET /posts/:id
const getPost = async (req, res) => {
  const me = req.user.id;
  const { post, role } = await loadPostFor(req, req.params.id, { allowHidden: true });
  const roles = role ? new Map([[String(post.communityId), role]]) : null;
  const [dto] = await serializePosts(req, [post], me, { full: true, roles });
  send(res, 200, { post: dto });
};

const parseReviewInput = (r, { partial = false } = {}) => {
  const out = {};
  if (!r || typeof r !== 'object') throw fail(400, 'REVIEW_REQUIRED', 'Add the review details (target and rating).');
  if (!partial || r.rating !== undefined) {
    const rating = Number(r.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw fail(400, 'INVALID_RATING', 'Rating must be a whole number from 1 to 5.');
    out.rating = rating;
  }
  if (!partial || r.pros !== undefined) out.pros = optText(r.pros, 500, 'Pros');
  if (!partial || r.cons !== undefined) out.cons = optText(r.cons, 500, 'Cons');
  if (!partial || r.periodLabel !== undefined) out.periodLabel = optText(r.periodLabel, 40, 'Period');
  if (!partial || r.context !== undefined) {
    const ctx = r.context === undefined || r.context === null ? {} : r.context;
    if (typeof ctx !== 'object' || Array.isArray(ctx)) throw fail(400, 'INVALID_CONTEXT', 'Context must be an object.');
    const allowed = ['course', 'section', 'semester', 'year', 'role', 'company', 'roomType', 'attendance', 'grade'];
    const clean = {};
    for (const [k, v] of Object.entries(ctx)) {
      if (!allowed.includes(k)) throw fail(400, 'INVALID_CONTEXT', `Unknown context field ${k}.`);
      clean[k] = optText(typeof v === 'number' ? String(v) : v, 60, `context.${k}`);
    }
    out.context = clean;
  }
  return out;
};

/** periodLabel + context values are shown campus-wide too, so they go through the same safety check. */
const reviewExtraText = (r) => (r ? [r.periodLabel, ...Object.values(r.context || {})].filter(Boolean) : []);

// POST /communities/:id/posts { type, title, body, mediaIds, links, anonymous, official, freshersGuide, review?, clientId }
const createPost = async (req, res) => {
  const me = req.user.id;
  const { ctx, cfg } = req.friends;
  const b = req.body || {};
  const community = await loadCommunity(req.params.id, campusOf(req));
  const clientId = b.clientId === undefined || b.clientId === null || b.clientId === '' ? null : requireUuid(String(b.clientId), 'clientId');
  const FriendsForumPost = M('FriendsForumPost');
  if (clientId) {
    const existing = await FriendsForumPost.findOne({ where: { authorId: me, clientId } });
    if (existing) {
      const [dto] = await serializePosts(req, [existing], me, { full: true });
      return send(res, 200, { post: dto, duplicate: true });
    }
  }

  const type = String(b.type || 'discussion');
  if (!F.POST_TYPES.includes(type)) throw fail(400, 'INVALID_TYPE', `Type must be one of ${F.POST_TYPES.join(', ')}.`);
  if (!(community.allowedTypes || []).includes(type)) throw fail(400, 'TYPE_NOT_ALLOWED', 'This community does not take that kind of post.', { allowedTypes: community.allowedTypes });
  const title = requiredText(b.title, 5, 150, 'Title');
  const body = optText(b.body, 5000, 'Body');
  const isReview = type === 'review';
  const official = b.official === true;
  const freshersGuide = b.freshersGuide === true;
  // Reviews always hide the reviewer; otherwise the caller's choice (default from their settings).
  const anonymous = isReview ? true : (b.anonymous === undefined
    ? !!(ctx.settings && ctx.settings.defaultAnonymous) && !official && !freshersGuide && !!community.allowAnonymous
    : b.anonymous === true);
  if (anonymous && !community.allowAnonymous) throw fail(400, 'ANONYMOUS_NOT_ALLOWED', 'This community does not allow anonymous posts.');
  if (official && anonymous) throw fail(400, 'OFFICIAL_NOT_ANONYMOUS', 'Official posts cannot be anonymous.');
  if (official && !(await isOfficialAuthor(ctx))) throw fail(403, 'NOT_OFFICIAL', 'Only official accounts can mark a post as Official.');
  if (freshersGuide) {
    if (type !== 'guidance') throw fail(400, 'GUIDE_TYPE', 'A Freshers Guide must be a guidance post.');
    if (anonymous) throw fail(400, 'GUIDE_NOT_ANONYMOUS', 'A Freshers Guide cannot be anonymous.');
    const role = await roleIn(community.id, me);
    if (!role && ctx.user.role !== 'admin') throw fail(403, 'NOT_MODERATOR', 'Only community moderators can write the Freshers Guide.');
    const existingGuide = await FriendsForumPost.findOne({ where: { communityId: community.id, isFreshersGuide: true, status: { [Op.in]: ['visible', 'pending_review'] } }, attributes: ['id'] });
    if (existingGuide) throw fail(409, 'GUIDE_EXISTS', 'This community already has a Freshers Guide. Edit it instead.', { postId: existingGuide.id });
  }
  const media = await resolveMedia(b.mediaIds, me);
  const { links, flagged: linkFlag } = parseLinks(b.links, cfg);

  let reviewInput = null;
  let reviewTarget = null;
  let decision;
  if (isReview) {
    reviewInput = parseReviewInput(b.review);
    const targetId = requireUuid(String((b.review || {}).targetId || ''), 'review target');
    reviewTarget = await M('FriendsReviewTarget').findByPk(targetId);
    if (!reviewTarget || String(reviewTarget.campusId) !== String(campusOf(req)) || reviewTarget.status !== 'active') {
      throw fail(404, 'REVIEW_TARGET_NOT_FOUND', 'We could not find that course, professor or place.');
    }
    const mineActive = await M('FriendsReview').findOne({ where: { targetId, authorId: me, active: true }, attributes: ['id'] });
    if (mineActive) throw fail(409, 'REVIEW_EXISTS', 'You already reviewed this. Edit your review instead.', { reviewId: mineActive.id });
    decision = reviewSafety.enforce([title, body, reviewInput.pros, reviewInput.cons, ...reviewExtraText(reviewInput)].filter(Boolean).join('\n'), { targetKind: reviewTarget.kind, cfg });
    limiter.enforce(me, 'forum_review');
  } else {
    decision = contentPolicy.enforce([title, body].filter(Boolean).join('\n'), { kind: 'forum_post', cfg });
  }
  limiter.enforce(me, 'forum_post');

  const flaggedReasons = [...(decision.decision === 'flag' ? decision.reasons : []), ...(linkFlag ? ['LINK_SHORTENER'] : [])];
  const finalStatus = flaggedReasons.length ? 'pending_review' : 'visible';
  const id = crypto.randomUUID();
  const aliasName = anonymous ? await alias.getAlias(`forum:${id}`, me) : null;
  const now = new Date();
  let post;
  try {
    post = await FriendsForumPost.create({
      id,
      communityId: community.id,
      campusId: community.campusId,
      authorId: me,
      clientId,
      isAnonymous: anonymous,
      aliasName,
      type,
      title,
      body,
      media,
      links,
      isOfficial: official,
      isFreshersGuide: freshersGuide,
      isPinned: freshersGuide,
      // A review post stays invisible ('deleted') until its review row has won the one-active-review index.
      status: isReview ? 'deleted' : finalStatus,
      hotRank: rank.hotRank(0, now, 0),
      lastActivityAt: now,
    });
  } catch (err) {
    if (!isUniqueError(err) || !clientId) throw err;
    const existing = await FriendsForumPost.findOne({ where: { authorId: me, clientId } });
    const [dto] = await serializePosts(req, [existing], me, { full: true });
    return send(res, 200, { post: dto, duplicate: true });
  }

  let review = null;
  if (isReview) {
    try {
      review = await M('FriendsReview').create({
        targetId: reviewTarget.id,
        forumPostId: post.id,
        authorId: me,
        ...reviewInput,
        status: finalStatus === 'visible' ? 'published' : 'pending_review',
        flags: flaggedReasons,
        active: true,
      });
    } catch (err) {
      await FriendsForumPost.destroy({ where: { id: post.id } });
      if (!isUniqueError(err)) throw err;
      const mine = await M('FriendsReview').findOne({ where: { targetId: reviewTarget.id, authorId: me, active: true }, attributes: ['id'] });
      throw fail(409, 'REVIEW_EXISTS', 'You already reviewed this. Edit your review instead.', { reviewId: mine ? mine.id : null });
    }
    post.status = finalStatus;
    await post.save({ fields: ['status'] });
    await recomputeTarget(reviewTarget.id);
  }
  await recountCommunity(community.id);

  if (flaggedReasons.length) {
    await reportsSvc.fileSystemReport({
      targetType: isReview ? 'review' : 'forum_post',
      targetId: isReview ? review.id : post.id,
      category: flagCategory(flaggedReasons),
      note: `Automatic check: ${flaggedReasons.join(', ')}`,
    });
    if (isReview) notifyAdmin('friends_review', 'created', review.id, { scope: 'forum' });
  }
  const [dto] = await serializePosts(req, [post], me, { full: true });
  send(res, 201, { post: dto, duplicate: false, underReview: finalStatus === 'pending_review' });
};

const auditSelf = (row, action, targetType, meta) => audit.recordSafe({
  // Anonymous content: no actor / subject id, so the audit list cannot de-anonymise it.
  actorId: row.isAnonymous ? null : row.authorId,
  actorRole: 'self',
  action,
  targetType,
  targetId: row.id,
  subjectUserId: row.isAnonymous ? null : row.authorId,
  communityId: row.communityId || null,
  meta: { ...meta, anonymous: !!row.isAnonymous },
});

// PATCH /posts/:id { title, body, links, mediaIds }
const updatePost = async (req, res) => {
  const me = req.user.id;
  const { cfg } = req.friends;
  const { post } = await loadPostFor(req, req.params.id);
  if (String(post.authorId) !== String(me)) throw fail(403, 'NOT_AUTHOR', 'You can only edit your own posts.');
  if (['removed', 'hidden'].includes(post.status)) throw fail(409, 'REMOVED', 'This post was removed by a moderator. You can appeal the decision.');
  const b = req.body || {};
  const patch = {};
  if (b.title !== undefined) patch.title = requiredText(b.title, 5, 150, 'Title');
  if (b.body !== undefined) patch.body = optText(b.body, 5000, 'Body');
  let linkFlag = false;
  if (b.links !== undefined) {
    const parsed = parseLinks(b.links, cfg);
    patch.links = parsed.links;
    linkFlag = parsed.flagged;
  }
  if (b.mediaIds !== undefined) patch.media = await resolveMedia(b.mediaIds, me);
  if (!Object.keys(patch).length) throw fail(400, 'NOTHING_TO_UPDATE', 'Nothing to update.');
  const text = [patch.title ?? post.title, patch.body ?? post.body].filter(Boolean).join('\n');
  let decision;
  let review = null;
  if (post.type === 'review') {
    review = await M('FriendsReview').findOne({ where: { forumPostId: post.id } });
    const target = review ? await M('FriendsReviewTarget').findByPk(review.targetId) : null;
    decision = reviewSafety.enforce([text, review && review.pros, review && review.cons, ...reviewExtraText(review)].filter(Boolean).join('\n'), { targetKind: target && target.kind, cfg });
  } else {
    decision = contentPolicy.enforce(text, { kind: 'forum_post', cfg });
  }
  limiter.enforce(me, 'forum_edit');
  const reasons = [...(decision.decision === 'flag' ? decision.reasons : []), ...(linkFlag ? ['LINK_SHORTENER'] : [])];
  const previous = { title: post.title, body: post.body };
  Object.assign(post, patch, { editedAt: new Date() });
  if (reasons.length && post.status === 'visible') post.status = 'pending_review';
  await post.save();
  if (review && post.status === 'pending_review' && review.status === 'published') {
    review.status = 'pending_review';
    review.flags = reasons;
    await review.save();
    await recomputeTarget(review.targetId);
  }
  await auditSelf(post, 'edit_self', 'forum_post', { previous });
  if (reasons.length) {
    await reportsSvc.fileSystemReport({ targetType: review ? 'review' : 'forum_post', targetId: review ? review.id : post.id, category: flagCategory(reasons), note: `Automatic check after edit: ${reasons.join(', ')}` });
    await recountCommunity(post.communityId);
  }
  const [dto] = await serializePosts(req, [post], me, { full: true });
  send(res, 200, { post: dto, underReview: post.status === 'pending_review' });
};

const deletePostRow = async (post) => {
  post.status = 'deleted';
  post.isPinned = false;
  await post.save({ fields: ['status', 'isPinned'] });
  if (post.type === 'review') {
    const review = await M('FriendsReview').findOne({ where: { forumPostId: post.id } });
    if (review) {
      review.active = false;
      await review.save({ fields: ['active'] });
      await recomputeTarget(review.targetId);
    }
  }
  await recountCommunity(post.communityId);
};

// DELETE /posts/:id
const deletePost = async (req, res) => {
  const me = req.user.id;
  const { post } = await loadPostFor(req, req.params.id);
  if (String(post.authorId) !== String(me)) throw fail(403, 'NOT_AUTHOR', 'You can only delete your own posts.');
  await deletePostRow(post);
  await auditSelf(post, 'delete_self', 'forum_post', { title: post.title });
  send(res, 200, { deleted: true });
};

// POST/DELETE /posts/:id/bookmark  ·  GET /bookmarks
const bookmark = async (req, res) => {
  const me = req.user.id;
  const { post } = await loadPostFor(req, req.params.id);
  limiter.enforce(me, 'forum_bookmark');
  let duplicate = false;
  try {
    await M('FriendsReaction').create({ userId: me, targetType: 'forum_post', targetId: post.id, kind: 'bookmark' });
  } catch (err) {
    if (!isUniqueError(err)) throw err;
    duplicate = true;
  }
  send(res, duplicate ? 200 : 201, { bookmarked: true, duplicate });
};

const unbookmark = async (req, res) => {
  const me = req.user.id;
  const id = requireUuid(req.params.id, 'post');
  const removed = await M('FriendsReaction').destroy({ where: { userId: me, targetType: 'forum_post', targetId: id, kind: 'bookmark' } });
  send(res, 200, { bookmarked: false, removed: removed > 0 });
};

const listBookmarks = async (req, res) => {
  const me = req.user.id;
  const limit = cursor.pageSize(req.query.limit, 20);
  const and = [{ userId: me, targetType: 'forum_post', kind: 'bookmark' }];
  const after = cursor.after(req.query.cursor);
  if (after) and.push(after);
  const marks = await M('FriendsReaction').findAll({ where: { [Op.and]: and }, order: [['createdAt', 'DESC'], ['id', 'DESC']], limit: limit + 1 });
  const { items, nextCursor } = cursor.page(marks, limit);
  const blocked = await blocks.blockedIds(me);
  const posts = await M('FriendsForumPost').findAll({ where: { id: { [Op.in]: items.map((m) => m.targetId) }, campusId: campusOf(req), status: 'visible' } });
  const byId = new Map(posts.filter((p) => p.isAnonymous || !blocked.has(String(p.authorId))).map((p) => [String(p.id), p]));
  const ordered = items.map((m) => byId.get(String(m.targetId))).filter(Boolean);
  send(res, 200, { items: await serializePosts(req, ordered, me), nextCursor });
};

// ═════════════════════════════════════════════════════════════════════════════
// Comments
// ═════════════════════════════════════════════════════════════════════════════

// GET /posts/:id/comments?sort=best|new|old&cursor= — pages top-level comments; each page carries
// every reply under those comments (flat, with parentId + depth; the client builds the tree).
const listComments = async (req, res) => {
  const me = req.user.id;
  const { post, role } = await loadPostFor(req, req.params.id, { allowHidden: true });
  const sort = String(req.query.sort || 'best');
  if (!['best', 'new', 'old'].includes(sort)) throw fail(400, 'INVALID_SORT', 'Sort must be best, new or old.');
  const limit = cursor.pageSize(req.query.limit, 20);
  const Comment = M('FriendsForumComment');
  const and = [{ postId: post.id, parentId: null }];
  // The best answer is pinned to the top of the first page and left out of every page's list.
  if (post.bestCommentId) and.push({ id: { [Op.ne]: post.bestCommentId } });
  let order;
  let field = 'createdAt';
  if (sort === 'best') {
    field = 'score';
    order = [['score', 'DESC'], ['id', 'DESC']];
    const after = cursor.after(req.query.cursor, 'score', 'number');
    if (after) and.push(after);
  } else if (sort === 'new') {
    order = [['createdAt', 'DESC'], ['id', 'DESC']];
    const after = cursor.after(req.query.cursor);
    if (after) and.push(after);
  } else {
    order = [['createdAt', 'ASC'], ['id', 'ASC']];
    const c = cursor.decode(req.query.cursor);
    if (c) and.push({ [Op.or]: [{ createdAt: { [Op.gt]: c.value } }, { createdAt: c.value, id: { [Op.gt]: c.id } }] });
  }
  const rows = await Comment.findAll({ where: { [Op.and]: and }, order, limit: limit + 1 });
  const { items, nextCursor } = cursor.page(rows, limit, field);
  // Best answer first on the first page.
  if (!req.query.cursor && post.bestCommentId) {
    const best = await Comment.findByPk(post.bestCommentId);
    if (best && best.parentId === null) items.unshift(best);
  }
  // Descendants of this page (breadth-first, bounded).
  const replies = [];
  let frontier = items.map((c) => c.id);
  for (let d = 1; d <= F.MAX_DEPTH && frontier.length && replies.length < 500; d++) {
    const level = await Comment.findAll({ where: { postId: post.id, parentId: { [Op.in]: frontier } }, order: [['createdAt', 'ASC'], ['id', 'ASC']], limit: 500 - replies.length });
    replies.push(...level);
    frontier = level.map((c) => c.id);
  }
  // Blocked named authors become tombstones (the thread keeps its shape; anonymous rows are never
  // filtered by author, see the header).
  const blocked = await blocks.blockedIds(me);
  const isMod = !!role;
  send(res, 200, {
    sort,
    bestCommentId: post.bestCommentId || null,
    items: await serializeComments(req, items, me, { isMod, blocked }),
    replies: await serializeComments(req, replies, me, { isMod, blocked }),
    nextCursor,
  });
};

const loadCommentFor = async (req, id) => {
  requireUuid(id, 'comment');
  const c = await M('FriendsForumComment').findByPk(id);
  if (!c) throw fail(404, 'COMMENT_NOT_FOUND', 'Comment not found.');
  let loaded;
  try {
    loaded = await loadPostFor(req, c.postId, { allowHidden: true });
  } catch {
    throw fail(404, 'COMMENT_NOT_FOUND', 'Comment not found.');
  }
  return { comment: c, ...loaded };
};

// POST /posts/:id/comments { body, parentId, anonymous, official, clientId }
const createComment = async (req, res) => {
  const me = req.user.id;
  const { ctx, cfg } = req.friends;
  const b = req.body || {};
  const { post, community } = await loadPostFor(req, req.params.id);
  if (post.status !== 'visible') throw fail(409, 'POST_NOT_OPEN', 'You cannot comment on this post right now.');
  if (post.isLocked) throw fail(423, 'LOCKED', 'This post is locked by a moderator.');
  const Comment = M('FriendsForumComment');
  const clientId = b.clientId === undefined || b.clientId === null || b.clientId === '' ? null : requireUuid(String(b.clientId), 'clientId');
  if (clientId) {
    const existing = await Comment.findOne({ where: { authorId: me, clientId } });
    if (existing) {
      const [dto] = await serializeComments(req, [existing], me);
      return send(res, 200, { comment: dto, duplicate: true });
    }
  }
  const body = requiredText(b.body, 1, 3000, 'Comment');
  let parent = null;
  if (b.parentId !== undefined && b.parentId !== null && b.parentId !== '') {
    parent = await Comment.findByPk(requireUuid(String(b.parentId), 'parent'));
    if (!parent || String(parent.postId) !== String(post.id)) throw fail(404, 'COMMENT_NOT_FOUND', 'The comment you are replying to is gone.');
    if (parent.status !== 'visible') throw fail(409, 'PARENT_NOT_OPEN', 'You cannot reply to that comment.');
    // Blocks work both ways: no replying under (and pinging) someone who blocked you or whom you blocked.
    if (String(parent.authorId) !== String(me) && await blocks.isBlocked(me, parent.authorId)) {
      throw fail(404, 'COMMENT_NOT_FOUND', 'The comment you are replying to is gone.');
    }
    if (parent.depth + 1 > F.MAX_DEPTH) throw fail(400, 'MAX_DEPTH', 'This thread is too deep. Reply higher up.', { max: F.MAX_DEPTH });
  }
  const anonymous = b.anonymous === undefined
    ? !!(ctx.settings && ctx.settings.defaultAnonymous) && b.official !== true && !!community.allowAnonymous
    : b.anonymous === true;
  if (anonymous && !community.allowAnonymous) throw fail(400, 'ANONYMOUS_NOT_ALLOWED', 'This community does not allow anonymous comments.');
  const official = b.official === true;
  if (official && anonymous) throw fail(400, 'OFFICIAL_NOT_ANONYMOUS', 'Official replies cannot be anonymous.');
  if (official && !(await isOfficialAuthor(ctx))) throw fail(403, 'NOT_OFFICIAL', 'Only official accounts can post official replies.');
  const decision = contentPolicy.enforce(body, { kind: 'comment', cfg });
  limiter.enforce(me, 'forum_comment');
  const aliasName = anonymous ? await alias.getAlias(`forum:${post.id}`, me) : null;
  let comment;
  try {
    comment = await Comment.create({
      postId: post.id,
      parentId: parent ? parent.id : null,
      depth: parent ? parent.depth + 1 : 0,
      authorId: me,
      clientId,
      isAnonymous: anonymous,
      aliasName,
      body,
      isOfficialReply: official,
      status: decision.decision === 'flag' ? 'pending_review' : 'visible',
    });
  } catch (err) {
    if (!isUniqueError(err) || !clientId) throw err;
    const existing = await Comment.findOne({ where: { authorId: me, clientId } });
    const [dto] = await serializeComments(req, [existing], me);
    return send(res, 200, { comment: dto, duplicate: true });
  }
  await M('FriendsForumPost').update({ lastActivityAt: new Date() }, { where: { id: post.id }, silent: true });
  await recountComments(post.id);
  if (comment.status === 'pending_review') {
    await reportsSvc.fileSystemReport({ targetType: 'forum_comment', targetId: comment.id, category: flagCategory(decision.reasons), note: `Automatic check: ${decision.reasons.join(', ')}` });
  } else {
    // Notify the post author and the parent comment author (never yourself). No identity in the payload.
    const recipients = new Set();
    if (String(post.authorId) !== String(me)) recipients.add(String(post.authorId));
    if (parent && String(parent.authorId) !== String(me)) recipients.add(String(parent.authorId));
    if (recipients.size) {
      const blocked = await blocks.blockedIds(me);
      for (const r of [...recipients]) if (blocked.has(r)) recipients.delete(r);
    }
    if (recipients.size) {
      await notify('FORUM_ANSWER', [...recipients], { id: post.id, body: `New comment on "${post.title.slice(0, 80)}"`, dedupeKey: `comment:${comment.id}`, data: { commentId: comment.id } });
    }
  }
  const [dto] = await serializeComments(req, [comment], me);
  send(res, 201, { comment: dto, duplicate: false, underReview: comment.status === 'pending_review' });
};

// PATCH /comments/:id { body }
const updateComment = async (req, res) => {
  const me = req.user.id;
  const { cfg } = req.friends;
  const { comment } = await loadCommentFor(req, req.params.id);
  if (String(comment.authorId) !== String(me)) throw fail(403, 'NOT_AUTHOR', 'You can only edit your own comments.');
  if (comment.status === 'deleted') throw fail(404, 'COMMENT_NOT_FOUND', 'Comment not found.');
  if (['removed', 'hidden'].includes(comment.status)) throw fail(409, 'REMOVED', 'This comment was removed by a moderator. You can appeal the decision.');
  const body = requiredText((req.body || {}).body, 1, 3000, 'Comment');
  const decision = contentPolicy.enforce(body, { kind: 'comment', cfg });
  limiter.enforce(me, 'forum_edit');
  const previous = comment.body;
  comment.body = body;
  comment.editedAt = new Date();
  if (decision.decision === 'flag' && comment.status === 'visible') comment.status = 'pending_review';
  await comment.save();
  await auditSelf(comment, 'edit_self', 'forum_comment', { previous });
  if (decision.decision === 'flag') {
    await reportsSvc.fileSystemReport({ targetType: 'forum_comment', targetId: comment.id, category: flagCategory(decision.reasons), note: `Automatic check after edit: ${decision.reasons.join(', ')}` });
    await recountComments(comment.postId);
  }
  const [dto] = await serializeComments(req, [comment], me);
  send(res, 200, { comment: dto, underReview: comment.status === 'pending_review' });
};

// DELETE /comments/:id
const deleteComment = async (req, res) => {
  const me = req.user.id;
  const { comment, post } = await loadCommentFor(req, req.params.id);
  if (String(comment.authorId) !== String(me)) throw fail(403, 'NOT_AUTHOR', 'You can only delete your own comments.');
  if (comment.status === 'deleted') throw fail(404, 'COMMENT_NOT_FOUND', 'Comment not found.');
  comment.status = 'deleted';
  await comment.save({ fields: ['status'] });
  if (String(post.bestCommentId) === String(comment.id)) await clearBest(post);
  await recountComments(post.id);
  await auditSelf({ ...comment.get({ plain: true }), communityId: post.communityId }, 'delete_self', 'forum_comment', {});
  send(res, 200, { deleted: true });
};

// ═════════════════════════════════════════════════════════════════════════════
// Votes & karma
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Brings one vote row's karma in line with its value: an upvote earns the author 1 karma (at most
 * KARMA_PER_PAIR_PER_DAY per voter-author pair in 24 h); any other value gives it back. Both updates
 * are conditional on the row's current value, so racing vote changes can never leave a down/removed
 * vote holding karma or credit an upvote twice.
 */
// Count-then-award for one voter -> author pair runs one at a time (one process on Render): parallel
// upvotes on different posts of the same author all saw "< cap" and all awarded.
const karmaLocks = new Map(); // `${voterId}:${authorId}` -> tail promise
const withPairLock = (key, fn) => {
  const prev = karmaLocks.get(key) || Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => {});
  karmaLocks.set(key, tail);
  tail.then(() => { if (karmaLocks.get(key) === tail) karmaLocks.delete(key); });
  return run;
};

// Across processes (Postgres, A2) the count-then-award also runs under
// pg_advisory_xact_lock('karma:<voter>:<author>') in its own transaction (utils/pgLock; fail open
// to the unlocked statements = the single-process behaviour). The karma bump itself runs after
// that transaction committed, exactly as before (it is an atomic increment).
const reconcileKarma = async (voteId, authorId, campusId) => {
  if (!voteId || !authorId) return;
  const Vote = M('FriendsVote');
  const peek = await Vote.findByPk(voteId, { attributes: ['id', 'userId'] });
  if (!peek) return;
  const pair = `${peek.userId}:${authorId}`;
  return withPairLock(pair, async () => {
    const delta = await pgLock.withAdvisoryXactLock(getSequelize(), `karma:${pair}`, (t) => reconcileKarmaVote(voteId, authorId, t));
    if (delta) await bumpKarma(authorId, campusId, 'karma', delta);
  });
};

// The vote row's award flag in line with its value; resolves the karma change to apply (1, -1 or 0).
const reconcileKarmaVote = async (voteId, authorId, t) => {
  const Vote = M('FriendsVote');
  const tx = t ? { transaction: t } : {};
  const row = await Vote.findByPk(voteId, tx);
  if (!row) return 0;
  if (row.value === 1 && !row.karmaAwarded) {
    const since = new Date(Date.now() - DAY);
    const awarded = await Vote.count({ where: { userId: row.userId, targetAuthorId: authorId, karmaAwarded: true, updatedAt: { [Op.gte]: since } }, ...tx });
    if (awarded >= KARMA_PER_PAIR_PER_DAY) return 0;
    const [n] = await Vote.update({ karmaAwarded: true }, { where: { id: row.id, karmaAwarded: false, value: 1 }, ...tx });
    return n === 1 ? 1 : 0;
  }
  if (row.value !== 1 && row.karmaAwarded) {
    const [n] = await Vote.update({ karmaAwarded: false }, { where: { id: row.id, karmaAwarded: true, value: { [Op.ne]: 1 } }, ...tx });
    return n === 1 ? -1 : 0;
  }
  return 0;
};

/** Resource posts that reach 3 upvotes credit the author once (resourcesShared). */
const maybeCreditResource = async (post) => {
  if (post.type !== 'resource' || post.isAnonymous || post.resourceCredited || post.upCount < RESOURCE_CREDIT_UPVOTES) return;
  const [n] = await M('FriendsForumPost').update({ resourceCredited: true }, { where: { id: post.id, resourceCredited: false }, silent: true });
  if (n === 1) await bumpKarma(post.authorId, post.campusId, 'resourcesShared', 1);
};

// PUT /vote { targetType: forum_post|forum_comment, targetId, value: -1|0|1 } -> { up, down, score, myVote }
const vote = async (req, res) => {
  const me = req.user.id;
  const b = req.body || {};
  const targetType = String(b.targetType || '');
  if (!F.VOTE_TARGETS.includes(targetType)) throw fail(400, 'INVALID_TARGET', 'You can vote on forum posts and comments.');
  const value = Number(b.value);
  if (![-1, 0, 1].includes(value)) throw fail(400, 'INVALID_VOTE', 'Vote must be -1, 0 or 1.');
  let row;
  let post;
  if (targetType === 'forum_post') {
    ({ post } = await loadPostFor(req, String(b.targetId || '')));
    row = post;
  } else {
    const loaded = await loadCommentFor(req, String(b.targetId || ''));
    row = loaded.comment;
    post = loaded.post;
    if (post.status !== 'visible' || row.status === 'deleted' || (!row.isAnonymous && (await blocks.blockedIds(me)).has(String(row.authorId)))) {
      throw fail(404, 'COMMENT_NOT_FOUND', 'Comment not found.');
    }
  }
  if (row.status !== 'visible') throw fail(409, 'NOT_VOTABLE', 'You cannot vote on this right now.');
  if (String(row.authorId) === String(me)) throw fail(403, 'SELF_VOTE', 'You cannot vote on your own content.');
  limiter.enforce(me, 'forum_vote');

  const Vote = M('FriendsVote');
  const targetAuthorId = row.isAnonymous ? null : row.authorId;
  let existing = await Vote.findOne({ where: { userId: me, targetType, targetId: row.id } });
  if (value === 0) {
    if (existing) {
      // Take any karma back first, then drop the row.
      const [n] = await Vote.update({ karmaAwarded: false }, { where: { id: existing.id, karmaAwarded: true } });
      if (n === 1 && targetAuthorId) await bumpKarma(targetAuthorId, post.campusId, 'karma', -1);
      await Vote.destroy({ where: { id: existing.id } });
    }
  } else {
    if (existing) {
      if (existing.value !== value) await Vote.update({ value }, { where: { id: existing.id } });
    } else {
      try {
        existing = await Vote.create({ userId: me, targetType, targetId: row.id, value, targetAuthorId });
      } catch (err) {
        if (!isUniqueError(err)) throw err;
        existing = await Vote.findOne({ where: { userId: me, targetType, targetId: row.id } });
        if (existing && existing.value !== value) await Vote.update({ value }, { where: { id: existing.id } });
      }
    }
    if (existing && targetAuthorId) await reconcileKarma(existing.id, targetAuthorId, post.campusId);
  }
  await recountVotes(targetType, row.id);
  const fresh = targetType === 'forum_post'
    ? await M('FriendsForumPost').findByPk(row.id)
    : await M('FriendsForumComment').findByPk(row.id);
  if (targetType === 'forum_post') {
    await refreshHot(row.id);
    await maybeCreditResource(fresh);
  }
  send(res, 200, { targetType, targetId: row.id, up: fresh.upCount, down: fresh.downCount, score: fresh.score, myVote: value });
};

// ═════════════════════════════════════════════════════════════════════════════
// Best answer
// ═════════════════════════════════════════════════════════════════════════════

const clearBest = async (post) => {
  const prevId = post.bestCommentId;
  if (!prevId) return;
  const prev = await M('FriendsForumComment').findByPk(prevId);
  const [n] = await M('FriendsForumPost').update({ bestCommentId: null, bestCredited: false }, { where: { id: post.id, bestCommentId: prevId }, silent: true });
  if (n === 1 && post.bestCredited && prev) await bumpKarma(prev.authorId, post.campusId, 'helpfulAnswers', -1);
  post.bestCommentId = null;
  post.bestCredited = false;
};

// POST /posts/:id/best-answer { commentId }  ·  DELETE /posts/:id/best-answer
const setBestAnswer = async (req, res) => {
  const me = req.user.id;
  const { post, role } = await loadPostFor(req, req.params.id);
  if (post.type !== 'question') throw fail(400, 'NOT_A_QUESTION', 'Only question posts have a best answer.');
  const isAuthor = String(post.authorId) === String(me);
  if (!isAuthor && !role) throw fail(403, 'NOT_ALLOWED', 'Only the person who asked or a community moderator can pick the best answer.');
  const commentId = requireUuid(String((req.body || {}).commentId || ''), 'comment');
  const comment = await M('FriendsForumComment').findByPk(commentId);
  if (!comment || String(comment.postId) !== String(post.id) || comment.status !== 'visible') throw fail(404, 'COMMENT_NOT_FOUND', 'Comment not found.');
  if (String(post.bestCommentId) === String(comment.id)) return send(res, 200, { bestCommentId: comment.id, duplicate: true });
  await clearBest(post);
  // Credit only a named answer by someone other than the asker (no self-farming, no anonymous karma).
  const credit = !comment.isAnonymous && String(comment.authorId) !== String(post.authorId);
  const [n] = await M('FriendsForumPost').update({ bestCommentId: comment.id, bestCredited: credit }, { where: { id: post.id, bestCommentId: null }, silent: true });
  if (n === 0) throw fail(409, 'STATE_CHANGED', 'Someone else just changed the best answer. Refresh and try again.');
  if (credit) await bumpKarma(comment.authorId, post.campusId, 'helpfulAnswers', 1);
  if (!isAuthor) {
    await audit.recordSafe({ actorId: me, actorRole: 'community_mod', action: 'best_answer', targetType: 'forum_post', targetId: post.id, communityId: post.communityId, meta: { commentId: comment.id } });
  }
  if (String(comment.authorId) !== String(me)) {
    await notify('FORUM_BEST_ANSWER', [comment.authorId], { id: post.id, body: `Your answer on "${post.title.slice(0, 80)}" was picked as the best answer.`, dedupeKey: `best:${comment.id}`, data: { commentId: comment.id } });
  }
  send(res, 200, { bestCommentId: comment.id, duplicate: false });
};

const clearBestAnswer = async (req, res) => {
  const me = req.user.id;
  const { post, role } = await loadPostFor(req, req.params.id);
  if (post.type !== 'question') throw fail(400, 'NOT_A_QUESTION', 'Only question posts have a best answer.');
  if (String(post.authorId) !== String(me) && !role) throw fail(403, 'NOT_ALLOWED', 'Only the person who asked or a community moderator can change the best answer.');
  await clearBest(post);
  send(res, 200, { bestCommentId: null });
};

// ═════════════════════════════════════════════════════════════════════════════
// Review targets & reviews
// ═════════════════════════════════════════════════════════════════════════════

const nameKeyOf = (name) => String(name || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 120);

const targetOut = (t, { distribution } = {}) => ({
  id: t.id,
  kind: t.kind,
  name: t.name,
  meta: { department: t.meta && t.meta.department, code: t.meta && t.meta.code, block: t.meta && t.meta.block },
  status: t.status,
  reviewCount: t.reviewCount,
  average: t.reviewCount ? Math.round((t.ratingSum / t.reviewCount) * 10) / 10 : null,
  ...(distribution ? { distribution } : {}),
});

// GET /review-targets?kind=&q=&cursor=
const listReviewTargets = async (req, res) => {
  const q = req.query || {};
  const and = [{ campusId: campusOf(req), status: 'active' }];
  if (q.kind) {
    if (!F.REVIEW_KINDS.includes(String(q.kind))) throw fail(400, 'INVALID_KIND', `Kind must be one of ${F.REVIEW_KINDS.join(', ')}.`);
    and.push({ kind: String(q.kind) });
  }
  if (q.q) {
    const term = escapeLike(nameKeyOf(q.q));
    if (term) and.push({ nameKey: { [likeOp()]: `%${term}%` } });
  }
  const limit = cursor.pageSize(q.limit, 20);
  const after = cursor.after(q.cursor);
  if (after) and.push(after);
  const rows = await M('FriendsReviewTarget').findAll({ where: { [Op.and]: and }, order: [['createdAt', 'DESC'], ['id', 'DESC']], limit: limit + 1 });
  const { items, nextCursor } = cursor.page(rows, limit);
  send(res, 200, { items: items.map((t) => targetOut(t)), nextCursor });
};

// POST /review-targets { kind, name, meta{department,code,block} } — students request (pending).
const requestReviewTarget = async (req, res) => {
  const me = req.user.id;
  const b = req.body || {};
  const kind = String(b.kind || '');
  if (!F.REVIEW_KINDS.includes(kind)) throw fail(400, 'INVALID_KIND', `Kind must be one of ${F.REVIEW_KINDS.join(', ')}.`);
  const name = requiredText(b.name, 2, 120, 'Name');
  contentPolicy.enforce(name, { kind: 'forum_post' });
  const meta = parseTargetMeta(b.meta, false);
  const nameKey = nameKeyOf(name);
  if (nameKey.length < 2) throw fail(400, 'INVALID_NAME', 'Use letters or numbers in the name.');
  const campusId = campusOf(req);
  const dup = await M('FriendsReviewTarget').findOne({ where: { campusId, kind, nameKey } });
  if (dup) {
    if (dup.status === 'active') throw fail(409, 'TARGET_EXISTS', 'That already exists.', { targetId: dup.id });
    return send(res, 200, { target: targetOut(dup), status: dup.status, duplicate: true });
  }
  limiter.enforce(me, 'review_target');
  let row;
  try {
    row = await M('FriendsReviewTarget').create({ campusId, kind, name, nameKey, meta, status: 'pending', createdBy: me });
  } catch (err) {
    if (!isUniqueError(err)) throw err;
    const again = await M('FriendsReviewTarget').findOne({ where: { campusId, kind, nameKey } });
    return send(res, 200, { target: targetOut(again), status: again.status, duplicate: true });
  }
  notifyAdmin('friends_review', 'created', row.id, { scope: 'review_target' });
  send(res, 201, { target: targetOut(row), status: 'pending', duplicate: false });
};

const parseTargetMeta = (raw, admin) => {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw fail(400, 'INVALID_META', 'meta must be an object.');
  const out = {};
  for (const k of ['department', 'code', 'block']) if (raw[k] !== undefined) out[k] = optText(raw[k], 60, `meta.${k}`);
  if (admin) {
    if (raw.facultyUserId !== undefined && raw.facultyUserId !== null) out.facultyUserId = requireUuid(String(raw.facultyUserId), 'facultyUserId');
    if (raw.entityId !== undefined && raw.entityId !== null) out.entityId = requireUuid(String(raw.entityId), 'entityId');
  }
  return out;
};

// GET /review-targets/:id?cursor= — average, distribution, reviews (reviewer never shown).
const getReviewTarget = async (req, res) => {
  const me = req.user.id;
  const t = await M('FriendsReviewTarget').findByPk(requireUuid(req.params.id, 'review target'));
  if (!t || String(t.campusId) !== String(campusOf(req)) || t.status !== 'active') throw fail(404, 'REVIEW_TARGET_NOT_FOUND', 'Not found.');
  const reviewWhere = { targetId: t.id, active: true, status: 'published' };
  const dist = await M('FriendsReview').findAll({ where: reviewWhere, attributes: ['rating'] });
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  dist.forEach((r) => { distribution[r.rating] = (distribution[r.rating] || 0) + 1; });
  const limit = cursor.pageSize(req.query.limit, 20);
  const and = [reviewWhere];
  const after = cursor.after(req.query.cursor);
  if (after) and.push(after);
  const reviews = await M('FriendsReview').findAll({ where: { [Op.and]: and }, order: [['createdAt', 'DESC'], ['id', 'DESC']], limit: limit + 1 });
  const { items, nextCursor } = cursor.page(reviews, limit);
  const posts = await M('FriendsForumPost').findAll({ where: { id: { [Op.in]: items.map((r) => r.forumPostId) }, status: 'visible' } });
  const byId = new Map(posts.map((p) => [String(p.id), p]));
  const ordered = items.map((r) => byId.get(String(r.forumPostId))).filter(Boolean);
  const mine = await M('FriendsReview').findOne({ where: { targetId: t.id, authorId: me, active: true }, attributes: ['id', 'status'] });
  send(res, 200, {
    target: targetOut(t, { distribution }),
    items: await serializePosts(req, ordered, me),
    nextCursor,
    myReview: mine ? { id: mine.id, status: mine.status } : null,
  });
};

const loadMyReview = async (req, id) => {
  const rv = await M('FriendsReview').findByPk(requireUuid(id, 'review'));
  if (!rv || !rv.active) throw fail(404, 'REVIEW_NOT_FOUND', 'Review not found.');
  const { post } = await loadPostFor(req, rv.forumPostId, { allowHidden: true }).catch(() => { throw fail(404, 'REVIEW_NOT_FOUND', 'Review not found.'); });
  return { review: rv, post };
};

// PATCH /reviews/:id { rating, pros, cons, periodLabel, context, title, body }
const updateReview = async (req, res) => {
  const me = req.user.id;
  const { cfg } = req.friends;
  const { review, post } = await loadMyReview(req, req.params.id);
  if (String(review.authorId) !== String(me)) throw fail(403, 'NOT_AUTHOR', 'You can only edit your own review.');
  if (['removed', 'hidden'].includes(review.status)) throw fail(409, 'REMOVED', 'This review was removed by a moderator. You can appeal the decision.');
  const b = req.body || {};
  const patch = parseReviewInput(b, { partial: true });
  const postPatch = {};
  if (b.title !== undefined) postPatch.title = requiredText(b.title, 5, 150, 'Title');
  if (b.body !== undefined) postPatch.body = optText(b.body, 5000, 'Body');
  if (!Object.keys(patch).length && !Object.keys(postPatch).length) throw fail(400, 'NOTHING_TO_UPDATE', 'Nothing to update.');
  const target = await M('FriendsReviewTarget').findByPk(review.targetId);
  const text = [postPatch.title ?? post.title, postPatch.body ?? post.body, patch.pros !== undefined ? patch.pros : review.pros, patch.cons !== undefined ? patch.cons : review.cons,
    ...reviewExtraText({ periodLabel: patch.periodLabel !== undefined ? patch.periodLabel : review.periodLabel, context: patch.context !== undefined ? patch.context : review.context })].filter(Boolean).join('\n');
  const decision = reviewSafety.enforce(text, { targetKind: target && target.kind, cfg });
  limiter.enforce(me, 'forum_edit');
  const previous = { rating: review.rating, pros: review.pros, cons: review.cons, title: post.title, body: post.body };
  Object.assign(review, patch, { editedAt: new Date() });
  if (decision.decision === 'flag') {
    review.status = 'pending_review';
    review.flags = decision.reasons;
    post.status = 'pending_review';
  }
  await review.save();
  Object.assign(post, postPatch, { editedAt: new Date() });
  await post.save();
  await recomputeTarget(review.targetId);
  await auditSelf(post, 'edit_self', 'review', { previous, reviewId: review.id });
  if (decision.decision === 'flag') {
    await reportsSvc.fileSystemReport({ targetType: 'review', targetId: review.id, category: flagCategory(decision.reasons), note: `Automatic check after edit: ${decision.reasons.join(', ')}` });
    notifyAdmin('friends_review', 'updated', review.id, { scope: 'forum' });
    await recountCommunity(post.communityId);
  }
  const [dto] = await serializePosts(req, [post], me, { full: true });
  send(res, 200, { post: dto, underReview: review.status === 'pending_review' });
};

// DELETE /reviews/:id
const deleteReview = async (req, res) => {
  const me = req.user.id;
  const { review, post } = await loadMyReview(req, req.params.id);
  if (String(review.authorId) !== String(me)) throw fail(403, 'NOT_AUTHOR', 'You can only delete your own review.');
  await deletePostRow(post);
  await auditSelf(post, 'delete_self', 'review', { reviewId: review.id });
  send(res, 200, { deleted: true });
};

/** Who may answer a review: admin, the professor themself (target.meta.facultyUserId + faculty role),
 *  official / department entity managers, or managers of the reviewed club's entity. */
const responderRoleFor = async (ctx, target) => {
  if (!ctx || !ctx.user) return null;
  if (ctx.user.role === 'admin') return 'admin';
  const me = String(ctx.user.id);
  const roles = (ctx.profile && ctx.profile.roles) || [];
  if (target.kind === 'professor' && target.meta && String(target.meta.facultyUserId || '') === me && roles.includes('faculty')) return 'faculty';
  const managed = await managedEntities(me, target.campusId, null);
  if (managed.some((e) => OFFICIAL_ENTITY_TYPES.includes(e.type))) return 'official';
  if (target.meta && target.meta.entityId && managed.some((e) => String(e.id) === String(target.meta.entityId))) return 'official';
  return null;
};

const loadReviewForResponse = async (req, id) => {
  const rv = await M('FriendsReview').findByPk(requireUuid(id, 'review'));
  if (!rv || !rv.active || rv.status !== 'published') throw fail(404, 'REVIEW_NOT_FOUND', 'Review not found.');
  const target = await M('FriendsReviewTarget').findByPk(rv.targetId);
  const campusId = req.adminCampusId || campusOf(req);
  if (!target || (campusId && String(target.campusId) !== String(campusId))) throw fail(404, 'REVIEW_NOT_FOUND', 'Review not found.');
  return { review: rv, target };
};

const responseOut = async (req, r) => (await loadResponses(req, [r.reviewId], req.user.id)).get(String(r.reviewId)) || null;

// POST /reviews/:id/response { body } — right of reply, one per review.
const createResponse = async (req, res, { asAdmin = false } = {}) => {
  const me = req.user.id;
  const { review, target } = await loadReviewForResponse(req, req.params.id);
  const ctx = asAdmin ? { user: { id: me, role: 'admin' }, profile: null } : ctxOf(req);
  const role = await responderRoleFor(ctx, target);
  if (!role) throw fail(403, 'NOT_ALLOWED_TO_RESPOND', 'Only the faculty member reviewed, an official account or an admin can reply to a review.');
  if (String(review.authorId) === String(me)) throw fail(403, 'NOT_ALLOWED_TO_RESPOND', 'You cannot reply to your own review.');
  const body = requiredText((req.body || {}).body, 10, 1500, 'Reply');
  reviewSafety.enforce(body, { targetKind: 'response' });
  limiter.enforce(me, 'review_response');
  const existing = await M('FriendsReviewResponse').findOne({ where: { reviewId: review.id } });
  if (existing && existing.status !== 'deleted') throw fail(409, 'RESPONSE_EXISTS', 'This review already has a reply. Edit it instead.', { responseId: existing.id });
  let row;
  try {
    if (existing) {
      Object.assign(existing, { responderId: me, responderRole: role, body, status: 'visible', editedAt: null });
      row = await existing.save();
    } else {
      row = await M('FriendsReviewResponse').create({ reviewId: review.id, responderId: me, responderRole: role, body, status: 'visible' });
    }
  } catch (err) {
    if (isUniqueError(err)) throw fail(409, 'RESPONSE_EXISTS', 'This review already has a reply.');
    throw err;
  }
  await audit.recordSafe({ actorId: me, actorRole: role === 'admin' ? 'admin' : 'self', action: 'entity_create', targetType: 'review_response', targetId: row.id, subjectUserId: me, meta: { reviewId: review.id, responderRole: role, kind: 'right_of_reply' } });
  send(res, 201, { response: await responseOut(req, row) });
};

const loadMyResponse = async (req) => {
  const { review } = await loadReviewForResponse(req, req.params.id);
  const row = await M('FriendsReviewResponse').findOne({ where: { reviewId: review.id } });
  if (!row || row.status === 'deleted') throw fail(404, 'RESPONSE_NOT_FOUND', 'Reply not found.');
  if (String(row.responderId) !== String(req.user.id)) throw fail(403, 'NOT_AUTHOR', 'You can only change your own reply.');
  if (['hidden', 'removed'].includes(row.status)) throw fail(409, 'REMOVED', 'This reply was removed by a moderator.');
  return row;
};

const updateResponse = async (req, res) => {
  const row = await loadMyResponse(req);
  const body = requiredText((req.body || {}).body, 10, 1500, 'Reply');
  reviewSafety.enforce(body, { targetKind: 'response' });
  limiter.enforce(req.user.id, 'forum_edit');
  const previous = row.body;
  row.body = body;
  row.editedAt = new Date();
  await row.save();
  await audit.recordSafe({ actorId: req.user.id, actorRole: 'self', action: 'edit_self', targetType: 'review_response', targetId: row.id, subjectUserId: req.user.id, meta: { previous } });
  send(res, 200, { response: await responseOut(req, row) });
};

const deleteResponse = async (req, res) => {
  const row = await loadMyResponse(req);
  row.status = 'deleted';
  await row.save({ fields: ['status'] });
  await audit.recordSafe({ actorId: req.user.id, actorRole: 'self', action: 'delete_self', targetType: 'review_response', targetId: row.id, subjectUserId: req.user.id });
  send(res, 200, { deleted: true });
};

// ═════════════════════════════════════════════════════════════════════════════
// Moderation (community moderators, scoped; admins through /admin/*)
// ═════════════════════════════════════════════════════════════════════════════

const OPEN = reportsSvc.OPEN_STATUSES;
const POST_MOD_ACTIONS = ['pin', 'unpin', 'lock', 'unlock', 'remove', 'restore', 'approve'];
const COMMENT_MOD_ACTIONS = ['remove', 'restore', 'approve'];

/** Report target ids that refer to one post (the post itself and, for reviews, the review row). */
const reportKeysForPost = async (post) => {
  const keys = [{ targetType: 'forum_post', targetId: post.id }];
  if (post.type === 'review') {
    const rv = await M('FriendsReview').findOne({ where: { forumPostId: post.id }, attributes: ['id'] });
    if (rv) keys.push({ targetType: 'review', targetId: rv.id });
  }
  return keys;
};

const closeReports = async (keys, { status, decision, actorId, actionId, note }) => {
  if (!keys.length) return 0;
  const [n] = await M('FriendsReport').update(
    { status, decision, resolvedBy: actorId, resolvedAt: new Date(), resolution: note || null, actionId },
    { where: { [Op.or]: keys.map((k) => ({ targetType: k.targetType, targetId: k.targetId })), status: { [Op.in]: OPEN } } },
  );
  if (n) notifyAdmin('friends_report', 'updated', keys[0].targetId, { scope: 'forum' });
  return n;
};

// `transaction` (moderation queue / appeals): the row writes join it and the derived recounts run
// after commit. Without it (SQLite) the recounts waited on the open transaction's write lock:
// resolving a report with "remove" failed with SQLITE_BUSY after 6 s.
const afterTx = (transaction, tag, fn) => {
  if (transaction && typeof transaction.afterCommit === 'function') {
    transaction.afterCommit(() => { Promise.resolve().then(fn).catch((e) => console.warn(`[${tag}]`, e.message)); });
    return Promise.resolve();
  }
  return fn();
};

const setPostStatus = async (post, status, reason, { transaction } = {}) => {
  post.status = status;
  if (status === 'visible') post.removedReason = null;
  else if (reason) post.removedReason = String(reason).slice(0, 300);
  if (status !== 'visible') post.isPinned = false;
  await post.save({ fields: ['status', 'removedReason', 'isPinned'], transaction });
  let reviewTarget = null;
  if (post.type === 'review') {
    const rv = await M('FriendsReview').findOne({ where: { forumPostId: post.id }, transaction });
    if (rv) {
      rv.status = status === 'visible' ? 'published' : status === 'pending_review' ? 'pending_review' : status === 'hidden' ? 'hidden' : 'removed';
      await rv.save({ fields: ['status'], transaction });
      reviewTarget = rv.targetId;
    }
  }
  await afterTx(transaction, 'FORUM_RECOUNT_WARN', async () => {
    if (reviewTarget) await recomputeTarget(reviewTarget);
    await recountCommunity(post.communityId);
  });
};

const setCommentStatus = async (comment, status, reason, { transaction } = {}) => {
  comment.status = status;
  comment.removedReason = status === 'visible' ? null : (reason ? String(reason).slice(0, 300) : comment.removedReason);
  await comment.save({ fields: ['status', 'removedReason'], transaction });
  await afterTx(transaction, 'FORUM_RECOUNT_WARN', async () => {
    if (status !== 'visible') {
      const post = await M('FriendsForumPost').findByPk(comment.postId);
      if (post && String(post.bestCommentId) === String(comment.id)) await clearBest(post);
    }
    await recountComments(comment.postId);
  });
};

/**
 * Community moderators may not approve or restore content that carries an open critical report
 * (threat / self-harm: admin-only, same rule as modDismiss), and may not restore content an admin
 * or the system took down (no undoing a higher decision) or anything in 'hidden' status.
 */
const guardModReversal = async (actor, keys, action, status) => {
  if (actor.role !== 'community_mod' || !['approve', 'restore'].includes(action)) return;
  const where = { [Op.or]: keys.map((k) => ({ targetType: k.targetType, targetId: k.targetId })) };
  const critical = await M('FriendsReport').count({ where: { ...where, status: { [Op.in]: OPEN }, severity: 'critical' } });
  if (critical) throw fail(403, 'ADMIN_ONLY', 'Reports about threats or self-harm are reviewed by the ZenWe team.');
  if (action !== 'restore') return;
  if (status === 'hidden') throw fail(403, 'ADMIN_ONLY', 'Hidden content can only be restored by the ZenWe team.');
  const last = await M('FriendsModAction').findOne({
    where: { ...where, action: { [Op.in]: ['remove', 'hide'] } },
    order: [['createdAt', 'DESC'], ['id', 'DESC']],
    attributes: ['actorRole'],
  });
  if (last && ['admin', 'system'].includes(last.actorRole)) throw fail(403, 'ADMIN_ONLY', 'This was taken down by the ZenWe team. Only an admin can restore it.');
};

/**
 * Shared moderator action on a post. actor = { id, role: 'admin'|'community_mod' }.
 * Community moderators: only in their community, never on their own content (conflict of interest),
 * never on a review they answered, and only admins approve professor reviews (defamation risk).
 */
const moderatePost = async (actor, post, action, reason) => {
  if (!POST_MOD_ACTIONS.includes(action)) throw fail(400, 'INVALID_ACTION', `Action must be one of ${POST_MOD_ACTIONS.join(', ')}.`);
  if (post.status === 'deleted') throw fail(404, 'POST_NOT_FOUND', 'Post not found.');
  if (actor.role === 'community_mod') {
    if (String(post.authorId) === String(actor.id)) throw fail(403, 'CONFLICT_OF_INTEREST', 'You cannot moderate your own content. Another moderator or an admin will handle it.');
    if (post.type === 'review') {
      const rv = await M('FriendsReview').findOne({ where: { forumPostId: post.id } });
      if (rv) {
        const answered = await M('FriendsReviewResponse').findOne({ where: { reviewId: rv.id, responderId: actor.id } });
        if (answered) throw fail(403, 'CONFLICT_OF_INTEREST', 'You replied to this review, so you cannot moderate it.');
        const target = await M('FriendsReviewTarget').findByPk(rv.targetId);
        if (target && target.kind === 'professor' && ['approve', 'restore'].includes(action)) {
          throw fail(403, 'ADMIN_ONLY', 'Faculty reviews under review are decided by the ZenWe team.');
        }
      }
    }
  }
  if (post.status !== 'visible') await guardModReversal(actor, await reportKeysForPost(post), action, post.status);
  const needsReason = action === 'remove';
  if (needsReason && (!reason || reason.length < 3)) throw fail(400, 'REASON_REQUIRED', 'Give a short reason for the removal. The author sees it and can appeal.');
  let auditAction = action;
  switch (action) {
    case 'pin': {
      if (post.status !== 'visible') throw fail(409, 'NOT_VISIBLE', 'Only visible posts can be pinned.');
      const pinned = await M('FriendsForumPost').count({ where: { communityId: post.communityId, isPinned: true, status: 'visible' } });
      if (!post.isPinned && pinned >= PIN_LIMIT) throw fail(409, 'PIN_LIMIT', `A community can pin at most ${PIN_LIMIT} posts.`);
      post.isPinned = true;
      await post.save({ fields: ['isPinned'] });
      break;
    }
    case 'unpin':
      post.isPinned = false;
      await post.save({ fields: ['isPinned'] });
      break;
    case 'lock':
    case 'unlock':
      post.isLocked = action === 'lock';
      await post.save({ fields: ['isLocked'] });
      break;
    case 'remove':
      await setPostStatus(post, 'removed', reason);
      break;
    case 'restore':
      if (post.status === 'visible') throw fail(409, 'ALREADY_VISIBLE', 'This post is already visible.');
      await setPostStatus(post, 'visible');
      if (post.isFreshersGuide) { post.isPinned = true; await post.save({ fields: ['isPinned'] }); }
      break;
    case 'approve':
      if (post.status !== 'pending_review') throw fail(409, 'NOT_PENDING', 'This post is not waiting for review.');
      await setPostStatus(post, 'visible');
      if (post.isFreshersGuide) { post.isPinned = true; await post.save({ fields: ['isPinned'] }); }
      auditAction = 'approve';
      break;
    default:
      break;
  }
  const action$ = await audit.record({
    actorId: actor.id,
    actorRole: actor.role,
    action: auditAction,
    targetType: 'forum_post',
    targetId: post.id,
    subjectUserId: ['remove'].includes(action) ? post.authorId : null,
    anonymous: !!post.isAnonymous,
    communityId: post.communityId,
    reason: reason || null,
  });
  const keys = await reportKeysForPost(post);
  if (action === 'remove') await closeReports(keys, { status: 'actioned', decision: 'remove', actorId: actor.id, actionId: action$.id, note: reason });
  if (action === 'approve') await closeReports(keys, { status: 'dismissed', decision: 'dismiss', actorId: actor.id, actionId: action$.id, note: reason || 'Approved after review' });
  if (action === 'remove') {
    await notify('MOD_OUTCOME', [post.authorId], { id: action$.id, dedupeKey: `decision:${action$.id}`, data: { kind: 'decision', actionId: action$.id } });
  }
  return action$;
};

const moderateComment = async (actor, comment, post, action, reason) => {
  if (!COMMENT_MOD_ACTIONS.includes(action)) throw fail(400, 'INVALID_ACTION', `Action must be one of ${COMMENT_MOD_ACTIONS.join(', ')}.`);
  if (comment.status === 'deleted') throw fail(404, 'COMMENT_NOT_FOUND', 'Comment not found.');
  if (actor.role === 'community_mod' && String(comment.authorId) === String(actor.id)) {
    throw fail(403, 'CONFLICT_OF_INTEREST', 'You cannot moderate your own content. Another moderator or an admin will handle it.');
  }
  if (comment.status !== 'visible') await guardModReversal(actor, [{ targetType: 'forum_comment', targetId: comment.id }], action, comment.status);
  if (action === 'remove' && (!reason || reason.length < 3)) throw fail(400, 'REASON_REQUIRED', 'Give a short reason for the removal. The author sees it and can appeal.');
  if (action === 'remove') await setCommentStatus(comment, 'removed', reason);
  else if (action === 'restore') {
    if (comment.status === 'visible') throw fail(409, 'ALREADY_VISIBLE', 'This comment is already visible.');
    await setCommentStatus(comment, 'visible');
  } else {
    if (comment.status !== 'pending_review') throw fail(409, 'NOT_PENDING', 'This comment is not waiting for review.');
    await setCommentStatus(comment, 'visible');
  }
  const row = await audit.record({
    actorId: actor.id,
    actorRole: actor.role,
    action,
    targetType: 'forum_comment',
    targetId: comment.id,
    subjectUserId: action === 'remove' ? comment.authorId : null,
    anonymous: !!comment.isAnonymous,
    communityId: post.communityId,
    reason: reason || null,
  });
  const keys = [{ targetType: 'forum_comment', targetId: comment.id }];
  if (action === 'remove') {
    await closeReports(keys, { status: 'actioned', decision: 'remove', actorId: actor.id, actionId: row.id, note: reason });
    await notify('MOD_OUTCOME', [comment.authorId], { id: row.id, dedupeKey: `decision:${row.id}`, data: { kind: 'decision', actionId: row.id } });
  }
  if (action === 'approve') await closeReports(keys, { status: 'dismissed', decision: 'dismiss', actorId: actor.id, actionId: row.id, note: reason || 'Approved after review' });
  return row;
};

const modReason = (req) => optText((req.body || {}).reason, 300, 'Reason');

// POST /mod/posts/:id/:action { reason }
const modPost = async (req, res) => {
  const me = req.user.id;
  const { post, role } = await loadPostFor(req, req.params.id, { allowHidden: true });
  if (!role) throw fail(403, 'NOT_MODERATOR', 'Only moderators of this community can do that.');
  limiter.enforce(me, 'forum_mod');
  const row = await moderatePost({ id: me, role: 'community_mod' }, post, String(req.params.action), modReason(req));
  const [dto] = await serializePosts(req, [post], me, { full: true, roles: new Map([[String(post.communityId), role]]) });
  send(res, 200, { ok: true, actionId: row.id, post: dto });
};

// POST /mod/comments/:id/:action { reason }
const modComment = async (req, res) => {
  const me = req.user.id;
  const { comment, post, role } = await loadCommentFor(req, req.params.id);
  if (!role) throw fail(403, 'NOT_MODERATOR', 'Only moderators of this community can do that.');
  limiter.enforce(me, 'forum_mod');
  const row = await moderateComment({ id: me, role: 'community_mod' }, comment, post, String(req.params.action), modReason(req));
  const [dto] = await serializeComments(req, [comment], me, { isMod: true });
  send(res, 200, { ok: true, actionId: row.id, comment: dto });
};

/** Communities this user moderates (id strings). */
const moderatedIds = async (userId) => [...(await myRoles(userId)).keys()];

/** Resolves report targets to { communityId, authorId } for forum types. */
const forumTargetInfo = async (targetType, targetId) => {
  if (targetType === 'forum_post') {
    const p = await M('FriendsForumPost').findByPk(targetId, { attributes: ['id', 'communityId', 'authorId'] });
    return p ? { communityId: String(p.communityId), authorId: String(p.authorId), postId: p.id } : null;
  }
  if (targetType === 'forum_comment') {
    const c = await M('FriendsForumComment').findByPk(targetId, { attributes: ['id', 'postId', 'authorId'] });
    if (!c) return null;
    const p = await M('FriendsForumPost').findByPk(c.postId, { attributes: ['communityId'] });
    return p ? { communityId: String(p.communityId), authorId: String(c.authorId), postId: c.postId } : null;
  }
  if (targetType === 'review') {
    const r = await M('FriendsReview').findByPk(targetId, { attributes: ['id', 'forumPostId', 'authorId'] });
    if (!r) return null;
    const p = await M('FriendsForumPost').findByPk(r.forumPostId, { attributes: ['communityId'] });
    return p ? { communityId: String(p.communityId), authorId: String(r.authorId), postId: r.forumPostId } : null;
  }
  return null;
};

/** Batched forumTargetInfo for many targets: Map "<type>:<id>" -> info (a few queries, not 2 per target). */
const forumTargetInfos = async (list) => {
  const ids = { forum_post: [], forum_comment: [], review: [] };
  for (const t of list) if (ids[t.targetType]) ids[t.targetType].push(String(t.targetId));
  const findIn = (model, idList, attributes) => (idList.length ? M(model).findAll({ where: { id: { [Op.in]: [...new Set(idList)] } }, attributes }) : []);
  const [posts, comments, reviews] = await Promise.all([
    findIn('FriendsForumPost', ids.forum_post, ['id', 'communityId', 'authorId']),
    findIn('FriendsForumComment', ids.forum_comment, ['id', 'postId', 'authorId']),
    findIn('FriendsReview', ids.review, ['id', 'forumPostId', 'authorId']),
  ]);
  const parentIds = [...comments.map((c) => String(c.postId)), ...reviews.map((r) => String(r.forumPostId))];
  const parents = await findIn('FriendsForumPost', parentIds, ['id', 'communityId']);
  const communityOf = new Map([...posts, ...parents].map((p) => [String(p.id), String(p.communityId)]));
  const out = new Map();
  for (const p of posts) out.set(`forum_post:${p.id}`, { communityId: String(p.communityId), authorId: String(p.authorId), postId: p.id });
  for (const c of comments) if (communityOf.has(String(c.postId))) out.set(`forum_comment:${c.id}`, { communityId: communityOf.get(String(c.postId)), authorId: String(c.authorId), postId: c.postId });
  for (const r of reviews) if (communityOf.has(String(r.forumPostId))) out.set(`review:${r.id}`, { communityId: communityOf.get(String(r.forumPostId)), authorId: String(r.authorId), postId: r.forumPostId });
  return out;
};

// GET /mod/reports?communityId=&cursor= — open reports on content in communities I moderate.
// No reporter ids, no anonymous identities; reports about my own content are left out (conflict).
const modReports = async (req, res) => {
  const me = req.user.id;
  let communities = await moderatedIds(me);
  if (!communities.length) throw fail(403, 'NOT_MODERATOR', 'You do not moderate any community.');
  if (req.query.communityId) {
    const cid = requireUuid(String(req.query.communityId), 'community');
    if (!communities.includes(cid)) throw fail(403, 'NOT_MODERATOR', 'You do not moderate that community.');
    communities = [cid];
  }
  const rows = await M('FriendsReport').findAll({
    where: { subTab: 'forum', status: { [Op.in]: ['open', 'in_review'] }, targetType: { [Op.in]: ['forum_post', 'forum_comment', 'review'] }, campusId: campusOf(req) },
    order: [['createdAt', 'DESC']],
    limit: 300,
  });
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.targetType}:${r.targetId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const items = [];
  const infos = await forumTargetInfos([...groups.values()].map((list) => list[0]));
  for (const list of groups.values()) {
    const first = list[0];
    const info = infos.get(`${first.targetType}:${first.targetId}`) || null;
    if (!info || !communities.includes(info.communityId) || info.authorId === String(me)) continue;
    items.push({
      reportId: first.id,
      reportIds: list.map((r) => r.id),
      targetType: first.targetType,
      targetId: first.targetId,
      postId: info.postId,
      communityId: info.communityId,
      reportCount: list.length,
      categories: [...new Set(list.map((r) => r.category))],
      severity: list.reduce((m, r) => (reportsSvc.SEVERITY_RANK[r.severity] > reportsSvc.SEVERITY_RANK[m] ? r.severity : m), 'low'),
      snapshot: { excerpt: (first.snapshot || {}).excerpt || '', anonymous: !!(first.snapshot || {}).anonymous, alias: (first.snapshot || {}).alias },
      isSystem: list.every((r) => r.isSystem),
      lastReportedAt: first.createdAt,
    });
  }
  send(res, 200, { items: items.slice(0, 50) });
};

// POST /mod/reports/:id/dismiss { reason } — closes every open report on that target as dismissed.
// Critical reports (threats, self-harm) are left to admins.
const modDismiss = async (req, res) => {
  const me = req.user.id;
  const report = await M('FriendsReport').findByPk(requireUuid(req.params.id, 'report'));
  if (!report || !['open', 'in_review'].includes(report.status)) throw fail(404, 'REPORT_NOT_FOUND', 'Report not found or already closed.');
  const info = await forumTargetInfo(report.targetType, report.targetId);
  const communities = await moderatedIds(me);
  if (!info || !communities.includes(info.communityId)) throw fail(403, 'NOT_MODERATOR', 'Only moderators of this community can do that.');
  if (info.authorId === String(me)) throw fail(403, 'CONFLICT_OF_INTEREST', 'This report is about your own content.');
  const open = await M('FriendsReport').findAll({ where: { targetType: report.targetType, targetId: report.targetId, status: { [Op.in]: OPEN } }, attributes: ['severity'] });
  if (open.some((r) => r.severity === 'critical')) throw fail(403, 'ADMIN_ONLY', 'Reports about threats or self-harm are reviewed by the ZenWe team.');
  const reason = modReason(req);
  limiter.enforce(me, 'forum_mod');
  const row = await audit.record({ actorId: me, actorRole: 'community_mod', action: 'dismiss', targetType: report.targetType, targetId: report.targetId, communityId: info.communityId, reportId: report.id, reason });
  const closed = await closeReports([{ targetType: report.targetType, targetId: report.targetId }], { status: 'dismissed', decision: 'dismiss', actorId: me, actionId: row.id, note: reason });
  send(res, 200, { ok: true, reportsClosed: closed, actionId: row.id });
};

// GET /communities/:id/modlog?cursor= — moderators of that community (and admins via /admin).
const modLog = async (req, res) => {
  const me = req.user.id;
  const c = await loadCommunity(req.params.id, campusOf(req));
  if (!(await roleIn(c.id, me))) throw fail(403, 'NOT_MODERATOR', 'Only moderators can see the mod log.');
  send(res, 200, await modLogPayload(req, c.id));
};

const modLogPayload = async (req, communityId) => {
  const limit = cursor.pageSize(req.query.limit, 30);
  const and = [{ communityId, actorRole: { [Op.in]: ['community_mod', 'admin', 'system'] } }];
  const after = cursor.after(req.query.cursor);
  if (after) and.push(after);
  const rows = await M('FriendsModAction').findAll({ where: { [Op.and]: and }, order: [['createdAt', 'DESC'], ['id', 'DESC']], limit: limit + 1 });
  const { items, nextCursor } = cursor.page(rows, limit);
  const modIds = items.filter((a) => a.actorRole === 'community_mod').map((a) => a.actorId);
  const ids = await identity.loadIdentities(req, modIds, { viewerId: req.user.id });
  return {
    items: items.map((a) => ({
      id: a.id,
      action: a.action,
      actorRole: a.actorRole,
      moderator: a.actorRole === 'community_mod' ? (ids.get(String(a.actorId)) || null) : { name: a.actorRole === 'admin' ? 'ZenWe Friends team' : 'Automatic check' },
      targetType: a.targetType,
      targetId: a.targetId,
      reason: a.reason,
      createdAt: a.createdAt,
    })),
    nextCursor,
  };
};

// ═════════════════════════════════════════════════════════════════════════════
// Admin (protect + admin; not behind the forum flag so admins can prepare before launch)
// ═════════════════════════════════════════════════════════════════════════════

const adminCampus = async (raw) => {
  const id = requireUuid(String(raw || ''), 'campus');
  const campus = await M('Campus').findByPk(id);
  if (!campus) throw fail(404, 'CAMPUS_NOT_FOUND', 'Campus not found.');
  return campus;
};

// GET /admin/communities?campusId=&status=
const adminListCommunities = async (req, res) => {
  const where = {};
  if (req.query.campusId) where.campusId = (await adminCampus(req.query.campusId)).id;
  if (req.query.status) {
    if (!F.COMMUNITY_STATUS.includes(String(req.query.status))) throw fail(400, 'INVALID_FILTER', 'Unknown status.');
    where.status = String(req.query.status);
  }
  const rows = await M('FriendsCommunity').findAll({ where, order: [['campusId', 'ASC'], ['sortOrder', 'ASC'], ['name', 'ASC']], limit: 500 });
  const roles = await M('FriendsCommunityRole').findAll({ where: { communityId: { [Op.in]: rows.map((c) => c.id) } } });
  const ids = await identity.loadIdentities(req, roles.map((r) => r.userId));
  const rolesOf = new Map();
  roles.forEach((r) => {
    const k = String(r.communityId);
    if (!rolesOf.has(k)) rolesOf.set(k, []);
    rolesOf.get(k).push({ userId: r.userId, role: r.role, user: ids.get(String(r.userId)) || null });
  });
  send(res, 200, { items: rows.map((c) => ({ ...communityOut(c, {}), campusId: c.campusId, sortOrder: c.sortOrder, createdAt: c.createdAt, moderators: rolesOf.get(String(c.id)) || [] })) });
};

// POST /admin/communities { campusId, name, slug?, description, rules, allowAnonymous, allowedTypes, sortOrder }
const adminCreateCommunity = async (req, res) => {
  const b = req.body || {};
  const campus = await adminCampus(b.campusId);
  const patch = parseCommunityPatch(b, { admin: true });
  if (!patch.name) throw fail(400, 'INVALID_INPUT', 'Name is required.');
  const slug = String(b.slug || patch.name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  if (slug.length < 3) throw fail(400, 'INVALID_SLUG', 'Slug must have at least 3 letters or numbers.');
  let row;
  try {
    row = await M('FriendsCommunity').create({ allowAnonymous: true, allowedTypes: F.POST_TYPES, ...patch, campusId: campus.id, slug, kind: 'custom', status: 'active', createdBy: req.user.id });
  } catch (err) {
    if (isUniqueError(err)) throw fail(409, 'SLUG_TAKEN', 'A community with that slug already exists on this campus.');
    throw err;
  }
  await audit.record({ actorId: req.user.id, actorRole: 'admin', action: 'entity_create', targetType: 'community', targetId: row.id, communityId: row.id, meta: { name: row.name, slug } });
  send(res, 201, { community: { ...communityOut(row, {}), campusId: row.campusId } });
};

// PUT /admin/communities/:id { ...fields, status: active|archived }
const adminUpdateCommunity = async (req, res) => {
  const c = await M('FriendsCommunity').findByPk(requireUuid(req.params.id, 'community'));
  if (!c) throw fail(404, 'COMMUNITY_NOT_FOUND', 'Community not found.');
  const b = req.body || {};
  const patch = parseCommunityPatch(b, { admin: true });
  let action = 'entity_update';
  if (b.status !== undefined) {
    if (!F.COMMUNITY_STATUS.includes(b.status)) throw fail(400, 'INVALID_STATUS', 'Status must be active, pending or archived.');
    if (c.kind === 'default' && b.status !== 'active') throw fail(400, 'DEFAULT_COMMUNITY', 'Default communities cannot be archived.');
    if (c.status === 'pending' && b.status === 'active') action = 'approve';
    if (c.status === 'pending' && b.status === 'archived') action = 'reject';
    patch.status = b.status;
  }
  await c.update(patch);
  await audit.record({ actorId: req.user.id, actorRole: 'admin', action, targetType: 'community', targetId: c.id, communityId: c.id, meta: { fields: Object.keys(patch), status: c.status } });
  // The requester becomes the owner of an approved community.
  if (action === 'approve' && c.createdBy) {
    try { await M('FriendsCommunityRole').create({ communityId: c.id, userId: c.createdBy, role: 'owner', grantedBy: req.user.id }); } catch (err) { if (!isUniqueError(err)) throw err; }
  }
  send(res, 200, { community: { ...communityOut(c, {}), campusId: c.campusId, sortOrder: c.sortOrder } });
};

// POST /admin/communities/:id/moderators { userId, role }  ·  DELETE /admin/communities/:id/moderators/:userId
const adminAddModerator = async (req, res) => {
  const c = await M('FriendsCommunity').findByPk(requireUuid(req.params.id, 'community'));
  if (!c) throw fail(404, 'COMMUNITY_NOT_FOUND', 'Community not found.');
  const b = req.body || {};
  const userId = requireUuid(String(b.userId || ''), 'user');
  const role = String(b.role || 'moderator');
  if (!F.COMMUNITY_ROLES.includes(role)) throw fail(400, 'INVALID_ROLE', 'Role must be owner or moderator.');
  const [user, profile] = await Promise.all([
    M('User').findByPk(userId, { attributes: ['id', 'isActive'] }),
    M('CampusProfile').findOne({ where: { userId }, attributes: ['campusId', 'verificationStatus'] }),
  ]);
  if (!user || user.isActive === false || !profile || profile.verificationStatus !== 'verified' || String(profile.campusId) !== String(c.campusId)) {
    throw fail(400, 'NOT_ELIGIBLE', 'Moderators must be verified, active students of this campus.');
  }
  const Role = M('FriendsCommunityRole');
  const existing = await Role.findOne({ where: { communityId: c.id, userId } });
  if (existing) {
    existing.role = role;
    existing.grantedBy = req.user.id;
    await existing.save();
  } else {
    try { await Role.create({ communityId: c.id, userId, role, grantedBy: req.user.id }); } catch (err) { if (!isUniqueError(err)) throw err; }
  }
  await audit.record({ actorId: req.user.id, actorRole: 'admin', action: 'role_grant', targetType: 'user', targetId: userId, subjectUserId: userId, communityId: c.id, meta: { role } });
  send(res, existing ? 200 : 201, { ok: true, role });
};

const adminRemoveModerator = async (req, res) => {
  const communityId = requireUuid(req.params.id, 'community');
  const userId = requireUuid(req.params.userId, 'user');
  const n = await M('FriendsCommunityRole').destroy({ where: { communityId, userId } });
  if (!n) throw fail(404, 'ROLE_NOT_FOUND', 'That user is not a moderator here.');
  await audit.record({ actorId: req.user.id, actorRole: 'admin', action: 'role_revoke', targetType: 'user', targetId: userId, subjectUserId: userId, communityId });
  send(res, 200, { ok: true });
};

// POST /admin/seed { campusId? }
const adminSeed = async (req, res) => {
  const b = req.body || {};
  let created;
  if (b.campusId) {
    const campus = await adminCampus(b.campusId);
    seed.resetSeedCache();
    created = await seed.ensureDefaults(getSequelize(), campus.id);
  } else {
    seed.resetSeedCache();
    created = await seed.seedAllCampuses(getSequelize());
  }
  send(res, 200, { ok: true, created });
};

// GET /admin/communities/:id/modlog
const adminModLog = async (req, res) => {
  const c = await M('FriendsCommunity').findByPk(requireUuid(req.params.id, 'community'));
  if (!c) throw fail(404, 'COMMUNITY_NOT_FOUND', 'Community not found.');
  send(res, 200, await modLogPayload(req, c.id));
};

// PUT /admin/communities/:id/freshers-guide { title, body, official (default true) }
// Admin-authored guide: labelled Official unless official:false. Creates or replaces the text.
const adminUpsertGuide = async (req, res) => {
  const c = await M('FriendsCommunity').findByPk(requireUuid(req.params.id, 'community'));
  if (!c || c.status !== 'active') throw fail(404, 'COMMUNITY_NOT_FOUND', 'Community not found.');
  const b = req.body || {};
  const title = requiredText(b.title, 5, 150, 'Title');
  const body = requiredText(b.body, 20, 5000, 'Body');
  const official = b.official !== false;
  const cfg = await flags.getConfig();
  contentPolicy.enforce(`${title}\n${body}`, { kind: 'forum_post', cfg, allowEmail: true });
  const Post = M('FriendsForumPost');
  let guide = await Post.findOne({ where: { communityId: c.id, isFreshersGuide: true, status: { [Op.in]: ['visible', 'pending_review'] } } });
  const now = new Date();
  let created = false;
  if (guide) {
    const previous = { title: guide.title, body: guide.body, isOfficial: guide.isOfficial };
    Object.assign(guide, { title, body, isOfficial: official, status: 'visible', isPinned: true, editedAt: now });
    await guide.save();
    await audit.record({ actorId: req.user.id, actorRole: 'admin', action: 'entity_update', targetType: 'forum_post', targetId: guide.id, communityId: c.id, meta: { kind: 'freshers_guide', previous } });
  } else {
    guide = await Post.create({
      communityId: c.id, campusId: c.campusId, authorId: req.user.id, type: 'guidance', title, body, isOfficial: official,
      isFreshersGuide: true, isPinned: true, status: 'visible', hotRank: rank.hotRank(0, now, 0), lastActivityAt: now,
    });
    created = true;
    await audit.record({ actorId: req.user.id, actorRole: 'admin', action: 'entity_create', targetType: 'forum_post', targetId: guide.id, communityId: c.id, meta: { kind: 'freshers_guide' } });
  }
  await recountCommunity(c.id);
  send(res, created ? 201 : 200, { guide: { postId: guide.id, title: guide.title, body: guide.body, isOfficial: guide.isOfficial, label: guide.isOfficial ? 'official' : 'student', updatedAt: guide.editedAt || guide.createdAt } });
};

// GET /admin/freshers-guides?campusId=
const adminListGuides = async (req, res) => {
  const where = { isFreshersGuide: true, status: { [Op.in]: ['visible', 'pending_review'] } };
  if (req.query.campusId) where.campusId = (await adminCampus(req.query.campusId)).id;
  const rows = await M('FriendsForumPost').findAll({ where, order: [['createdAt', 'DESC']], limit: 500 });
  send(res, 200, { items: rows.map((g) => ({ postId: g.id, communityId: g.communityId, campusId: g.campusId, title: g.title, body: g.body, isOfficial: g.isOfficial, label: g.isOfficial ? 'official' : 'student', status: g.status, updatedAt: g.editedAt || g.createdAt })) });
};

// GET /admin/review-targets?campusId=&status=&kind=
const adminListTargets = async (req, res) => {
  const where = {};
  if (req.query.campusId) where.campusId = (await adminCampus(req.query.campusId)).id;
  if (req.query.status) {
    if (!F.REVIEW_TARGET_STATUS.includes(String(req.query.status))) throw fail(400, 'INVALID_FILTER', 'Unknown status.');
    where.status = String(req.query.status);
  }
  if (req.query.kind) {
    if (!F.REVIEW_KINDS.includes(String(req.query.kind))) throw fail(400, 'INVALID_FILTER', 'Unknown kind.');
    where.kind = String(req.query.kind);
  }
  const rows = await M('FriendsReviewTarget').findAll({ where, order: [['createdAt', 'DESC']], limit: 500 });
  send(res, 200, { items: rows.map((t) => ({ ...targetOut(t), campusId: t.campusId, adminMeta: t.meta || {}, createdBy: t.createdBy, createdAt: t.createdAt })) });
};

// POST /admin/review-targets { campusId, kind, name, meta{department,code,block,facultyUserId,entityId} } (active)
const adminCreateTarget = async (req, res) => {
  const b = req.body || {};
  const campus = await adminCampus(b.campusId);
  const kind = String(b.kind || '');
  if (!F.REVIEW_KINDS.includes(kind)) throw fail(400, 'INVALID_KIND', `Kind must be one of ${F.REVIEW_KINDS.join(', ')}.`);
  const name = requiredText(b.name, 2, 120, 'Name');
  const meta = parseTargetMeta(b.meta, true);
  const nameKey = nameKeyOf(name);
  let row;
  try {
    row = await M('FriendsReviewTarget').create({ campusId: campus.id, kind, name, nameKey, meta, status: 'active', createdBy: req.user.id });
  } catch (err) {
    if (isUniqueError(err)) throw fail(409, 'TARGET_EXISTS', 'That already exists on this campus.');
    throw err;
  }
  await audit.record({ actorId: req.user.id, actorRole: 'admin', action: 'entity_create', targetType: 'review_target', targetId: row.id, meta: { kind, name } });
  send(res, 201, { target: { ...targetOut(row), adminMeta: row.meta } });
};

// PUT /admin/review-targets/:id { name, meta, status }  ·  POST /admin/review-targets/:id/approve|reject
const adminUpdateTarget = async (req, res) => {
  const t = await M('FriendsReviewTarget').findByPk(requireUuid(req.params.id, 'review target'));
  if (!t) throw fail(404, 'REVIEW_TARGET_NOT_FOUND', 'Not found.');
  const b = req.body || {};
  if (b.name !== undefined) {
    t.name = requiredText(b.name, 2, 120, 'Name');
    t.nameKey = nameKeyOf(t.name);
  }
  if (b.meta !== undefined) t.meta = { ...(t.meta || {}), ...parseTargetMeta(b.meta, true) };
  if (b.status !== undefined) {
    if (!F.REVIEW_TARGET_STATUS.includes(b.status)) throw fail(400, 'INVALID_STATUS', 'Status must be active, pending or hidden.');
    t.status = b.status;
  }
  try { await t.save(); } catch (err) { if (isUniqueError(err)) throw fail(409, 'TARGET_EXISTS', 'That name already exists.'); throw err; }
  await audit.record({ actorId: req.user.id, actorRole: 'admin', action: 'entity_update', targetType: 'review_target', targetId: t.id, meta: { fields: Object.keys(b) } });
  send(res, 200, { target: { ...targetOut(t), adminMeta: t.meta } });
};

const decideTarget = (approve) => async (req, res) => {
  const t = await M('FriendsReviewTarget').findByPk(requireUuid(req.params.id, 'review target'));
  if (!t) throw fail(404, 'REVIEW_TARGET_NOT_FOUND', 'Not found.');
  t.status = approve ? 'active' : 'hidden';
  await t.save({ fields: ['status'] });
  await audit.record({ actorId: req.user.id, actorRole: 'admin', action: approve ? 'approve' : 'reject', targetType: 'review_target', targetId: t.id, reason: optText((req.body || {}).reason, 300, 'Reason') });
  send(res, 200, { target: targetOut(t) });
};

// GET /admin/reviews?status=pending_review&campusId= — flagged reviews (reviewer not shown).
const adminListReviews = async (req, res) => {
  const status = String(req.query.status || 'pending_review');
  if (!F.REVIEW_STATUS.includes(status)) throw fail(400, 'INVALID_FILTER', 'Unknown status.');
  const where = { status, active: true };
  // Campus filter inside the query: filtering the newest 200 afterwards dropped a campus's reviews
  // whenever other campuses had more recent ones.
  if (req.query.campusId) {
    const campusId = requireUuid(String(req.query.campusId), 'campus');
    const campusPosts = await M('FriendsForumPost').findAll({ where: { campusId, type: 'review' }, attributes: ['id'] });
    where.forumPostId = { [Op.in]: campusPosts.map((p) => p.id) };
  }
  const reviews = await M('FriendsReview').findAll({ where, order: [['createdAt', 'DESC']], limit: 200 });
  const posts = await M('FriendsForumPost').findAll({ where: { id: { [Op.in]: reviews.map((r) => r.forumPostId) } } });
  send(res, 200, { items: await serializePosts(req, posts, req.user.id, { full: true }) });
};

// POST /admin/posts/:id/:action  ·  POST /admin/comments/:id/:action  { reason }
const adminModPost = async (req, res) => {
  const post = await M('FriendsForumPost').findByPk(requireUuid(req.params.id, 'post'));
  if (!post) throw fail(404, 'POST_NOT_FOUND', 'Post not found.');
  const row = await moderatePost({ id: req.user.id, role: 'admin' }, post, String(req.params.action), modReason(req));
  send(res, 200, { ok: true, actionId: row.id, status: post.status, isPinned: post.isPinned, isLocked: post.isLocked });
};

const adminModComment = async (req, res) => {
  const comment = await M('FriendsForumComment').findByPk(requireUuid(req.params.id, 'comment'));
  if (!comment) throw fail(404, 'COMMENT_NOT_FOUND', 'Comment not found.');
  const post = await M('FriendsForumPost').findByPk(comment.postId);
  const row = await moderateComment({ id: req.user.id, role: 'admin' }, comment, post, String(req.params.action), modReason(req));
  send(res, 200, { ok: true, actionId: row.id, status: comment.status });
};

// POST /admin/reviews/:id/response { body } — the Zenvy team's right of reply.
const adminCreateResponse = (req, res) => createResponse(req, res, { asAdmin: true });

// ═════════════════════════════════════════════════════════════════════════════
// Report / moderation target resolvers (Phase 0 unified queue, appeals, reveal-author)
// ═════════════════════════════════════════════════════════════════════════════

const sameCampusViewer = async (viewerId, campusId) => {
  if (!viewerId) return true;
  const p = await M('CampusProfile').findOne({ where: { userId: viewerId }, attributes: ['campusId'] });
  return !!p && String(p.campusId) === String(campusId);
};

targets.register('forum_post', {
  statuses: ['pending_review', 'hidden', 'removed', 'visible'],
  async load(id, { viewerId } = {}) {
    const p = await M('FriendsForumPost').findByPk(id);
    if (!p || p.status === 'deleted') return null;
    if (viewerId && (!(await sameCampusViewer(viewerId, p.campusId)) || !canSee(p, viewerId, false))) return null;
    return {
      ownerId: p.authorId,
      campusId: p.campusId,
      subTab: 'forum',
      snapshot: {
        excerpt: targets.excerpt(`${p.title}${p.body ? `\n${p.body}` : ''}`),
        mediaIds: (p.media || []).map((m) => m.mediaId),
        anonymous: !!p.isAnonymous,
        alias: p.isAnonymous ? p.aliasName : undefined,
        communityId: p.communityId,
        postType: p.type,
        createdAt: p.createdAt,
      },
    };
  },
  async setStatus(id, status, { transaction } = {}) {
    const p = await M('FriendsForumPost').findByPk(id, { transaction });
    if (!p || p.status === 'deleted') return false;
    await setPostStatus(p, status, status === 'visible' ? null : 'Moderation decision', { transaction });
    if (status === 'visible' && p.isFreshersGuide) { p.isPinned = true; await p.save({ fields: ['isPinned'], transaction }); }
    return true;
  },
  async revealAuthor(id) {
    const p = await M('FriendsForumPost').findByPk(id, { attributes: ['authorId', 'isAnonymous'] });
    return p && p.isAnonymous ? p.authorId : null;
  },
  async currentState(id) {
    const p = await M('FriendsForumPost').findByPk(id);
    return p ? { exists: true, status: p.status, type: p.type, communityId: p.communityId, isPinned: p.isPinned, isLocked: p.isLocked, score: p.score, commentCount: p.commentCount, anonymous: !!p.isAnonymous } : { exists: false };
  },
});

targets.register('forum_comment', {
  statuses: ['pending_review', 'hidden', 'removed', 'visible'],
  async load(id, { viewerId } = {}) {
    const c = await M('FriendsForumComment').findByPk(id);
    if (!c || c.status === 'deleted') return null;
    const p = await M('FriendsForumPost').findByPk(c.postId, { attributes: ['id', 'campusId', 'communityId', 'status', 'authorId'] });
    if (!p || p.status === 'deleted') return null;
    if (viewerId && (!(await sameCampusViewer(viewerId, p.campusId)) || !canSee(c, viewerId, false))) return null;
    return {
      ownerId: c.authorId,
      campusId: p.campusId,
      subTab: 'forum',
      snapshot: { excerpt: targets.excerpt(c.body), mediaIds: [], anonymous: !!c.isAnonymous, alias: c.isAnonymous ? c.aliasName : undefined, postId: p.id, communityId: p.communityId, createdAt: c.createdAt },
    };
  },
  async setStatus(id, status, { transaction } = {}) {
    const c = await M('FriendsForumComment').findByPk(id, { transaction });
    if (!c || c.status === 'deleted') return false;
    await setCommentStatus(c, status, status === 'visible' ? null : 'Moderation decision', { transaction });
    return true;
  },
  async revealAuthor(id) {
    const c = await M('FriendsForumComment').findByPk(id, { attributes: ['authorId', 'isAnonymous'] });
    return c && c.isAnonymous ? c.authorId : null;
  },
  async currentState(id) {
    const c = await M('FriendsForumComment').findByPk(id);
    return c ? { exists: true, status: c.status, postId: c.postId, depth: c.depth, score: c.score, anonymous: !!c.isAnonymous } : { exists: false };
  },
});

targets.register('review', {
  statuses: ['pending_review', 'hidden', 'removed', 'visible'],
  async load(id, { viewerId } = {}) {
    const rv = await M('FriendsReview').findByPk(id);
    if (!rv || !rv.active) return null;
    const p = await M('FriendsForumPost').findByPk(rv.forumPostId);
    if (!p || p.status === 'deleted') return null;
    if (viewerId && (!(await sameCampusViewer(viewerId, p.campusId)) || !canSee(p, viewerId, false))) return null;
    const t = await M('FriendsReviewTarget').findByPk(rv.targetId, { attributes: ['kind', 'name'] });
    return {
      ownerId: rv.authorId,
      campusId: p.campusId,
      subTab: 'forum',
      snapshot: {
        excerpt: targets.excerpt(`${t ? `${t.kind}: ${t.name} | ` : ''}${rv.rating}/5 | ${p.title}${p.body ? `\n${p.body}` : ''}${rv.pros ? `\nPros: ${rv.pros}` : ''}${rv.cons ? `\nCons: ${rv.cons}` : ''}`),
        mediaIds: (p.media || []).map((m) => m.mediaId),
        anonymous: true,
        alias: p.aliasName,
        postId: p.id,
        communityId: p.communityId,
        flags: rv.flags || [],
        createdAt: rv.createdAt,
      },
    };
  },
  async setStatus(id, status, { transaction } = {}) {
    const rv = await M('FriendsReview').findByPk(id, { transaction });
    if (!rv) return false;
    const p = await M('FriendsForumPost').findByPk(rv.forumPostId, { transaction });
    if (!p || p.status === 'deleted') return false;
    await setPostStatus(p, status, status === 'visible' ? null : 'Moderation decision', { transaction });
    return true;
  },
  async revealAuthor(id) {
    const rv = await M('FriendsReview').findByPk(id, { attributes: ['authorId'] });
    return rv ? rv.authorId : null;
  },
  async currentState(id) {
    const rv = await M('FriendsReview').findByPk(id);
    return rv ? { exists: true, status: rv.status, active: rv.active, rating: rv.rating, targetId: rv.targetId, postId: rv.forumPostId, flags: rv.flags || [] } : { exists: false };
  },
});

targets.register('review_response', {
  statuses: ['hidden', 'removed', 'visible'],
  async load(id, { viewerId } = {}) {
    const r = await M('FriendsReviewResponse').findByPk(id);
    if (!r || r.status === 'deleted') return null;
    const rv = await M('FriendsReview').findByPk(r.reviewId, { attributes: ['forumPostId'] });
    const p = rv ? await M('FriendsForumPost').findByPk(rv.forumPostId, { attributes: ['campusId', 'communityId'] }) : null;
    if (!p) return null;
    if (viewerId && (!(await sameCampusViewer(viewerId, p.campusId)) || (r.status !== 'visible' && String(r.responderId) !== String(viewerId)))) return null;
    return {
      ownerId: r.responderId,
      campusId: p.campusId,
      subTab: 'forum',
      snapshot: { excerpt: targets.excerpt(r.body), mediaIds: [], anonymous: false, reviewId: r.reviewId, communityId: p.communityId, createdAt: r.createdAt },
    };
  },
  async setStatus(id, status, { transaction } = {}) {
    const r = await M('FriendsReviewResponse').findByPk(id, { transaction });
    if (!r || r.status === 'deleted') return false;
    r.status = status === 'pending_review' ? 'hidden' : status;
    await r.save({ fields: ['status'], transaction });
    return true;
  },
  async currentState(id) {
    const r = await M('FriendsReviewResponse').findByPk(id);
    return r ? { exists: true, status: r.status, responderRole: r.responderRole } : { exists: false };
  },
});

targets.register('community', {
  statuses: [],
  async load(id, { viewerId } = {}) {
    const c = await M('FriendsCommunity').findByPk(id);
    if (!c || c.status === 'archived') return null;
    if (viewerId && !(await sameCampusViewer(viewerId, c.campusId))) return null;
    return {
      ownerId: c.kind === 'custom' ? c.createdBy : null,
      campusId: c.campusId,
      subTab: 'forum',
      snapshot: { excerpt: targets.excerpt(`${c.name}${c.description ? ` | ${c.description}` : ''}`), mediaIds: [], anonymous: false, createdAt: c.createdAt },
    };
  },
  async currentState(id) {
    const c = await M('FriendsCommunity').findByPk(id);
    return c ? { exists: true, status: c.status, name: c.name, kind: c.kind } : { exists: false };
  },
});

module.exports = {
  // communities
  listCommunities, getCommunity, requestCommunity, updateCommunity, joinCommunity, leaveCommunity,
  // posts
  listPosts, search, myPosts, getPost, createPost, updatePost, deletePost, bookmark, unbookmark, listBookmarks,
  // comments
  listComments, createComment, updateComment, deleteComment,
  // votes & best answer
  vote, setBestAnswer, clearBestAnswer,
  // reviews
  listReviewTargets, requestReviewTarget, getReviewTarget, updateReview, deleteReview, createResponse, updateResponse, deleteResponse,
  // community moderators
  modPost, modComment, modReports, modDismiss, modLog,
  // admin
  adminListCommunities, adminCreateCommunity, adminUpdateCommunity, adminAddModerator, adminRemoveModerator, adminSeed, adminModLog,
  adminUpsertGuide, adminListGuides, adminListTargets, adminCreateTarget, adminUpdateTarget, adminListReviews,
  adminApproveTarget: decideTarget(true), adminRejectTarget: decideTarget(false),
  adminModPost, adminModComment, adminCreateResponse,
  // internals for tests
  _internal: { hotRank: rank.hotRank, evaluateBadges, recountVotes, KARMA_PER_PAIR_PER_DAY },
};
