// "ZenWe update available" push (utils/appUpdateNotify), mounted at /api/admin/app-update inside routes/adminRoutes
// (after protect + admin, so only a signed-in admin reaches it).
//   GET  /notify?version=x.y.z           how many customers are on an older version + the last send for it
//   POST /notify { minVersion?, confirmResend? }   sends once per version (409 ALREADY_SENT without confirmResend)
const express = require('express');
const aun = require('../utils/appUpdateNotify');
const { sendServerError } = require('../utils/httpErrors');

const router = express.Router();
router.use((req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });

const adminOf = (req) => (req.user && req.user.id ? String(req.user.id) : 'admin_default');
const fail = (res, err, tag) => {
  if (err instanceof aun.NotifyError) return res.status(err.status).json({ code: err.code, message: err.message, ...err.extra });
  return sendServerError(res, err, tag);
};

router.get('/notify', async (req, res) => {
  try {
    const v = req.query && typeof req.query.version === 'string' ? req.query.version : undefined;
    res.json(await aun.preview({ version: v }));
  } catch (err) {
    fail(res, err, '[APP_UPDATE_PREVIEW_ERROR]');
  }
});

router.post('/notify', async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (body.minVersion !== undefined && body.minVersion !== null && typeof body.minVersion !== 'string') {
      return res.status(400).json({ code: 'INVALID_VERSION', message: 'Give the version as x.y.z, for example 1.0.68.' });
    }
    if (body.confirmResend !== undefined && typeof body.confirmResend !== 'boolean') {
      return res.status(400).json({ code: 'INVALID_CONFIRM', message: 'confirmResend must be true or false.' });
    }
    res.json(await aun.notify({ minVersion: body.minVersion, confirmResend: body.confirmResend === true, adminId: adminOf(req) }));
  } catch (err) {
    fail(res, err, '[APP_UPDATE_NOTIFY_ERROR]');
  }
});

module.exports = router;
