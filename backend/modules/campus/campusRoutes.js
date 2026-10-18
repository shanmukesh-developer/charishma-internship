const express = require('express');
const router = express.Router();
const { protect, admin, studentOnly } = require('../../middleware/authMiddleware');
// S0: student-only social writes (riders / stores / drivers get 403).
const student = [protect, studentOnly];
const {
  getCampuses,
  getCampusProfile,
  updateCampusProfile,
  requestEmailOtp,
  confirmEmailOtp,
  submitIdCard,
  getVerificationRequests,
  reviewVerification,
  getVerificationMethods,
  getVerificationStatus,
} = require('./controllers/profileController');
const { parseUpload, uploadMedia, serveMedia, serveAvatar } = require('./controllers/mediaController');
const { searchCampus, openDm, setGroupDiscoverable, joinOpenGroup } = require('./controllers/peopleController');

const {
  createGroup,
  previewGroupByCode,
  joinGroupByCode,
  resetJoinCode,
  getMyGroups,
} = require('./controllers/groupController');

const {
  getMyAssignments,
  createAssignment,
  getAssignments,
  submitAssignment,
  createAnnouncement,
  acknowledgeAnnouncement,
  getAnnouncements,
} = require('./controllers/classworkController');

const {
  getChats,
  getChatMessages,
} = require('./controllers/chatController');

const {
  createPoll,
  getPolls,
  votePoll,
} = require('./controllers/pollController');

const {
  createLostFound,
  getLostFound,
  resolveLostFound,
} = require('./controllers/lostFoundController');

const {
  createRidePool,
  getRidePools,
  joinRidePool,
  leaveRidePool,
} = require('./controllers/ridePoolController');

const {
  getProximityRooms,
  getProximityMessages,
  postProximityMessage,
} = require('./controllers/proximityController');

const {
  getToday,
  getDailyQuestion,
  answerDailyQuestion,
  upvoteAnswer,
  getWhispers,
  createWhisper,
  reactWhisper,
  getBranchLeaderboard,
} = require('./controllers/pulseController');

// Campuses
// Campus list changes almost never: 5 min server cache + ETag (realtime 'campus' publishes clear it).
router.get('/campuses', require('../../utils/responseCache').cacheGet('campus', { ttlMs: 5 * 60 * 1000 }), getCampuses);

// Retention policy shown in the apps ("Messages disappear after 7 days"); admin GlobalConfig keys.
// (module resolved once, not per request: a require() per call ran fs stats on every hit)
let retentionCronMod = null;
const retentionCron = () => retentionCronMod || (retentionCronMod = require('../../cron/retentionCron'));
router.get('/retention', async (req, res) => {
  try {
    const { chatDays, pulseDays } = await retentionCron().getRetentionPolicy();
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ chatDays, pulseDays });
  } catch (err) {
    console.error('[RETENTION_POLICY_ERR]', err.message);
    res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
});

// C2: which optional campus features are on (the app hides the entry points of the ones that are off).
router.get('/features', protect, async (req, res) => {
  try {
    const sw = require('../../utils/featureSwitches');
    res.set('Cache-Control', 'private, max-age=30');
    res.json(await sw.all());
  } catch (err) {
    console.error('[CAMPUS_FEATURES_ERR]', err.message);
    res.json({ whispers: true, afterDark: true });
  }
});

// Media: one upload for every campus image; served from a short URL with long cache headers.
// GET is public by unguessable id (ID cards need the owner/admin token or a signed link).
router.post('/media', protect, parseUpload, uploadMedia);
router.get('/media/:id', serveMedia);
router.get('/avatar/:userId', serveAvatar);

// People & clubs
router.get('/search', protect, searchCampus);
router.post('/dm', student, openDm);

// Chats (list + cursor-paginated history). Messaging itself is socket-driven (/campus ns).
router.get('/chats', protect, getChats);
router.get('/chats/:id/messages', protect, getChatMessages);

// Profile & Verification
router.get('/profile', protect, getCampusProfile);
router.put('/profile', student, updateCampusProfile);
router.get('/verify/methods', protect, getVerificationMethods);
router.get('/verify/status', protect, getVerificationStatus);
router.post('/verify/email-otp', student, requestEmailOtp);
router.post('/verify/confirm-otp', student, confirmEmailOtp);
router.post('/verify/upload-id', student, submitIdCard);
router.get('/verify/requests', protect, getVerificationRequests);
router.post('/verify/:id/review', protect, reviewVerification);

// Groups & Classroom
router.get('/groups/mine', protect, getMyGroups);
router.post('/groups', student, createGroup);
router.post('/groups/join', student, joinGroupByCode);
router.get('/groups/preview/:code', previewGroupByCode);
router.post('/groups/:id/code/reset', protect, resetJoinCode);
router.put('/groups/:id/discoverable', protect, setGroupDiscoverable);
router.post('/groups/:id/join-open', student, joinOpenGroup);

// Classwork & Announcements
router.get('/assignments', protect, getMyAssignments);
router.post('/assignments', protect, createAssignment);
router.get('/assignments/:conversationId', protect, getAssignments);
router.post('/assignments/:id/submit', protect, submitAssignment);
router.get('/announcements/:conversationId', protect, getAnnouncements);
router.post('/announcements', protect, createAnnouncement);
router.post('/announcements/:id/ack', protect, acknowledgeAnnouncement);

// Polls (Phase 4 smart tray)
router.post('/polls', protect, createPoll);
router.get('/polls/:conversationId', protect, getPolls);
router.post('/polls/:id/vote', protect, votePoll);

// Lost & Found (Phase 4 smart tray)
router.post('/lost-found', protect, createLostFound);
router.get('/lost-found', protect, getLostFound);
router.post('/lost-found/:id/resolve', protect, resolveLostFound);

// Ride Pool (Phase 4 smart tray)
router.post('/ride-pool', protect, createRidePool);
router.get('/ride-pool', protect, getRidePools);
router.post('/ride-pool/:id/join', protect, joinRidePool);
router.post('/ride-pool/:id/leave', protect, leaveRidePool);

// Phase 5: Proximity Rooms (location-bound live chat)
router.get('/proximity/rooms', protect, getProximityRooms);
router.get('/proximity/rooms/:slug/messages', protect, getProximityMessages);
router.post('/proximity/rooms/:slug/messages', student, postProximityMessage);

// Pulse: Today on Campus, 9 PM Question, Whispers, Branch Wars (all real, DB-backed)
router.get('/pulse/today', protect, getToday);
router.get('/pulse/question', protect, getDailyQuestion);
router.post('/pulse/question/answer', student, answerDailyQuestion);
router.post('/pulse/question/answer/:id/upvote', student, upvoteAnswer);
// C2: Whispers kill switch (GlobalConfig CAMPUS_WHISPERS_ENABLED, admin Friends moderation > switches).
const featureSwitches = require('../../utils/featureSwitches');
router.get('/pulse/whispers', student, featureSwitches.requireOn('whispers'), getWhispers);
router.post('/pulse/whispers', student, featureSwitches.requireOn('whispers'), createWhisper);
router.post('/pulse/whispers/:id/react', student, featureSwitches.requireOn('whispers'), reactWhisper);
router.get('/pulse/branch-wars', protect, getBranchLeaderboard);
// Board counts for the Pulse cards (no photos downloaded)
router.get('/pulse/counts', protect, async (req, res) => {
  try {
    const { Op } = require('sequelize');
    const { getLostAndFoundModel, getRidePoolModel } = require('./models');
    const [openLostFound, openRides] = await Promise.all([
      getLostAndFoundModel().count({ where: { status: 'open' } }),
      getRidePoolModel().count({
        where: { status: 'open', departureTime: { [Op.gte]: new Date(Date.now() - 30 * 60 * 1000) } },
      }),
    ]);
    res.json({ openLostFound, openRides });
  } catch (err) {
    console.error('[PULSE_COUNTS_ERR]', err.message);
    res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
});

// Admin: publish real Pulse content (mess menu, events, the 9 PM question)
const pulseAdmin = require('./controllers/pulseAdminController');
router.put('/admin/mess-menu', protect, admin, pulseAdmin.upsertMessMenu);
router.delete('/admin/mess-menu/:id', protect, admin, pulseAdmin.deleteMessMenu);
router.get('/admin/events', protect, admin, pulseAdmin.listEvents);
router.post('/admin/events', protect, admin, pulseAdmin.createEvent);
router.put('/admin/events/:id', protect, admin, pulseAdmin.updateEvent);
router.delete('/admin/events/:id', protect, admin, pulseAdmin.deleteEvent);
router.put('/admin/daily-question', protect, admin, pulseAdmin.upsertDailyQuestion);

// Admin: Campus spots (open chat rooms per campus). Only admin-created spots exist.
const spotAdmin = require('./controllers/spotAdminController');
router.get('/admin/spots', protect, admin, spotAdmin.listSpots);
router.post('/admin/spots', protect, admin, spotAdmin.createSpot);
router.put('/admin/spots/reorder', protect, admin, spotAdmin.reorderSpots);
router.put('/admin/spots/:id', protect, admin, spotAdmin.updateSpot);
router.delete('/admin/spots/:id', protect, admin, spotAdmin.deleteSpot);

// ── Zenvy Friends (Campus Buddy > Friends) ────────────────────────────────────
// Mounted last so the existing /pulse/* routes above keep answering first. Each sub-tab router is a
// FEATURE_OFF stub until its phase ships (modules/friends/routes/*Routes.js).
router.use('/friends', require('../friends/routes/friendsRoutes'));
router.use('/mod', require('../friends/routes/modRoutes'));
router.use('/pulse', require('../friends/routes/pulseRoutes'));
router.use('/forum', require('../friends/routes/forumRoutes'));
router.use('/tasks', require('../friends/routes/tasksRoutes'));
router.use('/connect', require('../friends/routes/connectRoutes'));
router.use('/spaces', require('../friends/routes/spacesRoutes'));

module.exports = router;
