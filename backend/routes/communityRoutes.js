const express = require('express');
const router = express.Router();
const { Op, literal } = require('sequelize');
const { getCommunityPostModel } = require('../models/CommunityPost');
const { getCommunityPostLikeModel } = require('../models/CommunityPostLike');
const { protect } = require('../middleware/authMiddleware');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => UUID_RE.test(String(v || ''));

// Signed-in viewer on the public lists (only to answer likedByMe); never required.
const optionalUserId = (req) => {
  const h = req.headers && req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return null;
  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(h.split(' ')[1].replace(/['"]+/g, '').trim(), process.env.JWT_SECRET);
    return decoded && decoded.id ? String(decoded.id) : null;
  } catch {
    return null;
  }
};

const legacyLikers = (row) => {
  const v = typeof row.get === 'function' ? row.get('likedBy') : row.likedBy;
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string') { try { const a = JSON.parse(v); return Array.isArray(a) ? a.map(String) : []; } catch { return []; } }
  return [];
};

// Public shape (B14): the like count and whether *I* liked it; never the list of who liked.
const shapePost = (row, likedIds) => {
  const j = typeof row.toJSON === 'function' ? row.toJSON() : { ...row };
  const legacy = legacyLikers(row);
  delete j.likedBy;
  // S0: stored /api/campus/avatar links get the signature the avatar endpoint now requires.
  if (j.userAvatar) j.userAvatar = require('../modules/campus/campusHelpers').resignAvatarUrl(j.userAvatar);
  return { ...j, likedByMe: likedIds ? likedIds.has(String(j.id)) : false, _legacyLiked: legacy };
};
const finish = (p, viewerId) => {
  const legacy = p._legacyLiked || [];
  delete p._legacyLiked;
  if (viewerId && legacy.includes(viewerId)) p.likedByMe = true;
  return p;
};

const likedSetFor = async (viewerId, postIds) => {
  const Like = getCommunityPostLikeModel();
  if (!viewerId || !Like || !postIds.length) return new Set();
  const rows = await Like.findAll({ where: { userId: viewerId, postId: { [Op.in]: postIds } }, attributes: ['postId'] });
  return new Set(rows.map((r) => String(r.postId)));
};

const withReplies = async (req, CommunityPost, rootRows, now) => {
  let roots = rootRows;
  const viewerId = optionalUserId(req);
  const rootIds = roots.map((p) => p.id);
  let allReplies = [];
  if (rootIds.length > 0) {
    try {
      allReplies = await CommunityPost.findAll({
        where: {
          parentId: { [Op.in]: rootIds },
          [Op.or]: [{ expiresAt: null }, { expiresAt: { [Op.gt]: now } }]
        },
        order: [['createdAt', 'ASC']]
      });
    } catch { /* parentId column missing, no replies */ }
  }
  // C2: moderated posts (hidden / pending review / removed) and, for a signed-in viewer, posts by people
  // blocked either way are left out (roots and replies).
  try {
    const ugc = require('../modules/friends/services/ugc');
    const hidden = await ugc.hiddenIds('community_post', [...rootIds, ...allReplies.map((r) => r.id)]);
    const blocked = viewerId ? await ugc.blockedIds(viewerId) : new Set();
    const keep = (p) => !hidden.has(String(p.id)) && !blocked.has(String(p.userId));
    if (hidden.size || blocked.size) {
      roots = roots.filter(keep);
      allReplies = allReplies.filter(keep);
    }
  } catch (err) {
    console.warn('[COMMUNITY_UGC_FILTER_WARN]', err.message);
  }
  const liked = await likedSetFor(viewerId, [...roots.map((p) => p.id), ...allReplies.map((r) => r.id)]);
  return roots.map((p) => {
    const pj = finish(shapePost(p, liked), viewerId);
    pj.replies = allReplies.filter((r) => r.parentId === pj.id).map((r) => finish(shapePost(r, liked), viewerId));
    return pj;
  });
};

// GET /api/community - Fetch root posts, then attach replies manually
router.get('/', async (req, res) => {
  try {
    const CommunityPost = getCommunityPostModel();
    if (!CommunityPost) return res.status(500).json({ message: 'DB disconnected.' });
    const now = new Date();

    let rootPosts;
    try {
      rootPosts = await CommunityPost.findAll({
        where: {
          parentId: null,
          [Op.or]: [
            { expiresAt: null },
            { expiresAt: { [Op.gt]: now } }
          ]
        },
        order: [['createdAt', 'DESC']],
        limit: 50
      });
    } catch {
      rootPosts = await CommunityPost.findAll({
        order: [['createdAt', 'DESC']],
        limit: 50
      });
      // S0: the fallback path applies the same moderation (hidden / pending review / removed) and block
      // filters as the normal path.
      const viewerId = optionalUserId(req);
      try {
        const ugc = require('../modules/friends/services/ugc');
        const hidden = await ugc.hiddenIds('community_post', rootPosts.map((p) => p.id));
        const blocked = viewerId ? await ugc.blockedIds(viewerId) : new Set();
        rootPosts = rootPosts.filter((p) => !hidden.has(String(p.id)) && !blocked.has(String(p.userId)));
      } catch (err) {
        console.warn('[COMMUNITY_UGC_FILTER_WARN]', err.message);
        return res.json([]); // fail closed: never show moderated posts because the filter failed
      }
      return res.json(rootPosts.map((p) => ({ ...finish(shapePost(p, null), viewerId), replies: [] })));
    }

    res.json(await withReplies(req, CommunityPost, rootPosts, now));
  } catch (error) {
    console.error('Fetch posts error:', error);
    res.status(500).json({ message: 'Failed to fetch community threads.' });
  }
});

// POST /api/community - Create a new post or reply
router.post('/', protect, async (req, res) => {
  try {
    const CommunityPost = getCommunityPostModel();
    if (!CommunityPost) return res.status(500).json({ message: 'DB disconnected.' });

    // Students (and admins) only (B15): rider / store tokens never post or review.
    const role = String(req.user.role || '').toLowerCase();
    if (role !== 'student' && role !== 'admin') {
      return res.status(403).json({ code: 'STUDENTS_ONLY', message: 'Only students can post here.' });
    }

    // The author is always the signed-in account (a client-sent authorName is ignored).
    const { content, imageUrl, starRating, restaurantId, productName } = req.body || {};
    let { parentId } = req.body || {};
    if (!content && !imageUrl) return res.status(400).json({ message: 'Content or image is required.' });

    // Field checks (community-n18 / n21)
    if (content !== undefined && content !== null && typeof content !== 'string') return res.status(400).json({ message: 'Post text must be text.' });
    if (typeof content === 'string' && content.trim().length > 500) return res.status(400).json({ code: 'CONTENT_TOO_LONG', message: 'Posts can be at most 500 characters.' });
    const tooLong = (v, n) => v !== undefined && v !== null && String(v).trim().length > n;
    if (tooLong(productName, 60)) return res.status(400).json({ message: 'Dish name can be at most 60 characters.' });

    // C2: sanctioned authors cannot post; slurs / threats are refused (422 CONTENT_BLOCKED), profanity masked.
    const ugc = require('../modules/friends/services/ugc');
    const guard = await ugc.postGuard(req.user.id);
    if (guard) return res.status(guard.status).json(guard.body);
    const textFilter = require('../utils/contentFilter').cleanFields({
      content: typeof content === 'string' ? content.trim() : content,
      productName: typeof productName === 'string' ? productName : productName,
    });
    if (textFilter.blocked) return require('../utils/contentFilter').rejectBlocked(res, textFilter.field);

    let parent = null;
    if (parentId !== undefined && parentId !== null && parentId !== '') {
      if (!isUuid(parentId)) return res.status(404).json({ message: 'Parent post not found.' });
      parent = await CommunityPost.findByPk(parentId);
      if (!parent) return res.status(404).json({ message: 'Parent post not found.' });
      // Threads are one level deep (B25): a reply to a reply joins the root thread.
      if (parent.parentId) {
        const root = await CommunityPost.findByPk(parent.parentId);
        if (!root) return res.status(404).json({ message: 'Parent post not found.' });
        parent = root;
      }
      parentId = parent.id;
    } else {
      parentId = null;
    }

    // A reply is always a plain post (B15): never a second star review under a thread.
    const isReview = !parentId && req.body && req.body.postType === 'review';
    let reviewStars = null;
    let review = null;
    if (isReview) {
      reviewStars = Number(starRating);
      if (!Number.isInteger(reviewStars) || reviewStars < 1 || reviewStars > 5) {
        return res.status(400).json({ code: 'INVALID_RATING', message: 'Pick a rating from 1 to 5 stars.' });
      }
      if (role !== 'student') return res.status(403).json({ code: 'STUDENTS_ONLY', message: 'Only students can review.' });
      // B15: a review is always about a real store (name from the database, never the client) and
      // one delivered order of mine from it that has no review yet.
      if (!isUuid(restaurantId)) return res.status(400).json({ code: 'REVIEW_NEEDS_STORE', message: 'Pick the place you are reviewing.' });
      const { getRestaurantModel } = require('../models/Restaurant');
      const store = await getRestaurantModel().findByPk(String(restaurantId), { attributes: ['id', 'name'] });
      if (!store) return res.status(404).json({ code: 'STORE_NOT_FOUND', message: 'That place is not on ZCS.' });
      const { getOrderModel } = require('../models/Order');
      const delivered = await getOrderModel().findAll({
        where: { userId: req.user.id, restaurantId: String(store.id), status: 'Delivered' },
        attributes: ['id'],
        order: [['createdAt', 'DESC']],
        limit: 100
      });
      if (!delivered.length) return res.status(403).json({ code: 'REVIEW_NEEDS_ORDER', message: 'You can review a place once an order from it has been delivered to you.' });
      const done = await CommunityPost.findAll({
        where: { userId: String(req.user.id), orderId: { [Op.in]: delivered.map((o) => String(o.id)) } },
        attributes: ['orderId']
      });
      const reviewed = new Set(done.map((d) => String(d.orderId)));
      const open = delivered.find((o) => !reviewed.has(String(o.id)));
      if (!open) return res.status(409).json({ code: 'ALREADY_REVIEWED', message: 'You have already reviewed each of your orders from this place.' });
      review = { store, orderId: String(open.id) };
    }

    // C2: per-user limits for posts and replies (reviews are already one per delivered order). DB counts.
    if (!isReview && role !== 'admin') {
      const limited = await ugc.checkRate('community_post', (since) => CommunityPost.count({
        where: { userId: String(req.user.id), createdAt: { [Op.gte]: since }, [Op.or]: [{ postType: null }, { postType: { [Op.ne]: 'review' } }] },
      }));
      if (limited) {
        res.set('Retry-After', String(limited.body.retryAfter));
        return res.status(limited.status).json(limited.body);
      }
    }

    // Photo: sniffed and stored in the media table; the post keeps only the short URL.
    let cleanImage = null;
    if (imageUrl) {
      const { storeImageRef, sendImageError } = require('../utils/imageStore');
      const img = await storeImageRef(imageUrl, { req, ownerId: req.user.id, purpose: 'post' });
      if (!img.ok) return sendImageError(res, img);
      cleanImage = img.value;
    }

    // Reviews don't expire; regular posts expire in 48h
    const expiresAt = isReview ? null : new Date(Date.now() + 48 * 60 * 60 * 1000);

    const { getUserModel: getAuthorModel } = require('../models/User');
    const author = await getAuthorModel().findByPk(req.user.id, { attributes: ['name', 'profileImage'] });

    let newPost;
    try {
      newPost = await CommunityPost.create({
        userId: req.user.id,
        userName: author?.name || req.user.name || 'ZCS member',
        // Inline base64 avatars are never copied into posts: the short avatar URL is used instead.
        userAvatar: author ? require('../modules/campus/campusHelpers').avatarUrlFor(req, { id: req.user.id, profileImage: author.profileImage }) : null,
        content: typeof textFilter.values.content === 'string' ? textFilter.values.content : '',
        imageUrl: cleanImage,
        parentId: parentId || null,
        likes: 0,
        likedBy: [],
        expiresAt,
        postType: isReview ? 'review' : 'post',
        starRating: isReview ? reviewStars : null,
        restaurantId: isReview ? String(review.store.id) : null,
        restaurantName: isReview ? review.store.name : null,
        productName: isReview ? (String(textFilter.values.productName || '').trim() || null) : null,
        orderId: isReview ? review.orderId : null
      });
    } catch (err) {
      if (err && err.name === 'SequelizeUniqueConstraintError') {
        return res.status(409).json({ code: 'ALREADY_REVIEWED', message: 'You have already reviewed this order.' });
      }
      throw err;
    }
    if (parentId) {
      await CommunityPost.update({ replyCount: literal('COALESCE("replyCount", 0) + 1') }, { where: { id: parentId } });
    }

    const out = finish(shapePost(newPost, null), null);
    const io = req.app.get('io');
    if (io) {
      // S0: every socket gets this, so only the public card fields the anonymous GET /api/community list
      // shows (no author account id, order id, store id, likers). The app upserts by id / parentId and
      // refetches the feed for the rest.
      const PUBLIC_POST_FIELDS = ['id', 'parentId', 'userName', 'userAvatar', 'content', 'imageUrl', 'likes', 'replyCount', 'postType', 'starRating', 'restaurantName', 'productName', 'expiresAt', 'createdAt', 'updatedAt'];
      const pub = { likedByMe: false };
      for (const k of PUBLIC_POST_FIELDS) if (out[k] !== undefined) pub[k] = out[k];
      io.emit('community_new_post', pub);
    }

    // Birthday pushes go out only for admin-approved celebrations (POST /api/birthdays/:id/approve),
    // never because a post contains "hbd" / "happy birthday".

    res.status(201).json(out);
  } catch (error) {
    console.error('Create post error:', error);
    res.status(500).json({ message: 'Failed to post to nexus.' });
  }
});

// GET /api/community/reviews - Fetch food reviews only
router.get('/reviews', async (req, res) => {
  try {
    const CommunityPost = getCommunityPostModel();
    if (!CommunityPost) return res.status(500).json({ message: 'DB disconnected.' });
    const now = new Date();

    let reviews;
    try {
      reviews = await CommunityPost.findAll({
        where: {
          postType: 'review',
          parentId: null,
          [Op.or]: [
            { expiresAt: null },
            { expiresAt: { [Op.gt]: now } }
          ]
        },
        order: [['createdAt', 'DESC']],
        limit: 50
      });
    } catch {
      // postType column may not exist yet or expiresAt fails
      try {
        reviews = await CommunityPost.findAll({
          where: { parentId: null },
          order: [['createdAt', 'DESC']],
          limit: 50
        });
      } catch {
        reviews = [];
      }
    }

    res.json(await withReplies(req, CommunityPost, reviews, now));
  } catch (error) {
    console.error('Fetch reviews error:', error);
    res.status(500).json({ message: 'Failed to fetch reviews.' });
  }
});


// DELETE /api/community/:id - Delete a post
router.delete('/:id', protect, async (req, res) => {
  try {
    const CommunityPost = getCommunityPostModel();
    if (!CommunityPost) return res.status(500).json({ message: 'DB disconnected.' });

    if (!isUuid(req.params.id)) return res.status(404).json({ message: 'Post not found.' });
    const post = await CommunityPost.findByPk(req.params.id);
    if (!post) return res.status(404).json({ message: 'Post not found.' });

    if (String(post.userId) !== String(req.user.id) && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized to delete this post.' });
    }

    if (post.parentId) {
      await CommunityPost.update(
        { replyCount: literal('CASE WHEN COALESCE("replyCount", 0) > 0 THEN "replyCount" - 1 ELSE 0 END') },
        { where: { id: post.parentId } }
      );
    }

    // Replies go with their thread, and so do the likes and photos (B14 / B19).
    const children = await CommunityPost.findAll({ where: { parentId: post.id }, attributes: ['id', 'imageUrl'] });
    const images = [post.imageUrl, ...children.map((c) => c.imageUrl)].filter(Boolean);
    const ids = [post.id, ...children.map((c) => c.id)];
    await CommunityPost.destroy({ where: { parentId: post.id } });
    const postId = post.id;
    const parentId = post.parentId;
    await post.destroy();
    const Like = getCommunityPostLikeModel();
    if (Like) await Like.destroy({ where: { postId: { [Op.in]: ids } } }).catch(() => 0);
    if (images.length) require('../utils/mediaCleanup').releaseMedia(images, 'post').catch(() => 0);

    const io = req.app.get('io');
    if (io) {
      io.emit('community_post_deleted', { id: postId, parentId });
    }

    res.json({ message: 'Post deleted successfully.' });
  } catch (error) {
    console.error('Delete post error:', error);
    res.status(500).json({ message: 'Failed to delete post.' });
  }
});

// PUT /api/community/:id/like - Like/unlike a post
// One CommunityPostLike row per (post, user) behind a unique index (B14): two taps / devices at
// once can no longer lose or double a like, and the list of likers is never sent to anyone.
router.put('/:id/like', protect, async (req, res) => {
  try {
    const CommunityPost = getCommunityPostModel();
    const Like = getCommunityPostLikeModel();
    if (!CommunityPost || !Like) return res.status(500).json({ message: 'DB disconnected.' });

    if (!isUuid(req.params.id)) return res.status(404).json({ message: 'Post not found' });
    const post = await CommunityPost.findByPk(req.params.id);
    if (!post) return res.status(404).json({ message: 'Post not found' });

    const userId = String(req.user.id);
    // Likes recorded before the like table existed live in the old likedBy list.
    const legacy = legacyLikers(post);
    const row = await Like.findOne({ where: { postId: post.id, userId } });
    let likedByMe;
    if (row || legacy.includes(userId)) {
      if (row) await row.destroy();
      if (legacy.includes(userId)) {
        post.likedBy = legacy.filter((id) => id !== userId);
        await post.save({ fields: ['likedBy'] });
      }
      likedByMe = false;
    } else {
      try {
        await Like.create({ postId: post.id, userId });
      } catch (err) {
        if (!(err && err.name === 'SequelizeUniqueConstraintError')) throw err;
      }
      likedByMe = true;
    }

    const fresh = await CommunityPost.findByPk(post.id);
    const likes = (await Like.count({ where: { postId: post.id } })) + legacyLikers(fresh).length;
    await CommunityPost.update({ likes }, { where: { id: post.id } });
    fresh.likes = likes;

    const io = req.app.get('io');
    if (io) {
      io.emit('community_post_liked', { id: post.id, likes });
    }

    const out = finish(shapePost(fresh, null), null);
    out.likedByMe = likedByMe;
    res.json(out);
  } catch (error) {
    console.error('Like post error:', error);
    res.status(500).json({ message: 'Failed to like post.' });
  }
});

module.exports = router;
