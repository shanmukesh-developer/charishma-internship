const express = require('express');
const router = express.Router();
const realtime = require('../utils/realtime');
const { Op } = require('sequelize');
const { getWallEventModel } = require('../models/WallEvent');
const { getWallSubmissionModel } = require('../models/WallSubmission');
const { getWallLikeModel } = require('../models/WallLike');
const { getUserModel } = require('../models/User');
const { protect, admin } = require('../middleware/authMiddleware');
const { sendPushToTopic } = require('../utils/push');

// Optional auth for public Wall endpoints: returns the decoded JWT ({ id, role }) or null.
const optionalUser = (req) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  try {
    const jwt = require('jsonwebtoken');
    const token = authHeader.split(' ')[1].replace(/['"]+/g, '').trim();
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return decoded && decoded.id ? decoded : null;
  } catch {
    return null;
  }
};
const isAdminUser = (u) => !!u && String(u.role || '').toLowerCase() === 'admin';
// Same as optionalUser, but the role comes from the live account (never the token claim).
const optionalViewer = async (req) => {
  const decoded = optionalUser(req);
  if (!decoded) return null;
  const { isLiveAdminRequest } = require('../middleware/authMiddleware');
  return { id: decoded.id, role: (await isLiveAdminRequest(req)) ? 'admin' : 'student' };
};

// A contest is open only while it is ACTIVE and its end time has not passed (the cron that
// finalizes it runs every 5 minutes, so the end time is checked here too).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => UUID_RE.test(String(v || ''));
const releaseWallMedia = (values) => require('../utils/mediaCleanup').releaseMedia(values, 'wall').catch(() => 0);
const isEventOpen = (event) => !!event && event.status === 'ACTIVE' && new Date(event.endTime).getTime() > Date.now();

// The event coupon code is the winner's personal reward code: only admins see it.
const publicEvent = (event, viewer) => {
  if (!event) return null;
  const json = typeof event.toJSON === 'function' ? event.toJSON() : { ...event };
  if (!isAdminUser(viewer)) delete json.couponCode;
  return json;
};

// Simple in-memory rate limiting for /like endpoint per user (max 30 per min)
const likeRateLimitMap = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, list] of likeRateLimitMap) if (!list.length || now - list[list.length - 1] >= 60000) likeRateLimitMap.delete(k);
}, 5 * 60 * 1000).unref?.();
const checkLikeRateLimit = (userId) => {
  const now = Date.now();
  const userLogs = likeRateLimitMap.get(userId) || [];
  const recentLogs = userLogs.filter(ts => now - ts < 60000);
  if (recentLogs.length >= 30) return false;
  recentLogs.push(now);
  likeRateLimitMap.set(userId, recentLogs);
  return true;
};

// ── ADMIN: Create Wall Event ──
// POST /api/wall/events
router.post('/events', protect, admin, async (req, res) => {
  try {
    const WallEvent = getWallEventModel();
    if (!WallEvent) return res.status(500).json({ message: 'WallEvent model not initialized.' });

    const { title, description, startTime, endTime, couponValue, couponCode, bannerText, bannerGradient } = req.body;
    if (!title || !startTime || !endTime) {
      return res.status(400).json({ message: 'Title, startTime, and endTime are required.' });
    }
    // Same checks as the admin form (the server is the last line): real times, the end after the start and still
    // ahead, and a prize of ₹1 to ₹1000 (a typo used to become a coupon of any size for the winner).
    const start = new Date(startTime);
    const end = new Date(endTime);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return res.status(400).json({ message: 'Enter valid start and end times.' });
    if (end <= start) return res.status(400).json({ message: 'The end time must be after the start time.' });
    if (end <= new Date()) return res.status(400).json({ message: 'The end time must be in the future.' });
    const { WALL_PRIZE_MAX, wallPrizeValue } = require('../cron/wallCron');
    const prize = couponValue === undefined || couponValue === null || couponValue === '' ? 100 : wallPrizeValue(couponValue);
    if (prize === null) return res.status(400).json({ message: `Prize value must be a whole number from ₹1 to ₹${WALL_PRIZE_MAX}.` });

    const event = await WallEvent.create({
      title,
      description: description || '',
      startTime: start,
      endTime: end,
      status: 'ACTIVE',
      couponCode: couponCode || null,
      couponValue: prize,
      bannerText: bannerText || '🔥 LIVE PHOTO CONTEST: Vote for your favourite photos & win instant discount coupons! 📸✨',
      bannerGradient: bannerGradient || 'fire'
    });

    // Notify all users about new Wall Event
    try {
      await sendPushToTopic('all_users', '📸 The Wall Photo Contest is LIVE!', `Submit your photo for "${title}" & win a ₹${event.couponValue} coupon!`, {
        type: 'WALL_EVENT_STARTED',
        eventId: event.id
      });
    } catch (e) {
      console.error('[WALL_PUSH_ERR]', e);
    }

    realtime.publish('wall', 'created', event.id, { scope: 'event' });
    res.status(201).json(event);
  } catch (err) {
    console.error('Error creating Wall event:', err);
    res.status(500).json({ message: 'Failed to create Wall event.' });
  }
});

// ── ADMIN: Update Wall Event & Moving Banner ──
// PUT /api/wall/events/:id
router.put('/events/:id', protect, admin, async (req, res) => {
  try {
    const WallEvent = getWallEventModel();
    if (!WallEvent) return res.status(500).json({ message: 'WallEvent model not initialized.' });

    const event = await WallEvent.findByPk(req.params.id);
    if (!event) return res.status(404).json({ message: 'Event not found.' });

    const { title, description, bannerText, bannerGradient, couponValue, couponCode, endTime } = req.body;
    if (title !== undefined) event.title = title;
    if (description !== undefined) event.description = description;
    if (bannerText !== undefined) event.bannerText = bannerText;
    if (bannerGradient !== undefined) event.bannerGradient = bannerGradient;
    if (couponValue !== undefined) {
      const { WALL_PRIZE_MAX, wallPrizeValue } = require('../cron/wallCron');
      const prize = wallPrizeValue(couponValue);
      if (prize === null) return res.status(400).json({ message: `Prize value must be a whole number from ₹1 to ₹${WALL_PRIZE_MAX}.` });
      event.couponValue = prize;
    }
    if (couponCode !== undefined) event.couponCode = couponCode;
    if (endTime !== undefined) {
      const end = new Date(endTime);
      if (Number.isNaN(end.getTime())) return res.status(400).json({ message: 'Enter a valid end time.' });
      if (end <= new Date(event.startTime)) return res.status(400).json({ message: 'The end time must be after the start time.' });
      event.endTime = end;
    }

    await event.save();
    realtime.publish('wall', 'updated', event.id, { scope: 'event' });
    res.json({ message: 'Event and moving banner updated successfully!', event });
  } catch (err) {
    console.error('Error updating Wall event:', err);
    res.status(500).json({ message: 'Failed to update Wall event.' });
  }
});

// ── GET Active Wall Event & Submissions ──
// GET /api/wall/events/active
router.get('/events/active', async (req, res) => {
  try {
    const WallEvent = getWallEventModel();
    const WallSubmission = getWallSubmissionModel();
    const WallLike = getWallLikeModel();
    const User = getUserModel();

    if (!WallEvent || !WallSubmission) return res.status(500).json({ message: 'Models not initialized.' });

    const now = new Date();
    let activeEvent = await WallEvent.findOne({
      where: {
        status: 'ACTIVE',
        endTime: { [Op.gt]: now }
      },
      order: [['createdAt', 'DESC']]
    });

    // No contest running: the app shows its empty state. Contests are created by admins
    // (POST /api/wall/events); the server never invents one.
    if (!activeEvent) {
      return res.json({ activeEvent: null, submissions: [], userLikedSubmissionIds: [], userSubmission: null });
    }

    // Fetch approved submissions sorted by likeCount DESC
    const submissions = await WallSubmission.findAll({
      where: {
        eventId: activeEvent.id,
        isApproved: true
      },
      order: [['likeCount', 'DESC'], ['createdAt', 'ASC']],
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'name', 'profileImage']
        }
      ]
    });

    // Extract current user's liked submission IDs if token provided
    let userLikedSubmissionIds = [];
    let userSubmission = null;
    const viewer = await optionalViewer(req);
    if (viewer) {
      try {
        const decoded = viewer;
        {
          const userLikes = await WallLike.findAll({
            where: { userId: decoded.id },
            attributes: ['submissionId']
          });
          userLikedSubmissionIds = userLikes.map(l => l.submissionId);

          userSubmission = await WallSubmission.findOne({
            where: { eventId: activeEvent.id, userId: decoded.id }
          });
        }
      } catch (authErr) {
        // Continue unauthenticated if token invalid
      }
    }

    res.json({
      activeEvent: publicEvent(activeEvent, viewer),
      submissions,
      userLikedSubmissionIds,
      userSubmission
    });
  } catch (err) {
    console.error('Error fetching active Wall event:', err);
    res.status(500).json({ message: 'Failed to fetch active Wall event.' });
  }
});

// ── GET Hall of Fame / Past Contests ──
// GET /api/wall/events/history
router.get('/events/history', async (req, res) => {
  try {
    const WallEvent = getWallEventModel();
    const WallSubmission = getWallSubmissionModel();
    const User = getUserModel();
    if (!WallEvent || !WallSubmission) return res.status(500).json({ message: 'Models not initialized.' });

    const viewer = await optionalViewer(req);
    const pastEvents = await WallEvent.findAll({
      where: { status: 'ENDED' },
      order: [['endTime', 'DESC']],
      limit: 10
    });

    const results = [];
    for (const evt of pastEvents) {
      let winningSubmission = null;
      if (evt.winnerUserId) {
        winningSubmission = await WallSubmission.findOne({
          where: { eventId: evt.id, userId: evt.winnerUserId },
          include: [{ model: User, as: 'user', attributes: ['id', 'name', 'profileImage'] }]
        });
      }
      if (!winningSubmission) {
        winningSubmission = await WallSubmission.findOne({
          where: { eventId: evt.id, isApproved: true },
          order: [['likeCount', 'DESC']],
          include: [{ model: User, as: 'user', attributes: ['id', 'name', 'profileImage'] }]
        });
      }

      results.push({
        event: publicEvent(evt, viewer),
        winningSubmission,
        winner: winningSubmission?.user || null
      });
    }

    res.json(results);
  } catch (err) {
    console.error('Error fetching Wall history:', err);
    res.status(500).json({ message: 'Failed to fetch Wall history.' });
  }
});

// ── POST Submit Photo to Active Wall Event ──
// POST /api/wall/events/:id/submit
router.post('/events/:id/submit', protect, async (req, res) => {
  try {
    const WallEvent = getWallEventModel();
    const WallSubmission = getWallSubmissionModel();
    if (!WallEvent || !WallSubmission) return res.status(500).json({ message: 'Models not initialized.' });

    let eventId = req.params.id;
    const { imageUrl: rawImage } = req.body || {};

    if (!rawImage || typeof rawImage !== 'string') {
      return res.status(400).json({ message: 'Image payload is required.' });
    }
    // Sniffed and stored in the media table (max 4 MB); the submission keeps the short URL.
    const { storeImageRef } = require('../utils/imageStore');
    const img = await storeImageRef(rawImage, { req, ownerId: req.user.id, purpose: 'wall', maxBytes: 4 * 1024 * 1024 });
    if (!img.ok || !img.value) {
      return res.status(img.status || 400).json({ code: img.code === 'FILE_TOO_LARGE' ? 'IMAGE_TOO_LARGE' : img.code, message: img.ok ? 'Please pick a photo from your gallery or camera.' : img.message });
    }
    const imageUrl = img.value;

    let event = UUID_RE.test(String(eventId || '')) ? await WallEvent.findByPk(eventId) : null;
    if (!event) {
      event = await WallEvent.findOne({
        where: { status: 'ACTIVE', endTime: { [Op.gt]: new Date() } },
        order: [['createdAt', 'DESC']]
      });
    }

    if (!isEventOpen(event)) {
      return res.status(400).json({ code: 'CONTEST_CLOSED', message: 'There is no photo contest running right now. Check back soon!' });
    }

    eventId = event.id;

    // If user already submitted, gracefully update their entry
    const existing = await WallSubmission.findOne({
      where: { eventId, userId: req.user.id }
    });

    if (existing) {
      // Votes belong to the photo people voted for, so a voted photo cannot be swapped.
      if ((existing.likeCount || 0) > 0) {
        return res.status(400).json({
          code: 'SUBMISSION_HAS_VOTES',
          message: "Your photo already has votes, so it can't be replaced in this contest."
        });
      }
      const replacedImage = existing.imageUrl;
      existing.imageUrl = imageUrl;
      existing.isApproved = false;
      await existing.save();
      if (replacedImage && replacedImage !== imageUrl) releaseWallMedia([replacedImage]); // B19
      realtime.notifyAdmin('wall_submission', 'updated', existing.id);
      realtime.publish('wall', 'updated', eventId, { scope: 'submissions' }); // it left the public wall until re-approved
      return res.status(200).json({
        message: 'Photo updated! It will appear on The Wall once our team approves it.',
        submission: existing
      });
    }

    // Every photo is reviewed by an admin (GET /api/wall/admin/pending) before it goes live.
    const submission = await WallSubmission.create({
      eventId,
      userId: req.user.id,
      imageUrl,
      likeCount: 0,
      isApproved: false
    });

    realtime.notifyAdmin('wall_submission', 'created', submission.id);
    res.status(201).json({
      message: 'Photo submitted! It will appear on The Wall once our team approves it.',
      submission
    });
  } catch (err) {
    console.error('Error submitting Wall photo:', err);
    res.status(500).json({ message: 'Failed to submit photo to Wall.' });
  }
});

// ── POST Toggle Like on Wall Submission ──
// POST /api/wall/submissions/:id/like
router.post('/submissions/:id/like', protect, async (req, res) => {
  try {
    const WallSubmission = getWallSubmissionModel();
    const WallLike = getWallLikeModel();
    const WallEvent = getWallEventModel();

    if (!WallSubmission || !WallLike) return res.status(500).json({ message: 'Models not initialized.' });

    // Rate limit check
    if (!checkLikeRateLimit(req.user.id)) {
      return res.status(429).json({ message: 'Too many vote actions! Please slow down.' });
    }

    const submissionId = req.params.id;
    if (!isUuid(submissionId)) return res.status(404).json({ message: 'Submission not found.' });
    // Votes are for students (B18): rider / store / admin tokens never vote.
    if (String(req.user.role || '').toLowerCase() !== 'student') {
      return res.status(403).json({ code: 'STUDENTS_ONLY', message: 'Only students can vote on The Wall.' });
    }
    const submission = await WallSubmission.findByPk(submissionId, {
      include: [{ model: WallEvent, as: 'event' }]
    });

    if (!submission) return res.status(404).json({ message: 'Submission not found.' });
    if (String(submission.userId) === String(req.user.id)) {
      return res.status(400).json({ code: 'OWN_SUBMISSION', message: 'You cannot vote for your own photo.' });
    }

    if (!isEventOpen(submission.event)) {
      return res.status(400).json({ code: 'CONTEST_CLOSED', message: 'Voting has closed for this contest.' });
    }
    if (!submission.isApproved) {
      return res.status(404).json({ message: 'Submission not found.' });
    }

    // Toggle like
    const existingLike = await WallLike.findOne({
      where: { submissionId, userId: req.user.id }
    });

    let liked = false;
    if (existingLike) {
      await existingLike.destroy();
      liked = false;
    } else {
      try {
        await WallLike.create({ submissionId, userId: req.user.id });
      } catch (dupErr) {
        // A double tap raced us to the same vote: it is already counted.
        if (!(dupErr && dupErr.name === 'SequelizeUniqueConstraintError')) throw dupErr;
      }
      liked = true;
    }
    // The count is recomputed from the real votes (no lost or double votes when many people
    // vote at the same moment, which a read-modify-save of likeCount would cause).
    // One UPDATE with the count as a subquery (B18): a separate count-then-write let two
    // overlapping toggles store a stale number.
    const sq = WallSubmission.sequelize;
    await sq.query(
      'UPDATE "WallSubmissions" SET "likeCount" = (SELECT COUNT(*) FROM "WallLikes" WHERE "WallLikes"."submissionId" = :id) WHERE "id" = :id',
      { replacements: { id: submissionId } }
    );
    const fresh = await WallSubmission.findByPk(submissionId, { attributes: ['id', 'likeCount'] });
    submission.likeCount = fresh ? Number(fresh.likeCount) || 0 : 0;

    res.json({
      liked,
      likeCount: submission.likeCount
    });
  } catch (err) {
    console.error('Error toggling Wall like:', err);
    res.status(500).json({ message: 'Failed to toggle vote.' });
  }
});

// ── GET Wall Leaderboard ──
// GET /api/wall/events/:id/leaderboard
router.get('/events/:id/leaderboard', async (req, res) => {
  try {
    const WallSubmission = getWallSubmissionModel();
    const User = getUserModel();

    if (!isUuid(req.params.id)) return res.status(404).json({ message: 'Event not found.' });
    const submissions = await WallSubmission.findAll({
      where: { eventId: req.params.id, isApproved: true },
      order: [['likeCount', 'DESC'], ['createdAt', 'ASC']],
      include: [{ model: User, as: 'user', attributes: ['id', 'name', 'profileImage'] }]
    });

    res.json(submissions);
  } catch (err) {
    console.error('Error fetching leaderboard:', err);
    res.status(500).json({ message: 'Failed to fetch leaderboard.' });
  }
});

// ── ADMIN: End Wall Event Manually ──
// PUT /api/wall/events/:id/end
router.put('/events/:id/end', protect, admin, async (req, res) => {
  try {
    const WallEvent = getWallEventModel();
    const WallSubmission = getWallSubmissionModel();
    const User = getUserModel();
    if (!WallEvent || !WallSubmission) return res.status(500).json({ message: 'Models not initialized.' });

    const event = isUuid(req.params.id) ? await WallEvent.findByPk(req.params.id) : null;
    if (!event) return res.status(404).json({ message: 'Event not found.' });
    if (event.status === 'ENDED') return res.status(400).json({ message: 'Event is already ended.' });

    // End it now and finalize exactly like the scheduled job does (winner, coupon, pushes).
    event.endTime = new Date(Date.now() - 1000);
    await event.save();
    const { processExpiredWallEvents } = require('../cron/wallCron');
    await processExpiredWallEvents();
    await event.reload();
    realtime.publish('wall', 'updated', event.id, { scope: 'event' });

    const topSubmission = event.winnerUserId
      ? await WallSubmission.findOne({
        where: { eventId: event.id, userId: event.winnerUserId },
        include: [{ model: User, as: 'user', attributes: ['id', 'name', 'profileImage'] }]
      })
      : null;

    res.json({
      message: 'Event ended successfully!',
      event,
      winner: topSubmission ? topSubmission.user : null,
      winningSubmission: topSubmission
    });
  } catch (err) {
    console.error('Error ending Wall event:', err);
    res.status(500).json({ message: 'Failed to end event.' });
  }
});

// ── ADMIN: Get All Wall Events (for management) ──
// GET /api/wall/admin/events
router.get('/admin/events', protect, admin, async (req, res) => {
  try {
    const WallEvent = getWallEventModel();
    const WallSubmission = getWallSubmissionModel();
    if (!WallEvent) return res.status(500).json({ message: 'Models not initialized.' });

    const events = await WallEvent.findAll({
      order: [['createdAt', 'DESC']],
      limit: 50
    });

    // Attach submission counts
    const enriched = [];
    for (const evt of events) {
      const totalSubmissions = await WallSubmission.count({ where: { eventId: evt.id } });
      const approvedSubmissions = await WallSubmission.count({ where: { eventId: evt.id, isApproved: true } });
      const pendingSubmissions = await WallSubmission.count({ where: { eventId: evt.id, isApproved: false } });
      enriched.push({
        ...evt.toJSON(),
        totalSubmissions,
        approvedSubmissions,
        pendingSubmissions
      });
    }

    res.json(enriched);
  } catch (err) {
    console.error('Error fetching admin events:', err);
    res.status(500).json({ message: 'Failed to fetch events.' });
  }
});

// ── ADMIN: Get Pending Submissions Moderation Queue ──
// GET /api/wall/admin/pending
router.get('/admin/pending', protect, admin, async (req, res) => {
  try {
    const WallSubmission = getWallSubmissionModel();
    const WallEvent = getWallEventModel();
    const User = getUserModel();

    const pending = await WallSubmission.findAll({
      where: { isApproved: false },
      order: [['createdAt', 'DESC']],
      include: [
        { model: User, as: 'user', attributes: ['id', 'name', 'profileImage'] },
        { model: WallEvent, as: 'event', attributes: ['id', 'title', 'status'] }
      ]
    });

    res.json(pending);
  } catch (err) {
    console.error('Error fetching pending submissions:', err);
    res.status(500).json({ message: 'Failed to fetch pending queue.' });
  }
});

// ── ADMIN: Approve Submission ──
// PUT /api/wall/admin/submissions/:id/approve
router.put('/admin/submissions/:id/approve', protect, admin, async (req, res) => {
  try {
    const WallSubmission = getWallSubmissionModel();
    const submission = isUuid(req.params.id) ? await WallSubmission.findByPk(req.params.id) : null;
    if (!submission) return res.status(404).json({ message: 'Submission not found.' });

    submission.isApproved = true;
    await submission.save();
    realtime.publish('wall', 'updated', submission.eventId, { scope: 'submissions' });
    realtime.notifyAdmin('wall_submission', 'updated', submission.id);

    res.json({ message: 'Submission approved and live on The Wall!', submission });
  } catch (err) {
    console.error('Error approving submission:', err);
    res.status(500).json({ message: 'Failed to approve submission.' });
  }
});

// ── ADMIN: Reject Submission ──
// PUT /api/wall/admin/submissions/:id/reject
router.put('/admin/submissions/:id/reject', protect, admin, async (req, res) => {
  try {
    const WallSubmission = getWallSubmissionModel();
    const submission = isUuid(req.params.id) ? await WallSubmission.findByPk(req.params.id) : null;
    if (!submission) return res.status(404).json({ message: 'Submission not found.' });

    await submission.destroy();
    releaseWallMedia([submission.imageUrl]); // B19: a rejected photo's bytes go too
    realtime.publish('wall', 'updated', submission.eventId, { scope: 'submissions' });
    realtime.notifyAdmin('wall_submission', 'deleted', submission.id);

    res.json({ message: 'Submission rejected and removed.' });
  } catch (err) {
    console.error('Error rejecting submission:', err);
    res.status(500).json({ message: 'Failed to reject submission.' });
  }
});

module.exports = router;
