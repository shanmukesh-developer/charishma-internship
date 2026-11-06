// Revenue (owner, 6 Nov 2026), mounted at /api/admin/revenue inside routes/adminRoutes (after protect + admin, so
// only a signed-in admin reaches it). Rules and definitions: utils/revenueReport.js.
//   GET  /                    ?period=day|week|month&date=YYYY-MM-DD&storeId=   the report (read-only)
//   GET  /settle/preview      ?cycle=daily|weekly|monthly                         what Settle all would create
//   POST /settle              { cycle, cutoff, planHash?, expected: [{ storeId, orderCount, netPaise }] }
//   POST /settle/mark-paid    { items: [{ payoutId, utr, method? }] }            one reference per statement
//   PUT  /stores/:id/cycle    { cycle }                                          audited
// Nothing here moves money: statements are records; the admin pays from the bank / UPI and enters the reference.
const express = require('express');
const revenue = require('../utils/revenueReport');
const payouts = require('../utils/payouts');
const { sendServerError } = require('../utils/httpErrors');

const router = express.Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const seqOf = () => require('../models/Order').getOrderModel().sequelize;
const adminOf = (req) => (req.user && req.user.id ? String(req.user.id) : 'admin_default');

router.use((req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });

const audit = async (req, targetId, action, details) => {
  try {
    const VL = require('../models/VerificationLog').getVerificationLogModel();
    if (!VL) return;
    await VL.create({ adminId: adminOf(req), targetId: String(targetId || 'global'), action, details: JSON.stringify(details).slice(0, 8000) });
  } catch (err) {
    console.error('[AUDIT_LOG_ERROR]', err.message);
  }
};

const reply = (res, error, tag) => {
  if (payouts.isPayoutError(error)) {
    const { status, code, name, stack, ...extra } = error; // eslint-disable-line no-unused-vars
    return res.status(status).json({ code, message: error.message, ...extra });
  }
  return sendServerError(res, error, tag);
};

router.get('/', async (req, res) => {
  try {
    const q = req.query || {};
    const report = await revenue.buildRevenueReport({ sequelize: seqOf(), period: q.period || 'day', date: q.date || null, storeId: q.storeId || null });
    res.json(report);
  } catch (error) {
    reply(res, error, '[REVENUE_REPORT_ERROR]');
  }
});

router.get('/settle/preview', async (req, res) => {
  try {
    res.json(await revenue.settlePreview({ sequelize: seqOf(), cycle: (req.query || {}).cycle }));
  } catch (error) {
    reply(res, error, '[REVENUE_SETTLE_ERROR]');
  }
});

router.post('/settle', async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.cutoff) return res.status(400).json({ code: 'INVALID_INPUT', message: 'Send the cutoff from the preview.' });
    const r = await revenue.settleAll({ sequelize: seqOf(), cycle: body.cycle, cutoff: body.cutoff, expected: body.expected, adminId: adminOf(req) });
    for (const p of r.created) {
      await audit(req, p.partnerId, 'PAYOUT_STATEMENT_CREATED', { payoutId: p.id, partnerType: p.partnerType, orderCount: p.orderCount, netPaise: p.netPaise, via: 'revenue_settle_all', cycle: r.cycle, cutoff: r.cutoff });
    }
    await audit(req, 'global', 'REVENUE_SETTLE_ALL', {
      cycle: r.cycle, cutoff: r.cutoff, planHash: body.planHash || null,
      created: r.created.map((p) => ({ payoutId: p.id, storeId: p.partnerId, orders: p.orderCount, netPaise: p.netPaise })),
      alreadySettled: r.alreadySettled.length, changed: r.changed.length, skipped: r.skipped.length, failed: r.failed.length,
    });
    res.status(r.created.length ? 201 : 200).json({
      message: r.created.length
        ? `${r.created.length} statement${r.created.length === 1 ? '' : 's'} created. Pay each store, then mark it paid with the reference.`
        : 'No new statements: everything up to the cutoff is already on a statement.',
      ...r,
    });
  } catch (error) {
    reply(res, error, '[REVENUE_SETTLE_ERROR]');
  }
});

router.post('/settle/mark-paid', async (req, res) => {
  try {
    const r = await revenue.markAllPaid({ sequelize: seqOf(), items: (req.body || {}).items, adminId: adminOf(req) });
    for (const p of r.paid) {
      await audit(req, p.partnerId, 'PAYOUT_MARKED_PAID', { payoutId: p.id, utr: p.utr, method: p.method, netPaise: p.netPaise, orders: p.settledOrders, via: 'revenue_mark_all_paid' });
    }
    res.json({ message: `${r.paid.length} marked paid${r.alreadyPaid.length ? `, ${r.alreadyPaid.length} already paid` : ''}${r.failed.length ? `, ${r.failed.length} not marked (see each)` : ''}.`, ...r });
  } catch (error) {
    reply(res, error, '[REVENUE_SETTLE_ERROR]');
  }
});

router.put('/stores/:id/cycle', async (req, res) => {
  try {
    if (!UUID_RE.test(String(req.params.id))) return res.status(404).json({ message: 'Store not found.' });
    const cycle = revenue.normalizeCycle((req.body || {}).cycle);
    if (!cycle) return res.status(400).json({ code: 'INVALID_INPUT', message: `Settlement cycle must be one of: ${revenue.SETTLEMENT_CYCLES.join(', ')}.` });
    const Restaurant = seqOf().models.Restaurant;
    const store = await Restaurant.findByPk(req.params.id, { attributes: ['id', 'name', 'settlementCycle'] });
    if (!store) return res.status(404).json({ message: 'Store not found.' });
    const before = revenue.cycleOf(store);
    if (before !== cycle) {
      await Restaurant.update({ settlementCycle: cycle }, { where: { id: store.id } });
      await audit(req, store.id, 'STORE_SETTLEMENT_CYCLE_UPDATED', { name: store.name, from: before, to: cycle });
    }
    res.json({ storeId: String(store.id), name: store.name, settlementCycle: cycle, changed: before !== cycle });
  } catch (error) {
    reply(res, error, '[REVENUE_CYCLE_ERROR]');
  }
});

module.exports = router;
