// Co-Ride regular rides: /api/bikepool/templates (mounted in server.js before /api/bikepool).
// Signed-in students manage their own templates only; another user's id answers 404. The 5-minute job
// (services/coRideTemplates.publishDueTemplates) publishes the actual rides.
const express = require('express');
const { Op } = require('sequelize');
const { protect } = require('../middleware/authMiddleware');
const { getRideTemplateModel } = require('../models/RideTemplate');
const { getRideTemplateRunModel } = require('../models/RideTemplateRun');
const { getUserModel } = require('../models/User');
const { sendServerError } = require('../utils/httpErrors');
const T = require('../services/coRideTemplates');

const router = express.Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_FOUND = { code: 'NOT_FOUND', message: 'Regular ride not found.' };
router.param('id', (req, res, next, id) => (UUID_RE.test(String(id || '')) ? next() : res.status(404).json(NOT_FOUND)));

const fail = (res, e) => res.status(e.status).json({ code: e.code, field: e.field, message: e.message });
const own = (req) => getRideTemplateModel().findOne({ where: { id: req.params.id, creatorId: req.user.id } });
const reply = async (t) => T.serializeTemplate(t, { runs: await T.runsFor([t.id]) });

// GET /api/bikepool/templates -> { templates: [...] }
router.get('/', protect, async (req, res) => {
  try {
    const rows = await getRideTemplateModel().findAll({ where: { creatorId: req.user.id }, order: [['createdAt', 'ASC']], limit: 50 });
    const runs = await T.runsFor(rows.map((r) => r.id));
    res.json({ templates: rows.map((t) => T.serializeTemplate(t, { runs })) });
  } catch (err) {
    sendServerError(res, err, '[RIDE_TEMPLATE_LIST_ERROR]');
  }
});

// POST /api/bikepool/templates -> 201 { template }
router.post('/', protect, async (req, res) => {
  try {
    const RideTemplate = getRideTemplateModel();
    const host = await getUserModel().findByPk(req.user.id, { attributes: ['id', 'gender'] });
    if (!host) return res.status(404).json({ message: 'User not found.' });
    const { value, error } = T.validateTemplateInput(req.body, { partial: false, host });
    if (error) return fail(res, error);
    const count = await RideTemplate.count({ where: { creatorId: host.id } });
    if (count >= T.MAX_TEMPLATES_PER_USER) {
      return res.status(400).json({ code: 'TEMPLATE_LIMIT', message: `You can save up to ${T.MAX_TEMPLATES_PER_USER} regular rides. Delete one first.` });
    }
    const t = await RideTemplate.create({ ...value, creatorId: host.id, active: value.active !== false, skipDates: value.skipDates || [] });
    res.status(201).json({ template: await reply(t) });
  } catch (err) {
    sendServerError(res, err, '[RIDE_TEMPLATE_CREATE_ERROR]');
  }
});

// PATCH /api/bikepool/templates/:id -> { template }   (any subset of the create fields; future rides only)
router.patch('/:id', protect, async (req, res) => {
  try {
    const t = await own(req);
    if (!t) return res.status(404).json(NOT_FOUND);
    const host = await getUserModel().findByPk(req.user.id, { attributes: ['id', 'gender'] });
    const { value, error } = T.validateTemplateInput(req.body, { partial: true, current: t, host });
    if (error) return fail(res, error);
    await t.update(value);
    res.json({ template: await reply(t) });
  } catch (err) {
    sendServerError(res, err, '[RIDE_TEMPLATE_UPDATE_ERROR]');
  }
});

// DELETE /api/bikepool/templates/:id -> { ok: true, id }   (rides already published stay as they are)
router.delete('/:id', protect, async (req, res) => {
  try {
    const t = await own(req);
    if (!t) return res.status(404).json(NOT_FOUND);
    await t.destroy();
    res.json({ ok: true, id: t.id });
  } catch (err) {
    sendServerError(res, err, '[RIDE_TEMPLATE_DELETE_ERROR]');
  }
});

// POST /api/bikepool/templates/:id/skip { date: 'YYYY-MM-DD' } -> { template, cancelledRideId }
// No ride is published for that IST date; if it was published already (still open) it is cancelled and
// its riders are told.
router.post('/:id/skip', protect, async (req, res) => {
  try {
    const t = await own(req);
    if (!t) return res.status(404).json(NOT_FOUND);
    const date = req.body && req.body.date;
    const msg = T.validateSkipDate(date);
    if (msg) return res.status(400).json({ code: 'INVALID_DATE', field: 'date', message: msg });
    const today = require('../utils/istTime').istYmd();
    const skips = [...new Set([...(t.skipDates || []), date])].filter((d) => d >= today).sort().slice(0, T.MAX_SKIP_DATES);
    await t.update({ skipDates: skips });
    const run = await getRideTemplateRunModel().findOne({ where: { templateId: t.id, rideDate: date, poolId: { [Op.ne]: null } } });
    const cancelledRideId = run ? await T.cancelPublishedRide(run.poolId, req.user.id) : null;
    res.json({ template: await reply(t), cancelledRideId });
  } catch (err) {
    sendServerError(res, err, '[RIDE_TEMPLATE_SKIP_ERROR]');
  }
});

// POST /api/bikepool/templates/:id/pause | /resume -> { template }
const setActive = (active) => async (req, res) => {
  try {
    const t = await own(req);
    if (!t) return res.status(404).json(NOT_FOUND);
    await t.update({ active });
    res.json({ template: await reply(t) });
  } catch (err) {
    sendServerError(res, err, '[RIDE_TEMPLATE_ACTIVE_ERROR]');
  }
};
router.post('/:id/pause', protect, setActive(false));
router.post('/:id/resume', protect, setActive(true));

module.exports = router;
