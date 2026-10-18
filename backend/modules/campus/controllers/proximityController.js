const { Op } = require('sequelize');
const { getProximityRoomModel, getProximityMessageModel } = require('../models/ProximityRoom');

// Campus spots are created by admins only (admin dashboard > Campus Spots). The five rooms the app
// used to seed on first load are retired once (disabled, kept so an admin can re-enable or delete them).
const LEGACY_DEFAULT_SLUGS = ['library-study', 'mess-hall-1', 'sports-complex', 'hostel-common', 'amphitheatre'];
const LEGACY_RETIRED_KEY = 'CAMPUS_SPOTS_DEFAULTS_RETIRED';

const retireLegacyDefaultSpots = async () => {
  const ProximityRoom = getProximityRoomModel();
  const GlobalConfig = ProximityRoom.sequelize.models.GlobalConfig;
  if (!GlobalConfig) return 0;
  if (await GlobalConfig.findOne({ where: { key: LEGACY_RETIRED_KEY } })) return 0;
  const [n] = await ProximityRoom.update(
    { isActive: false },
    { where: { slug: { [Op.in]: LEGACY_DEFAULT_SLUGS }, campusId: null } }
  );
  await GlobalConfig.findOrCreate({
    where: { key: LEGACY_RETIRED_KEY },
    defaults: { value: true, description: 'Built-in campus spots were disabled once; spots are admin-managed now' },
  });
  if (n) console.log(`[CAMPUS_SPOTS] Disabled ${n} old built-in campus spot(s); manage spots in the admin dashboard.`);
  return n;
};

/** May this user see / join this spot? Spots without a campus are for everyone. */
const spotVisibleTo = (room, campusId) =>
  !!room && room.isActive !== false && (!room.campusId || (campusId && String(room.campusId) === String(campusId)));

const spotOrder = [['sortOrder', 'ASC'], ['name', 'ASC']];

/**
 * S0: the campus a user may see campus-only spots of. Only a VERIFIED campus membership counts (the
 * campus on an unverified profile is self-set, so anyone could pick any campus and read its spots).
 */
const verifiedCampusOf = async (userId) => {
  const { campusScopeFor } = require('../campusHelpers');
  const s = await campusScopeFor(userId);
  return s.verified ? s.campusId : null;
};

// Haversine formula: distance in meters between two lat/lng points
const haversineDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371000; // Earth radius in meters
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// GET /api/campus/proximity/rooms?lat=&lng=
// Active spots for the student's campus plus spots meant for every campus, in the admin's order.
const getProximityRooms = async (req, res) => {
  try {
    const ProximityRoom = getProximityRoomModel();
    const campusId = await verifiedCampusOf(req.user.id);
    const rooms = await ProximityRoom.findAll({
      where: {
        isActive: true,
        [Op.or]: campusId ? [{ campusId: null }, { campusId: String(campusId) }] : [{ campusId: null }],
      },
      order: spotOrder,
    });
    // Lazy require: campusSocket requires this module's models at load time.
    const { getProximityLiveCount } = require('../campusSocket');

    const { lat, lng } = req.query;
    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);

    const result = rooms.map((room) => {
      let distance = null;
      let isNearby = false;
      if (!isNaN(userLat) && !isNaN(userLng) && room.latitude != null && room.longitude != null) {
        distance = Math.round(haversineDistance(userLat, userLng, room.latitude, room.longitude));
        isNearby = distance <= (room.radiusMeters || 150);
      }
      return {
        id: room.id,
        name: room.name,
        slug: room.slug,
        subtitle: room.subtitle || '',
        icon: room.icon,
        emoji: room.emoji || null,
        category: room.category,
        sortOrder: room.sortOrder || 0,
        latitude: room.latitude,
        longitude: room.longitude,
        radiusMeters: room.radiusMeters,
        activeUserCount: getProximityLiveCount(room.slug),
        isNearby,
        distance,
      };
    });

    res.json({ rooms: result });
  } catch (err) {
    console.error('[PROXIMITY_ROOMS_ERR]', err);
    res.status(500).json({ message: 'Failed to load proximity rooms' });
  }
};

// GET /api/campus/proximity/rooms/:slug/messages?limit=50
const getProximityMessages = async (req, res) => {
  try {
    const ProximityRoom = getProximityRoomModel();
    const ProximityMessage = getProximityMessageModel();

    const room = await ProximityRoom.findOne({ where: { slug: String(req.params.slug || '').slice(0, 80) } });
    if (!spotVisibleTo(room, room && room.campusId ? await verifiedCampusOf(req.user.id) : null)) return res.status(404).json({ message: 'Room not found' });

    const limit = Math.min(parseInt(req.query.limit) || 50, 100);

    // Only fetch messages from the last 24h
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const messages = await ProximityMessage.findAll({
      where: {
        roomId: room.id,
        createdAt: { [Op.gte]: since },
      },
      // Newest N messages, returned oldest-first for the chat view.
      order: [['createdAt', 'DESC']],
      limit,
    });
    messages.reverse();
    // People you blocked (or who blocked you) are left out of the room history.
    const { blockedIdsFor } = require('../campusHelpers');
    const blocked = await blockedIdsFor(req.user.id);
    // C2: moderated messages (hidden / pending review / removed) are left out too.
    const visible = await require('../../friends/services/ugc').filterVisible('proximity_message', messages.filter((m) => !blocked.has(m.senderId)));
    const { getProximityLiveCount } = require('../campusSocket');

    res.json({
      room: {
        id: room.id,
        name: room.name,
        slug: room.slug,
        subtitle: room.subtitle || '',
        icon: room.icon,
        emoji: room.emoji || null,
        category: room.category,
        activeUserCount: getProximityLiveCount(room.slug),
      },
      messages: visible.map((m) => ({
        id: m.id,
        senderId: m.senderId,
        senderName: m.senderName,
        text: m.text,
        type: m.type,
        createdAt: m.createdAt,
      })),
    });
  } catch (err) {
    console.error('[PROXIMITY_MESSAGES_ERR]', err);
    res.status(500).json({ message: 'Failed to load messages' });
  }
};

// POST /api/campus/proximity/rooms/:slug/messages
const postProximityMessage = async (req, res) => {
  try {
    const ProximityRoom = getProximityRoomModel();
    const ProximityMessage = getProximityMessageModel();

    const room = await ProximityRoom.findOne({ where: { slug: String(req.params.slug || '').slice(0, 80) } });
    if (!spotVisibleTo(room, room && room.campusId ? await verifiedCampusOf(req.user.id) : null)) return res.status(404).json({ message: 'Room not found' });

    const { text } = req.body || {};
    if (typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ message: 'Message text is required' });
    }
    // Same per-user budget as the proximity:message socket event.
    const lim = require('../../friends/services/limiter');
    lim.define('proximity_send', 20, 60 * 1000);
    if (!lim.take(String(req.user.id), 'proximity_send').ok) {
      return res.status(429).json({ code: 'RATE_LIMITED', message: 'You are sending messages too fast. Please slow down.' });
    }

    // C2: sanctioned authors cannot post; slurs / threats refused (422 CONTENT_BLOCKED), profanity masked.
    const guard = await require('../../friends/services/ugc').postGuard(req.user.id);
    if (guard) return res.status(guard.status).json(guard.body);
    const cf = require('../../../utils/contentFilter');
    const filtered = cf.analyse(text.trim().slice(0, 1000));
    if (filtered.action === 'block') return cf.rejectBlocked(res, 'text');

    const msg = await ProximityMessage.create({
      roomId: room.id,
      senderId: req.user.id,
      senderName: req.user.name,
      text: filtered.text,
      type: 'text',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    res.status(201).json({
      message: {
        id: msg.id,
        senderId: msg.senderId,
        senderName: msg.senderName,
        text: msg.text,
        type: msg.type,
        createdAt: msg.createdAt,
      },
    });
  } catch (err) {
    console.error('[PROXIMITY_POST_MSG_ERR]', err);
    res.status(500).json({ message: 'Failed to send message' });
  }
};

module.exports = {
  verifiedCampusOf,
  getProximityRooms,
  getProximityMessages,
  postProximityMessage,
  retireLegacyDefaultSpots,
  spotVisibleTo,
  haversineDistance,
  LEGACY_DEFAULT_SLUGS,
};
