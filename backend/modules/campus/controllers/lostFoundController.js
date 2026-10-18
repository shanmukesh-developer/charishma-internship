const { getLostAndFoundModel } = require('../models/LostAndFound');
const { cleanImageRef, campusScopeFor, sameCampusUsers, blockedIdsFor } = require('../campusHelpers');

const VERIFY_FIRST = { code: 'VERIFICATION_REQUIRED', message: 'Verify your college to use the campus board.' };

// @desc    Post a lost or found item to the campus board
// @route   POST /api/campus/lost-found
const createLostFound = async (req, res) => {
  try {
    const { type, title, description, location, imageUrl, claimContact } = req.body || {};
    // Posting (with a contact) is for verified students: the board is campus-only.
    const scope = await campusScopeFor(req.user.id);
    if (!scope.verified || !scope.campusId) return res.status(403).json(VERIFY_FIRST);
    if ([title, description, location, claimContact].some((v) => v != null && typeof v !== 'string')) {
      return res.status(400).json({ message: 'Please send text fields as text.' });
    }
    if (!type || !['lost', 'found'].includes(type)) {
      return res.status(400).json({ message: "type must be 'lost' or 'found'" });
    }
    if (!title || !title.trim()) {
      return res.status(400).json({ message: 'A short title is required' });
    }
    if (!location || !location.trim()) {
      return res.status(400).json({ message: 'Where it was lost/found is required' });
    }

    // C2: sanctioned authors cannot post; slurs / threats refused (422 CONTENT_BLOCKED), profanity masked.
    const guard = await require('../../friends/services/ugc').postGuard(req.user.id);
    if (guard) return res.status(guard.status).json(guard.body);
    const cf = require('../../../utils/contentFilter');
    const text = cf.cleanFields({ title, description, location });
    if (text.blocked) return cf.rejectBlocked(res, text.field);

    // Photo: '/api/campus/media/<id>' from POST /api/campus/media, an https URL, or a legacy data:image URL.
    // Inline base64 is sniffed and moved to the media table (short URL on the row).
    let cleanImage = null;
    if (imageUrl) {
      const { storeImageRef } = require('../../../utils/imageStore');
      const img = await storeImageRef(imageUrl, { req, ownerId: req.user.id, purpose: 'lost_found', maxBytes: 3 * 1024 * 1024, allowExternal: false }); // S0: no external image links
      if (!img.ok || !img.value) return res.status(img.status && img.status !== 500 ? img.status : 400).json({ code: img.code || 'BAD_IMAGE', message: img.message || 'That photo could not be attached. Please pick it again.' });
      cleanImage = img.value;
    }

    const LostAndFound = getLostAndFoundModel();
    const item = await LostAndFound.create({
      userId: req.user.id,
      userName: req.user.name || 'A student',
      type,
      title: text.values.title.trim().slice(0, 120),
      description: text.values.description ? text.values.description.trim().slice(0, 1000) : null,
      location: text.values.location.trim().slice(0, 120),
      imageUrl: cleanImage,
      claimContact: claimContact ? claimContact.trim().slice(0, 120) : null,
      status: 'open',
    });

    console.log(`🔎 [CAMPUS_LNF] ${req.user.name} posted ${type}: "${item.title}"`);
    res.status(201).json({ message: 'Posted to the campus board', item });
  } catch (err) {
    console.error('[CREATE_LNF_ERR]', err);
    res.status(500).json({ message: 'Failed to post item' });
  }
};

// @desc    List board items (optionally filter by type/status)
// @route   GET /api/campus/lost-found
const getLostFound = async (req, res) => {
  try {
    const LostAndFound = getLostAndFoundModel();
    // Only verified students see their own campus's board: items carry names and a contact
    // (usually a phone number), so other campuses and unverified accounts get nothing.
    const scope = await campusScopeFor(req.user.id);
    if (!scope.verified || !scope.campusId) return res.status(403).json(VERIFY_FIRST);
    const where = { userId: sameCampusUsers(scope.campusId) };
    if (['lost', 'found'].includes(req.query.type)) where.type = req.query.type;
    if (['open', 'claimed', 'resolved'].includes(req.query.status)) where.status = req.query.status;
    else where.status = 'open';

    const rows = await LostAndFound.findAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: 100,
    });
    const blocked = await blockedIdsFor(req.user.id);
    // C2: moderated items (hidden / pending review / removed) are left out too.
    const items = await require('../../friends/services/ugc').filterVisible('lost_found', rows.filter((r) => !blocked.has(r.userId)));
    res.json({ items });
  } catch (err) {
    console.error('[GET_LNF_ERR]', err);
    res.status(500).json({ message: 'Failed to load board' });
  }
};

// @desc    Mark an item resolved/claimed (poster only)
// @route   POST /api/campus/lost-found/:id/resolve
const resolveLostFound = async (req, res) => {
  try {
    const LostAndFound = getLostAndFoundModel();
    const item = await LostAndFound.findByPk(req.params.id);
    if (!item) return res.status(404).json({ message: 'Item not found' });
    if (item.userId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Only the poster can resolve this item' });
    }

    const { status = 'resolved' } = req.body;
    item.status = ['claimed', 'resolved'].includes(status) ? status : 'resolved';
    await item.save();

    res.json({ message: 'Item marked as resolved', item });
  } catch (err) {
    console.error('[RESOLVE_LNF_ERR]', err);
    res.status(500).json({ message: 'Failed to update item' });
  }
};

module.exports = { createLostFound, getLostFound, resolveLostFound };
