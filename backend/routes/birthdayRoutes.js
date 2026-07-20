const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');

const { getBirthdayCelebrationModel } = require('../models/BirthdayCelebration');
const { getBirthdayWishModel } = require('../models/BirthdayWish');
const { getCommunityPostModel } = require('../models/CommunityPost');
const { protect, admin } = require('../middleware/authMiddleware');
const { sendPushToTopic, sendPushToTokens } = require('../utils/push');

// Helper: Store photo directly in the database as base64 data URI.
// Render's filesystem is ephemeral — files in /uploads/ are lost on restart.
// Storing in the DB column (TEXT type) ensures persistence across deploys.
function processPhoto(base64Payload) {
  if (!base64Payload) return null;
  // If it's already a data URI or regular URL, keep it as-is
  if (base64Payload.startsWith('data:image') || base64Payload.startsWith('http')) {
    return base64Payload;
  }
  return null;
}

// POST /api/birthdays - Submit birthday celebration request
router.post('/', protect, async (req, res) => {
  try {
    const BirthdayCelebration = getBirthdayCelebrationModel();
    if (!BirthdayCelebration) return res.status(500).json({ message: 'Database model not initialized.' });

    const { candidateName, candidatePhoto, birthdayDate } = req.body;
    if (!candidateName || !birthdayDate) {
      return res.status(400).json({ message: 'Candidate name and date are required.' });
    }

    // Store photo as base64 data URI directly in database (survives server restarts)
    const candidatePhotoUrl = processPhoto(candidatePhoto);

    // Create pending celebration
    const celebration = await BirthdayCelebration.create({
      userId: req.user.id,
      candidateName,
      candidatePhotoUrl,
      birthdayDate,
      status: 'pending',
      wishCount: 0
    });

    res.status(201).json(celebration);
  } catch (err) {
    console.error('Error submitting birthday request:', err);
    res.status(500).json({ message: 'Failed to submit birthday celebration.' });
  }
});

// GET /api/birthdays/active - Fetch active, approved celebrations (expiresAt > now)
router.get('/active', async (req, res) => {
  try {
    const BirthdayCelebration = getBirthdayCelebrationModel();
    if (!BirthdayCelebration) return res.status(500).json({ message: 'Database model not initialized.' });

    const now = new Date();
    const activeCelebrations = await BirthdayCelebration.findAll({
      where: {
        status: 'approved',
        expiresAt: {
          [Op.gt]: now
        }
      },
      order: [['approvedAt', 'DESC']]
    });

    res.json(activeCelebrations);
  } catch (err) {
    console.error('Error fetching active birthdays:', err);
    res.status(500).json({ message: 'Failed to fetch active birthdays.' });
  }
});

// GET /api/birthdays/pending - Fetch pending submissions (Admin only)
router.get('/pending', protect, admin, async (req, res) => {
  try {
    const BirthdayCelebration = getBirthdayCelebrationModel();
    const pending = await BirthdayCelebration.findAll({
      where: { status: 'pending' },
      order: [['createdAt', 'ASC']]
    });
    res.json(pending);
  } catch (err) {
    console.error('Error fetching pending birthdays:', err);
    res.status(500).json({ message: 'Failed to fetch pending requests.' });
  }
});

// PUT /api/birthdays/:id/approve - Approve a birthday request (Admin only)
router.put('/:id/approve', protect, admin, async (req, res) => {
  try {
    const BirthdayCelebration = getBirthdayCelebrationModel();
    if (!BirthdayCelebration) return res.status(500).json({ message: 'Database model not initialized.' });

    const celebration = await BirthdayCelebration.findByPk(req.params.id);
    if (!celebration) return res.status(404).json({ message: 'Celebration not found.' });

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // exactly 24 hours

    await celebration.update({
      status: 'approved',
      approvedBy: req.user.id,
      approvedAt: now,
      expiresAt: expiresAt
    });

    // Broadcast push notification to all active users' FCM tokens
    try {
      const { getUserModel } = require('../models/User');
      const User = getUserModel();
      if (User) {
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
          await sendPushToTokens(
            allTokens,
            `🎉 Celebrate ${celebration.candidateName}'s Birthday! 🎂`,
            `Tap here to wish them and join the campus celebration! 🎁✨`,
            {
              type: 'BIRTHDAY_ALERT',
              celebrationId: String(celebration.id),
              candidateName: celebration.candidateName
            }
          );
        }
      }
    } catch (pushErr) {
      console.error('Failed to send birthday push to user tokens:', pushErr);
    }

    // Fire FCM topic notification as fallback/topic broadcast
    try {
      await sendPushToTopic(
        'birthdays',
        `🎉 Celebrate ${celebration.candidateName}'s Birthday! 🎂`,
        `Tap here to wish them and join the campus celebration! 🎁✨`,
        {
          type: 'BIRTHDAY_ALERT',
          celebrationId: String(celebration.id),
          candidateName: celebration.candidateName
        }
      );
    } catch (topicErr) {
      console.error('Failed to send birthday push to topic:', topicErr);
    }

    // Broadcast via Socket.io so active users get live toast & save to notification history
    try {
      const io = req.app.get('io');
      if (io) {
        io.emit('global_announcement', {
          message: `🎉 Celebrate ${celebration.candidateName}'s Birthday! 🎂 Tap here to wish them and join the campus celebration! 🎁✨`,
          type: 'promo'
        });
      }
    } catch (sockErr) {
      console.error('Failed to emit birthday socket announcement:', sockErr);
    }

    res.json({ message: 'Birthday approved successfully.', celebration });
  } catch (err) {
    console.error('Error approving birthday:', err);
    res.status(500).json({ message: 'Failed to approve birthday.' });
  }
});

// PUT /api/birthdays/:id/reject - Reject a birthday request (Admin only)
router.put('/:id/reject', protect, admin, async (req, res) => {
  try {
    const BirthdayCelebration = getBirthdayCelebrationModel();
    if (!BirthdayCelebration) return res.status(500).json({ message: 'Database model not initialized.' });

    const celebration = await BirthdayCelebration.findByPk(req.params.id);
    if (!celebration) return res.status(404).json({ message: 'Celebration not found.' });

    await celebration.update({
      status: 'rejected'
    });

    res.json({ message: 'Birthday request rejected.', celebration });
  } catch (err) {
    console.error('Error rejecting birthday:', err);
    res.status(500).json({ message: 'Failed to reject request.' });
  }
});

// POST /api/birthdays/:id/wish - Send a birthday wish (User only)
router.post('/:id/wish', protect, async (req, res) => {
  try {
    const BirthdayCelebration = getBirthdayCelebrationModel();
    const BirthdayWish = getBirthdayWishModel();
    const CommunityPost = getCommunityPostModel();

    if (!BirthdayCelebration || !BirthdayWish) {
      return res.status(500).json({ message: 'Database models not initialized.' });
    }

    const celebration = await BirthdayCelebration.findByPk(req.params.id);
    if (!celebration) return res.status(404).json({ message: 'Birthday celebration not found.' });

    // Check if expired
    if (celebration.status === 'expired' || (celebration.expiresAt && new Date(celebration.expiresAt) < new Date())) {
      return res.status(400).json({ message: 'This birthday celebration has expired.' });
    }

    const { message } = req.body;

    // Create unique wish constraint check
    try {
      await BirthdayWish.create({
        celebrationId: celebration.id,
        userId: req.user.id,
        userName: req.user.name || 'Anonymous Peer',
        message: message || ''
      });
    } catch (dbErr) {
      // SequelizeUniqueConstraintError
      return res.status(400).json({ message: 'You have already wished this candidate! ❤️' });
    }

    // Increment wishCount
    celebration.wishCount = (celebration.wishCount || 0) + 1;
    await celebration.save();

    // Automatically post a notice on the community wall feed
    if (CommunityPost) {
      try {
        await CommunityPost.create({
          userId: 'system',
          userName: 'ZENVY CELEBRATIONS 🎂',
          content: `${req.user.name || 'A student'} sent a birthday wish to ${celebration.candidateName}! 🎉 "${message || 'Happy Birthday!'}"`,
          postType: 'post',
          expiresAt: celebration.expiresAt // match the celebration expiry
        });
      } catch (postErr) {
        console.error('Failed to post system wish message to community:', postErr);
      }
    }

    res.json({ message: 'Wish sent successfully!', wishCount: celebration.wishCount });
  } catch (err) {
    console.error('Error wishing candidate:', err);
    res.status(500).json({ message: 'Failed to send wish.' });
  }
});

// GET /api/birthdays/:id/wishes - Fetch wishes for a celebration
router.get('/:id/wishes', async (req, res) => {
  try {
    const BirthdayWish = getBirthdayWishModel();
    if (!BirthdayWish) return res.status(500).json({ message: 'Database model not initialized.' });

    const wishes = await BirthdayWish.findAll({
      where: { celebrationId: req.params.id },
      order: [['createdAt', 'DESC']]
    });

    res.json(wishes);
  } catch (err) {
    console.error('Error fetching wishes:', err);
    res.status(500).json({ message: 'Failed to fetch wishes.' });
  }
});

module.exports = router;
