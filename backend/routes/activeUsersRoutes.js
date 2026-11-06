// Active testers (owner, 6 Nov 2026), mounted at /api/admin/active-users inside routes/adminRoutes (after protect +
// admin, so only a signed-in admin reaches it). Data: utils/appPresence (recording) + utils/activeUsers (report).
//   GET /            ?filter=all|today|week|inactive2d|never&search=&page=&sort=lastSeen_desc|lastSeen_asc|signedUp_desc|signedUp_asc
//   GET /testers     the closed-tester phone list, each phone with its account's status
//   PUT /testers     { phones: "one per line or comma separated" | string[], ifUpdatedAt? }   validated, audited
const express = require('express');
const au = require('../utils/activeUsers');
const { sendServerError } = require('../utils/httpErrors');

const router = express.Router();
router.use((req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });

const adminOf = (req) => (req.user && req.user.id ? String(req.user.id) : 'admin_default');
const mask = (p) => `******${String(p).slice(-4)}`;

router.get('/', async (req, res) => {
  try {
    const q = req.query || {};
    const str = (v) => (typeof v === 'string' ? v : '');
    res.json(await au.report({ filter: str(q.filter) || 'all', search: str(q.search), page: str(q.page) || 1, sort: str(q.sort) || 'lastSeen_desc' }));
  } catch (err) {
    sendServerError(res, err, '[ACTIVE_USERS_ERROR]');
  }
});

router.get('/testers', async (req, res) => {
  try {
    res.json(await au.testerStatus());
  } catch (err) {
    sendServerError(res, err, '[ACTIVE_TESTERS_ERROR]');
  }
});

const sameTime = (a, b) => {
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  return Number.isFinite(ta) && Number.isFinite(tb) && ta === tb;
};

router.put('/testers', async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const input = body.phones;
    if (input !== undefined && typeof input !== 'string' && !Array.isArray(input)) {
      return res.status(400).json({ code: 'INVALID_TESTER_PHONES', message: 'Send the phone numbers as text (one per line or comma separated) or a list.' });
    }
    if (typeof input === 'string' && input.length > 20000) {
      return res.status(400).json({ code: 'INVALID_TESTER_PHONES', message: 'That list is too long.' });
    }
    const { phones, invalid } = au.parseTesterPhones(input === undefined ? '' : input);
    if (invalid.length) {
      return res.status(400).json({
        code: 'INVALID_TESTER_PHONES',
        invalid: invalid.slice(0, 50),
        message: `${invalid.length === 1 ? 'This is not' : 'These are not'} a 10-digit Indian mobile number: ${invalid.slice(0, 10).join(', ')}${invalid.length > 10 ? ' …' : ''}`,
      });
    }
    if (phones.length > au.MAX_TESTERS) {
      return res.status(400).json({ code: 'TOO_MANY_TESTERS', message: `At most ${au.MAX_TESTERS} tester numbers.` });
    }

    const before = await au.readTesterList();
    if (typeof body.ifUpdatedAt === 'string' && body.ifUpdatedAt && before.updatedAt && !sameTime(before.updatedAt, body.ifUpdatedAt)) {
      return res.status(409).json({ code: 'CONFIG_CONFLICT', message: 'Someone else changed the tester list since you loaded it. Reload and make your change again.' });
    }
    const added = phones.filter((p) => !before.phones.includes(p));
    const removed = before.phones.filter((p) => !phones.includes(p));
    if (!added.length && !removed.length && before.updatedAt) {
      return res.json({ ...(await au.testerStatus()), changed: false });
    }

    const GlobalConfig = require('../models/GlobalConfig').getGlobalConfigModel();
    await GlobalConfig.upsert({ key: au.TESTERS_KEY, value: { phones }, description: 'Play closed testers (phone numbers). Edit on Active testers.' });
    try {
      await require('../models/VerificationLog').getVerificationLogModel().create({
        adminId: adminOf(req),
        targetId: 'closed_testers',
        action: 'CLOSED_TESTERS_UPDATED',
        details: JSON.stringify({ count: phones.length, added: added.map(mask), removed: removed.map(mask) }).slice(0, 8000),
      });
    } catch (e) { console.error('[AUDIT_LOG_ERROR]', e.message); }
    res.json({ ...(await au.testerStatus()), changed: true, added: added.length, removed: removed.length });
  } catch (err) {
    sendServerError(res, err, '[ACTIVE_TESTERS_SAVE_ERROR]');
  }
});

module.exports = router;
