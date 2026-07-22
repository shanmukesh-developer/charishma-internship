const express = require('express');
const router = express.Router();
const { getCommunityPostModel } = require('../models/CommunityPost');
const { protect } = require('../middleware/authMiddleware');

// GET /api/community - Fetch root posts, then attach replies manually
router.get('/', async (req, res) => {
  try {
    const CommunityPost = getCommunityPostModel();
    if (!CommunityPost) return res.status(500).json({ message: 'DB disconnected.' });

    const { Op } = require('sequelize');
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
      return res.json(rootPosts.map(p => ({ ...p.toJSON(), replies: [] })));
    }

    const rootIds = rootPosts.map(p => p.id);
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

    const postsJSON = rootPosts.map(p => {
      const pj = p.toJSON();
      pj.replies = allReplies.filter(r => r.parentId === pj.id).map(r => r.toJSON());
      return pj;
    });

    res.json(postsJSON);
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

    const { content, parentId, imageUrl, authorName, postType, starRating, restaurantId, restaurantName, productName } = req.body;
    if (!content && !imageUrl) return res.status(400).json({ message: 'Content or image is required.' });

    if (parentId) {
      const parent = await CommunityPost.findByPk(parentId);
      if (!parent) return res.status(404).json({ message: 'Parent post not found.' });
      parent.replyCount = (parent.replyCount || 0) + 1;
      await parent.save();
    }

    // Reviews don't expire; regular posts expire in 48h
    const isReview = postType === 'review';
    const expiresAt = isReview ? null : new Date(Date.now() + 48 * 60 * 60 * 1000);

    const newPost = await CommunityPost.create({
      userId: req.user.id,
      userName: authorName || req.user.name || 'Anonymous Operative',
      userAvatar: req.user.profileImage || null,
      content: content || '',
      imageUrl: imageUrl || null,
      parentId: parentId || null,
      likes: 0,
      likedBy: [],
      expiresAt,
      postType: postType || 'post',
      starRating: isReview ? (starRating || null) : null,
      restaurantId: isReview ? (restaurantId || null) : null,
      restaurantName: isReview ? (restaurantName || null) : null,
      productName: isReview ? (productName || null) : null
    });

    const io = req.app.get('io');
    if (io) {
      io.emit('community_new_post', newPost);
    }

    // --- BIRTHDAY BROADCAST LOGIC ---
    // If the post is explicitly marked as a birthday or contains birthday keywords,
    // we trigger an automatic specially themed broadcast to all users!
    const isBirthdayPost = postType === 'birthday' || 
      (content && (content.toLowerCase().includes('happy birthday') || content.toLowerCase().includes('hbd')));
      
    if (isBirthdayPost) {
      const { getUserModel } = require('../models/User');
      const User = getUserModel();
      const activeUsers = await User.findAll({ where: { isActive: true } });
      
      let allTokens = [];
      activeUsers.forEach(user => {
        if (user.fcmTokens) {
          let tokenList = user.fcmTokens;
          if (typeof tokenList === 'string') {
            try { tokenList = JSON.parse(tokenList); } catch { tokenList = [tokenList]; }
          }
          if (Array.isArray(tokenList)) {
            tokenList.forEach(t => {
              const tokenStr = typeof t === 'string' ? t : t?.token;
              if (tokenStr) allTokens.push(tokenStr);
            });
          }
        }
      });
      allTokens = [...new Set(allTokens.filter(Boolean))];

      if (allTokens.length > 0) {
        const { sendPushToTokens } = require('../utils/push');
        
        await sendPushToTokens(
          allTokens,
          `🎉 🎂 Birthday Alert! 🎂 🎉`,
          `Someone just posted a birthday wish for ${newPost.userName} in the community! Join the celebration! ✨`,
          {
            type: 'BIRTHDAY_ALERT',
            postId: String(newPost.id),
            theme: 'birthday_party_special'
          },
          {
            android: {
              notification: {
                color: '#FF1493',
                sound: 'default'
              }
            }
          }
        ).catch(e => console.error('Birthday push broadcast error:', e));
      }
    }

    res.status(201).json(newPost);
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

    const { Op } = require('sequelize');
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

    const reviewIds = reviews.map(p => p.id);
    let allReplies = [];
    if (reviewIds.length > 0) {
      try {
        allReplies = await CommunityPost.findAll({
          where: {
            parentId: { [Op.in]: reviewIds },
            [Op.or]: [{ expiresAt: null }, { expiresAt: { [Op.gt]: now } }]
          },
          order: [['createdAt', 'ASC']]
        });
      } catch { /* parentId column missing, no replies */ }
    }

    const reviewsJSON = reviews.map(p => {
      const pj = p.toJSON();
      pj.replies = allReplies.filter(r => r.parentId === pj.id).map(r => r.toJSON());
      return pj;
    });

    res.json(reviewsJSON);
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

    const post = await CommunityPost.findByPk(req.params.id);
    if (!post) return res.status(404).json({ message: 'Post not found.' });

    if (String(post.userId) !== String(req.user.id) && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized to delete this post.' });
    }

    if (post.parentId) {
      const parent = await CommunityPost.findByPk(post.parentId);
      if (parent) {
        parent.replyCount = Math.max((parent.replyCount || 1) - 1, 0);
        await parent.save();
      }
    }

    // Optional: Destroy children replies
    await CommunityPost.destroy({ where: { parentId: post.id } });
    const postId = post.id;
    const parentId = post.parentId;
    await post.destroy();

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
router.put('/:id/like', protect, async (req, res) => {
  try {
    const CommunityPost = getCommunityPostModel();
    if (!CommunityPost) return res.status(500).json({ message: 'DB disconnected.' });

    const post = await CommunityPost.findByPk(req.params.id);
    if (!post) return res.status(404).json({ message: 'Post not found' });

    let likedBy = post.likedBy || [];
    const userId = String(req.user.id);
    
    if (likedBy.includes(userId)) {
      likedBy = likedBy.filter(id => id !== userId);
      post.likes = Math.max(0, post.likes - 1);
    } else {
      likedBy.push(userId);
      post.likes += 1;
    }
    
    post.likedBy = likedBy;
    await post.save();

    const io = req.app.get('io');
    if (io) {
      io.emit('community_post_liked', { id: post.id, likes: post.likes, likedBy: post.likedBy });
    }

    res.json(post);
  } catch (error) {
    console.error('Like post error:', error);
    res.status(500).json({ message: 'Failed to like post.' });
  }
});

module.exports = router;
