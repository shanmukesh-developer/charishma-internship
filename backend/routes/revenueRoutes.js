// Revenue (owner, 6 Nov 2026), mounted at /api/admin/revenue inside routes/adminRoutes (after protect + admin, so
// only a signed-in admin reaches it). Rules and definitions: utils/revenueReport.js.
//   GET  /                    ?period=day|week|month&date=YYYY-MM-DD&storeId=   the report (read-only)
//   GET  /settle/preview      ?cycle=daily|weekly|monthly                         what Settle all would create
//   POST /settle              { cycle, cutoff, planHash?, expected: [{ storeId, orderCount, netPaise }] }
//   POST /settle/mark-paid    { items: [{ payoutId, utr, method? }] }            one reference per statement
//   PUT  /stores/:id/cycle    { cycle }                                          audited
//   GET  /stores/:id/payment-details[?reveal=1]   UPI + bank details (masked; reveal=1 adds the full account
//                                                 number, audited STORE_BANK_DETAILS_REVEALED)
// Payment details are edited through PUT /api/admin/restaurants/:id/compliance (utils/storeCompliance: validated,
// account number twice, audited masked).
// Nothing here moves money: statements are records; the admin pays from the bank / UPI and enters the reference.
// The two POSTs take an Idempotency-Key header (utils/idempotency): the admin page sends one key per action and
// reuses it on retry, so a retry after a dropped connection gets the first answer again (duplicate: true) instead of
// running twice; while the first is still running a retry gets 409 SETTLE_IN_PROGRESS. Both actions are also safe
// to repeat on their own (orders are claimed once; the same reference on a paid statement is "already paid").
const express = require('express');
const revenue = require('../utils/revenueReport');
const payouts = require('../utils/payouts');
const { sendServerError } = require('../utils/httpErrors');

const { readIdempotencyKey, claim } = require('../utils/idempotency');

const router = express.Router();

// Runs `handler` once per (scope, admin, Idempotency-Key). handler(req) -> { status, body }.
const once = (scope, handler) => async (req, res) => {
  const key = readIdempotencyKey(req, (req.body || {}).idempotencyKey);
  let slot;
  try {
    slot = await claim(scope, adminOf(req), key);
  } catch {
    slot = { state: 'new', async finish() {}, async release() {} };
  }
  if (slot.state === 'busy') return res.status(409).json({ code: 'SETTLE_IN_PROGRESS', message: 'This is still being saved. Wait a few seconds, then refresh.' });
  if (slot.state === 'done') return res.status(slot.status).json({ ...slot.body, duplicate: true });
  try {
    const { status, body } = await handler(req);
    if (status < 400) await slot.finish(status, body);
    else await slot.release(); // a refusal is not remembered: fixing the input and retrying may go through
    return res.status(status).json(body);
  } catch (error) {
    await slot.release(); // nothing was answered: the same key may run again
    return reply(res, error, '[REVENUE_SETTLE_ERROR]');
  }
};
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

router.post('/settle', once('revenue_settle', async (req) => {
  const body = req.body || {};
  if (!body.cutoff) return { status: 400, body: { code: 'INVALID_INPUT', message: 'Send the cutoff from the preview.' } };
  const r = await revenue.settleAll({ sequelize: seqOf(), cycle: body.cycle, cutoff: body.cutoff, expected: body.expected, adminId: adminOf(req) });
  for (const p of r.created) {
    await audit(req, p.partnerId, 'PAYOUT_STATEMENT_CREATED', { payoutId: p.id, partnerType: p.partnerType, orderCount: p.orderCount, netPaise: p.netPaise, via: 'revenue_settle_all', cycle: r.cycle, cutoff: r.cutoff });
  }
  await audit(req, 'global', 'REVENUE_SETTLE_ALL', {
    cycle: r.cycle, cutoff: r.cutoff, planHash: body.planHash || null,
    created: r.created.map((p) => ({ payoutId: p.id, storeId: p.partnerId, orders: p.orderCount, netPaise: p.netPaise })),
    alreadySettled: r.alreadySettled.length, changed: r.changed.length, skipped: r.skipped.length, failed: r.failed.length,
  });
  return {
    status: r.created.length ? 201 : 200,
    body: {
      message: r.created.length
        ? `${r.created.length} statement${r.created.length === 1 ? '' : 's'} created. Pay each store, then mark it paid with the reference.`
        : 'No new statements: everything up to the cutoff is already on a statement.',
      ...r,
    },
  };
}));

router.post('/settle/mark-paid', once('revenue_mark_paid', async (req) => {
  const r = await revenue.markAllPaid({ sequelize: seqOf(), items: (req.body || {}).items, adminId: adminOf(req) });
  for (const p of r.paid) {
    await audit(req, p.partnerId, 'PAYOUT_MARKED_PAID', { payoutId: p.id, utr: p.utr, method: p.method, netPaise: p.netPaise, orders: p.settledOrders, via: 'revenue_mark_all_paid' });
  }
  return { status: 200, body: { message: `${r.paid.length} marked paid${r.alreadyPaid.length ? `, ${r.alreadyPaid.length} already paid` : ''}${r.failed.length ? `, ${r.failed.length} not marked (see each)` : ''}.`, ...r } };
}));

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

router.get('/stores/:id/payment-details', async (req, res) => {
  try {
    if (!UUID_RE.test(String(req.params.id))) return res.status(404).json({ message: 'Store not found.' });
    const comp = require('../utils/storeCompliance');
    const Restaurant = seqOf().models.Restaurant;
    const attrs = comp.PAYMENT_ATTRS.filter((a) => Restaurant.rawAttributes[a]);
    const store = await Restaurant.findByPk(req.params.id, { attributes: ['id', 'name', ...attrs], raw: true });
    if (!store) return res.status(404).json({ message: 'Store not found.' });
    const out = { storeId: String(store.id), name: store.name, ...comp.paymentDetails(store) };
    const reveal = ['1', 'true'].includes(String((req.query || {}).reveal || ''));
    if (reveal) {
      const full = require('../utils/payoutSecrets').decryptAccount(store.bankAccountNumberEnc);
      out.bankAccountNumber = full;
      out.revealProblem = store.bankAccountNumberEnc && !full ? 'The saved account number cannot be read (the encryption key changed). Enter it again.' : null;
      await audit(req, store.id, 'STORE_BANK_DETAILS_REVEALED', { name: store.name, account: comp.maskAccountNo(store.bankAccountLast4), via: 'revenue_payment_details' });
    }
    res.json(out);
  } catch (error) {
    reply(res, error, '[REVENUE_PAYMENT_DETAILS_ERROR]');
  }
});

module.exports = router;
