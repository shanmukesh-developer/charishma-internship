// Campus people & clubs: search, start a 1:1 chat, discoverable clubs.
const { Op } = require('sequelize');
const { getConversationModel } = require('../../../models/Conversation');
const { getUserModel } = require('../../../models/User');
const { getCampusProfileModel } = require('../models/CampusProfile');
const { getCampusGroupSettingModel } = require('../models/CampusGroupSetting');
const { avatarUrlFor, blockedIdsFor, isBlockedBetween, absolutize } = require('../campusHelpers');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const likeOp = (model) => (model.sequelize.getDialect() === 'postgres' ? Op.iLike : Op.like);
const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

const friendshipModel = () => {
  try { return require('../../../models/Friendship').getFriendshipModel(); } catch { return null; }
};

/** friendship status of `me` with each id: 'accepted' | 'pending_out' | 'pending_in' | 'none' */
const friendshipMap = async (me, ids) => {
  const out = {};
  const Friendship = friendshipModel();
  if (!Friendship || !ids.length) return out;
  const rows = await Friendship.findAll({
    where: {
      [Op.or]: [
        { requesterId: me, recipientId: { [Op.in]: ids } },
        { recipientId: me, requesterId: { [Op.in]: ids } },
      ],
    },
    attributes: ['id', 'requesterId', 'recipientId', 'status'],
  });
  rows.forEach((r) => {
    const other = r.requesterId === me ? r.recipientId : r.requesterId;
    let status = r.status;
    if (status === 'pending') status = r.requesterId === me ? 'pending_out' : 'pending_in';
    out[other] = { status, friendshipId: r.id };
  });
  return out;
};

const memberCountOf = (c) => (Array.isArray(c.participants) ? c.participants.length : 0);

// @desc    Search verified classmates on my campus and discoverable clubs
// @route   GET /api/campus/search?q=&type=all|people|clubs
const searchCampus = async (req, res) => {
  try {
    const me = req.user.id;
    const q = String(req.query.q || '').trim().slice(0, 40);
    const type = ['people', 'clubs'].includes(req.query.type) ? req.query.type : 'all';
    if (q.length < 2) return res.json({ people: [], clubs: [] });

    const CampusProfile = getCampusProfileModel();
    const User = getUserModel();
    const myProfile = await CampusProfile.findOne({ where: { userId: me }, attributes: ['campusId', 'verificationStatus'] });
    const campusId = myProfile ? myProfile.campusId : null;
    const pattern = `%${escapeLike(q)}%`;

    // Only verified students can browse classmates (stops non-students listing a campus by name).
    const iAmVerified = !!myProfile && myProfile.verificationStatus === 'verified';
    let people = [];
    if (type !== 'clubs' && campusId && iAmVerified) {
      const blocked = await blockedIdsFor(me);
      const profiles = await CampusProfile.findAll({
        where: { campusId, verificationStatus: 'verified', userId: { [Op.ne]: me } },
        attributes: ['userId', 'branch', 'year'],
        include: [{
          model: User,
          as: 'user',
          required: true,
          where: { name: { [likeOp(User)]: pattern }, isActive: { [Op.not]: false } },
          attributes: ['id', 'name', 'profileImage'],
        }],
        order: [[{ model: User, as: 'user' }, 'name', 'ASC']],
        limit: 30,
      });
      const visible = profiles.filter((p) => p.user && !blocked.has(p.userId)).slice(0, 20);
      const fmap = await friendshipMap(me, visible.map((p) => p.userId));
      people = visible.map((p) => ({
        userId: p.userId,
        name: p.user.name,
        avatarUrl: avatarUrlFor(req, p.user),
        branch: p.branch || null,
        year: p.year || null,
        verified: true,
        friendshipStatus: fmap[p.userId] ? fmap[p.userId].status : 'none',
        friendshipId: fmap[p.userId] ? fmap[p.userId].friendshipId : null,
      }));
    }

    let clubs = [];
    const Setting = getCampusGroupSettingModel();
    if (type !== 'people' && Setting) {
      const settings = await Setting.findAll({
        where: {
          discoverable: true,
          ...(campusId ? { [Op.or]: [{ campusId }, { campusId: null }] } : {}),
        },
        attributes: ['conversationId'],
        limit: 500,
      });
      const convIds = settings.map((s) => s.conversationId);
      if (convIds.length) {
        const Conversation = getConversationModel();
        const groups = await Conversation.findAll({
          where: { id: { [Op.in]: convIds }, isGroup: true, name: { [likeOp(Conversation)]: pattern } },
          attributes: ['id', 'name', 'description', 'type', 'groupAvatar', 'participants'],
          limit: 20,
        });
        clubs = groups.map((g) => ({
          id: g.id,
          name: g.name,
          description: g.description || '',
          type: g.type || 'club',
          avatarUrl: absolutize(req, g.groupAvatar) || null,
          memberCount: memberCountOf(g),
          isMember: (g.participants || []).includes(me),
        }));
      }
    }

    res.json({ people, clubs, campusId, needsCampus: !campusId, needsVerification: !!campusId && !iAmVerified && type !== 'clubs' });
  } catch (err) {
    console.error('[CAMPUS_SEARCH_ERR]', err.message);
    res.status(500).json({ message: 'Search failed. Please try again.' });
  }
};

/** Finds the 1:1 conversation between two users, whichever order the participants were stored in. */
const findDm = async (a, b) => {
  const Conversation = getConversationModel();
  const candidates = await Conversation.findAll({
    where: {
      isGroup: false,
      // Friends task / Connect chats between the same two people are never reused as their DM.
      refType: null,
      [Op.or]: [
        { participants: JSON.stringify([a, b]) },
        { participants: JSON.stringify([b, a]) },
      ],
    },
    order: [['createdAt', 'ASC']],
    limit: 1,
  });
  return candidates[0] || null;
};

// @desc    Open (find or create) a 1:1 chat with a classmate or friend
// @route   POST /api/campus/dm   { userId }
const openDm = async (req, res) => {
  try {
    const me = req.user.id;
    const otherId = String((req.body && req.body.userId) || '');
    if (!UUID_RE.test(otherId)) return res.status(400).json({ message: 'Pick someone to chat with.' });
    if (otherId === me) return res.status(400).json({ message: 'You cannot start a chat with yourself.' });

    const User = getUserModel();
    const other = await User.findByPk(otherId, { attributes: ['id', 'name', 'profileImage', 'isActive'] });
    if (!other || other.isActive === false) return res.status(404).json({ message: 'This student is not on ZENV.' });
    if (await isBlockedBetween(me, otherId)) return res.status(403).json({ code: 'BLOCKED', message: 'You cannot message this person.' });

    let conversation = await findDm(me, otherId);
    if (!conversation) {
      // New chats: accepted friends, or two members of the same campus where the other person is verified.
      const fmap = await friendshipMap(me, [otherId]);
      const isFriend = fmap[otherId] && fmap[otherId].status === 'accepted';
      if (!isFriend) {
        const CampusProfile = getCampusProfileModel();
        const [mine, theirs] = await Promise.all([
          CampusProfile.findOne({ where: { userId: me }, attributes: ['campusId', 'verificationStatus'] }),
          CampusProfile.findOne({ where: { userId: otherId }, attributes: ['campusId', 'verificationStatus'] }),
        ]);
        const sameCampus = mine && theirs && mine.campusId && mine.campusId === theirs.campusId;
        if (sameCampus && theirs.verificationStatus === 'verified' && mine.verificationStatus !== 'verified') {
          return res.status(403).json({
            code: 'VERIFY_FIRST',
            message: 'Verify your college first to message classmates. Friends can always chat.',
          });
        }
        if (!sameCampus || theirs.verificationStatus !== 'verified') {
          return res.status(403).json({
            code: 'NOT_CONNECTED',
            message: 'You can chat with verified students on your campus or your friends. Send a friend request first.',
          });
        }
      }
      const Conversation = getConversationModel();
      conversation = await Conversation.create({
        isGroup: false,
        type: 'dm',
        participants: [me, otherId],
        lastMessageAt: new Date(),
      });
    }

    res.status(200).json({
      chatId: conversation.id,
      chat: {
        id: conversation.id,
        name: other.name,
        type: 'dm',
        isGroup: false,
        avatarUrl: avatarUrlFor(req, other),
        peerId: other.id,
        lastMessage: '',
        lastMessageAt: conversation.lastMessageAt,
        unreadCount: 0,
      },
    });
  } catch (err) {
    console.error('[CAMPUS_OPEN_DM_ERR]', err.message);
    res.status(500).json({ message: 'Could not open the chat. Please try again.' });
  }
};

// @desc    Group admin makes a group discoverable (listed in search, open to join) or private again
// @route   PUT /api/campus/groups/:id/discoverable   { discoverable: boolean }
const setGroupDiscoverable = async (req, res) => {
  try {
    const id = String(req.params.id || '');
    if (!UUID_RE.test(id)) return res.status(404).json({ message: 'Group not found' });
    const Conversation = getConversationModel();
    const group = await Conversation.findByPk(id);
    if (!group || !group.isGroup) return res.status(404).json({ message: 'Group not found' });
    const isAdmin = (group.adminIds || []).includes(req.user.id) || String(req.user.role || '').toLowerCase() === 'admin';
    if (!isAdmin) return res.status(403).json({ message: 'Only group admins can change this.' });

    const discoverable = !!(req.body && req.body.discoverable);
    // C2: a group under moderation (hidden / pending review / removed) cannot be listed again.
    if (discoverable && UUID_RE.test(id) && await require('../../friends/services/ugc').isHidden('group', id)) {
      return res.status(403).json({ code: 'GROUP_UNDER_REVIEW', message: 'This group is under review by our team and cannot be listed right now.' });
    }
    const myProfile = await getCampusProfileModel().findOne({ where: { userId: req.user.id }, attributes: ['campusId', 'verificationStatus'] });
    // Listing a club in a campus directory needs a verified member of that campus (an unverified
    // account can claim any campus in its profile and plant phishing / spam clubs there).
    if (discoverable && String(req.user.role || '').toLowerCase() !== 'admin'
      && (!myProfile || myProfile.verificationStatus !== 'verified' || !myProfile.campusId)) {
      return res.status(403).json({ code: 'VERIFICATION_REQUIRED', message: 'Verify your college to list a club on campus.' });
    }
    const Setting = getCampusGroupSettingModel();
    const [row] = await Setting.findOrCreate({
      where: { conversationId: id },
      defaults: { conversationId: id, campusId: myProfile ? myProfile.campusId : null, discoverable, updatedBy: req.user.id },
    });
    await row.update({ discoverable, updatedBy: req.user.id, campusId: row.campusId || (myProfile ? myProfile.campusId : null) });
    res.json({ id, discoverable });
  } catch (err) {
    console.error('[CAMPUS_DISCOVERABLE_ERR]', err.message);
    res.status(500).json({ message: 'Could not update the group.' });
  }
};

// @desc    Join a discoverable club without a code
// @route   POST /api/campus/groups/:id/join-open
const joinOpenGroup = async (req, res) => {
  try {
    const id = String(req.params.id || '');
    if (!UUID_RE.test(id)) return res.status(404).json({ message: 'Group not found' });
    const Setting = getCampusGroupSettingModel();
    const setting = await Setting.findByPk(id);
    if (!setting || !setting.discoverable) return res.status(403).json({ message: 'This group needs an invite code.' });
    if (setting.campusId) {
      // campusId is self-set until verification, so a campus-only club needs a verified profile.
      const mine = await getCampusProfileModel().findOne({ where: { userId: req.user.id }, attributes: ['campusId', 'verificationStatus'] });
      if (!mine || mine.campusId !== setting.campusId) return res.status(403).json({ message: 'This group is only for its own campus.' });
      if (mine.verificationStatus !== 'verified') {
        return res.status(403).json({ code: 'VERIFY_CAMPUS', message: 'Verify your campus profile to join this club.' });
      }
    }
    const Conversation = getConversationModel();
    const { getSequelize } = require('../../../config/db');
    const result = await getSequelize().transaction(async (t) => {
      const g = await Conversation.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!g || !g.isGroup) return null;
      const participants = g.participants || [];
      if (!participants.includes(req.user.id)) {
        g.participants = [...participants, req.user.id];
        await g.save({ transaction: t });
      }
      return g;
    });
    if (!result) return res.status(404).json({ message: 'Group not found' });
    res.json({ message: `You joined ${result.name}!`, group: { id: result.id, name: result.name, type: result.type, memberCount: memberCountOf(result) } });
  } catch (err) {
    console.error('[CAMPUS_JOIN_OPEN_ERR]', err.message);
    res.status(500).json({ message: 'Could not join the group.' });
  }
};

module.exports = { searchCampus, openDm, setGroupDiscoverable, joinOpenGroup, findDm };
