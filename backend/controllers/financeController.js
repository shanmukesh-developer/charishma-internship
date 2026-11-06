// C6 finance endpoints:
//   Admin  /api/admin/rider-cash ...  holdings, per-rider ledger, record deposit / adjustment, reconcile,
//                                      record a missing COD cash row (admin action, never automatic)
//   Admin  /api/admin/payouts ...     pending partners, statement preview -> create, mark paid (UTR),
//                                      cancel, history, one statement
//   Rider  /api/delivery/cash, /cash/entries, /payouts      cash held + limit + net position, history
//   Store  /api/restaurants/:id/payouts                        the store's own statements (API only)
const orderNumbers = require('../utils/orderNumbers');
const { Op, Transaction } = require('sequelize');
const riderCash = require('../utils/riderCash');
const payouts = require('../utils/payouts');
const { earningPaise, toPaise } = require('../utils/riderEarnings');
const { sendServerError } = require('../utils/httpErrors');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONEY_TX = { type: Transaction.TYPES.IMMEDIATE };
const seqOf = () => require('../models/Order').getOrderModel().sequelize;
const adminOf = (req) => (req.user && req.user.id ? String(req.user.id) : 'admin_default');
const toRupees = (p) => Math.round(Number(p) || 0) / 100;

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
  if (riderCash.isCashError(error)) {
    const status = error.code === 'RIDER_NOT_FOUND' ? 404 : error.code === 'LEDGER_NOT_READY' ? 503 : error.code === 'NOT_ENOUGH_CASH' ? 409 : 400;
    return res.status(status).json({ code: error.code, message: error.message, ...(error.balancePaise !== undefined ? { balancePaise: error.balancePaise } : {}) });
  }
  return sendServerError(res, error, tag);
};

// Unsettled earnings (orders not paid out and not on a statement) + tips, for the net position view.
const owedToRider = async (sequelize, riderId) => {
  const Order = sequelize.models.Order;
  const rows = await Order.findAll({
    where: { deliveryPartnerId: riderId, status: 'Delivered', riderPayoutSettled: { [Op.not]: true } },
    attributes: ['id', 'deliveryFee', 'fulfilment', 'riderPayoutId'], raw: true,
  });
  const unsettled = rows.reduce((s, o) => s + earningPaise(o), 0);
  const onStatement = rows.filter((o) => o.riderPayoutId).reduce((s, o) => s + earningPaise(o), 0);
  return { earningsPaise: unsettled, onPendingStatementPaise: onStatement, orders: rows.length };
};

const netPosition = ({ cashHeldPaise, earningsPaise, tipsPaise }) => {
  const owes = earningsPaise + tipsPaise;
  const net = owes - cashHeldPaise;
  return {
    cashHeldPaise, cashHeld: toRupees(cashHeldPaise),
    zenvyOwesPaise: owes, zenvyOwes: toRupees(owes),
    earningsPaise, earnings: toRupees(earningsPaise),
    tipsPaise, tips: toRupees(tipsPaise),
    netPaise: net, net: toRupees(net),
    // + : Zenvy owes the rider; - : the rider owes Zenvy. Nothing is deducted automatically.
    direction: net > 0 ? 'zenvy_owes_rider' : net < 0 ? 'rider_owes_zenvy' : 'settled',
  };
};

// ── Admin: rider cash ────────────────────────────────────────────────────────────────────────────
// GET /api/admin/rider-cash   every rider holding cash or with cash history, plus the limit.
exports.getRiderCashHoldings = async (req, res) => {
  try {
    const sequelize = seqOf();
    const limitPaise = await riderCash.getCashLimitPaise(sequelize);
    const CE = sequelize.models.RiderCashEntry;
    const last = await CE.findAll({
      attributes: ['riderId', [sequelize.fn('MAX', sequelize.col('createdAt')), 'lastAt'], [sequelize.fn('COUNT', sequelize.col('id')), 'n']],
      group: ['riderId'], raw: true,
    });
    const lastDeposits = await CE.findAll({
      where: { type: riderCash.TYPES.CASH_DEPOSITED },
      attributes: ['riderId', [sequelize.fn('MAX', sequelize.col('createdAt')), 'lastAt']],
      group: ['riderId'], raw: true,
    });
    const lastMap = new Map(last.map((r) => [String(r.riderId), r]));
    const depMap = new Map(lastDeposits.map((r) => [String(r.riderId), r.lastAt]));
    const ids = [...lastMap.keys()].filter((id) => UUID_RE.test(id));
    const riders = await sequelize.models.DeliveryPartner.findAll({
      where: { [Op.or]: [{ id: { [Op.in]: ids } }, { cashHeldPaise: { [Op.ne]: 0 } }] },
      attributes: ['id', 'name', 'phone', 'isOnline', 'isApproved', 'cashHeldPaise', 'walletBalance'], raw: true,
    });
    const owedRows = await sequelize.models.Order.findAll({
      where: { deliveryPartnerId: { [Op.in]: riders.map((r) => r.id) }, status: 'Delivered', riderPayoutSettled: { [Op.not]: true } },
      attributes: ['deliveryPartnerId', 'deliveryFee', 'fulfilment'], raw: true,
    });
    const owed = new Map();
    for (const o of owedRows) owed.set(String(o.deliveryPartnerId), (owed.get(String(o.deliveryPartnerId)) || 0) + earningPaise(o));
    const rows = riders.map((r) => {
      const held = Number(r.cashHeldPaise) || 0;
      const st = riderCash.cashStatus(held, limitPaise);
      const pos = netPosition({ cashHeldPaise: held, earningsPaise: owed.get(String(r.id)) || 0, tipsPaise: Math.max(0, toPaise(r.walletBalance)) });
      return {
        riderId: String(r.id), name: r.name, phone: r.phone, isOnline: !!r.isOnline, isApproved: !!r.isApproved,
        ...st, entries: Number(lastMap.get(String(r.id))?.n) || 0, lastEntryAt: lastMap.get(String(r.id))?.lastAt || null,
        lastDepositAt: depMap.get(String(r.id)) || null, position: pos,
      };
    }).sort((a, b) => b.cashHeldPaise - a.cashHeldPaise);
    res.set('Cache-Control', 'no-store');
    res.json({
      limitPaise, limit: toRupees(limitPaise), limitEnabled: limitPaise > 0,
      totalHeldPaise: rows.reduce((s, r) => s + r.cashHeldPaise, 0),
      overLimitCount: rows.filter((r) => r.overLimit).length,
      ledgerStart: (await riderCash.readStart(sequelize))?.toISOString() || null,
      riders: rows,
      reconcile: riderCash.reconcileStatus(),
    });
  } catch (error) {
    reply(res, error, '[RIDER_CASH_ERROR]');
  }
};

// GET /api/admin/rider-cash/:riderId/entries?page=&limit=
exports.getRiderCashEntries = async (req, res) => {
  try {
    const { riderId } = req.params;
    if (!UUID_RE.test(String(riderId))) return res.status(404).json({ message: 'Rider not found.' });
    const sequelize = seqOf();
    const rider = await sequelize.models.DeliveryPartner.findByPk(riderId, { attributes: ['id', 'name', 'phone', 'cashHeldPaise', 'walletBalance'], raw: true });
    if (!rider) return res.status(404).json({ message: 'Rider not found.' });
    const { rows, page, limit, hasMore } = await riderCash.listFor({ sequelize, riderId, page: req.query.page, limit: req.query.limit });
    const ledgerPaise = Number(await sequelize.models.RiderCashEntry.sum('amountPaise', { where: { riderId: String(riderId) } })) || 0;
    const held = Number(rider.cashHeldPaise) || 0;
    const owed = await owedToRider(sequelize, riderId);
    res.set('Cache-Control', 'no-store');
    res.json({
      rider: { id: rider.id, name: rider.name, phone: rider.phone },
      ...riderCash.cashStatus(held, await riderCash.getCashLimitPaise(sequelize)),
      ledgerPaise, inSync: ledgerPaise === held,
      position: netPosition({ cashHeldPaise: held, earningsPaise: owed.earningsPaise, tipsPaise: Math.max(0, toPaise(rider.walletBalance)) }),
      entries: rows.map(riderCash.toAdmin), page, limit, hasMore,
    });
  } catch (error) {
    reply(res, error, '[RIDER_CASH_ERROR]');
  }
};

const amountPaiseFrom = (body) => {
  if (body.amountPaise !== undefined && body.amountPaise !== null && body.amountPaise !== '') {
    const n = Number(body.amountPaise);
    return Number.isSafeInteger(n) ? n : NaN;
  }
  const r = Number(body.amount);
  return Number.isFinite(r) ? toPaise(r) : NaN;
};

// POST /api/admin/rider-cash/:riderId/deposit  { amount (₹) | amountPaise, method: cash|upi, reference, note?, idempotencyKey? }
exports.recordRiderDeposit = async (req, res) => {
  try {
    const { riderId } = req.params;
    if (!UUID_RE.test(String(riderId))) return res.status(404).json({ message: 'Rider not found.' });
    const body = req.body || {};
    const paise = amountPaiseFrom(body);
    if (!Number.isSafeInteger(paise) || paise <= 0 || paise > 10000000) return res.status(400).json({ code: 'INVALID_INPUT', message: 'Enter the deposited amount (more than ₹0).' });
    const key = String(body.idempotencyKey || req.get('Idempotency-Key') || '').trim().slice(0, 120);
    const sequelize = seqOf();
    const result = await sequelize.transaction(MONEY_TX, (t) => riderCash.applyCashChange({
      t, riderId, amountPaise: -paise, type: riderCash.TYPES.CASH_DEPOSITED, method: body.method, reference: body.reference,
      actor: { type: 'admin', id: adminOf(req) }, reason: body.note ? String(body.note) : null, idempotencyKey: key ? `deposit:${key}` : null,
    }));
    if (result.applied) await audit(req, riderId, 'RIDER_CASH_DEPOSIT', { riderId, amountPaise: paise, method: body.method, reference: body.reference, balanceAfterPaise: result.balancePaise });
    res.status(result.duplicate ? 200 : 201).json({
      message: result.duplicate ? 'This deposit was already recorded.' : `Deposit of ₹${toRupees(paise)} recorded.`,
      duplicate: result.duplicate, entry: riderCash.toAdmin(result.row), cashHeldPaise: result.balancePaise, cashHeld: toRupees(result.balancePaise),
    });
  } catch (error) {
    reply(res, error, '[RIDER_CASH_ERROR]');
  }
};

// POST /api/admin/rider-cash/:riderId/adjust  { amountPaise (signed) | amount (₹ signed), reason (>= 5 chars), idempotencyKey? }
exports.adjustRiderCash = async (req, res) => {
  try {
    const { riderId } = req.params;
    if (!UUID_RE.test(String(riderId))) return res.status(404).json({ message: 'Rider not found.' });
    const body = req.body || {};
    const paise = amountPaiseFrom(body);
    if (!Number.isSafeInteger(paise) || paise === 0 || Math.abs(paise) > 10000000) return res.status(400).json({ code: 'INVALID_INPUT', message: 'Enter a non-zero amount (positive adds to the cash held, negative reduces it).' });
    const key = String(body.idempotencyKey || req.get('Idempotency-Key') || '').trim().slice(0, 120);
    const sequelize = seqOf();
    const result = await sequelize.transaction(MONEY_TX, (t) => riderCash.applyCashChange({
      t, riderId, amountPaise: paise, type: riderCash.TYPES.ADJUSTMENT, actor: { type: 'admin', id: adminOf(req) },
      reason: body.reason, idempotencyKey: key ? `adjust:${key}` : null,
    }));
    if (result.applied) await audit(req, riderId, 'RIDER_CASH_ADJUST', { riderId, amountPaise: paise, reason: body.reason, balanceAfterPaise: result.balancePaise });
    res.status(result.duplicate ? 200 : 201).json({
      message: result.duplicate ? 'This adjustment was already recorded.' : 'Adjustment recorded.',
      duplicate: result.duplicate, entry: riderCash.toAdmin(result.row), cashHeldPaise: result.balancePaise, cashHeld: toRupees(result.balancePaise),
    });
  } catch (error) {
    reply(res, error, '[RIDER_CASH_ERROR]');
  }
};

// GET /api/admin/rider-cash/reconcile?limit=   read-only check (same as the daily job).
exports.getRiderCashReconcile = async (req, res) => {
  try {
    const r = await riderCash.reconcile({ sequelize: seqOf(), limit: req.query.limit });
    res.set('Cache-Control', 'no-store');
    res.json({ ...r, status: riderCash.reconcileStatus() });
  } catch (error) {
    reply(res, error, '[RIDER_CASH_ERROR]');
  }
};

// POST /api/admin/rider-cash/orders/:orderId/record  { reason }   The reconcile check found a COD order
// delivered after the ledger start with no cash row (e.g. delivered by an old process during a deploy):
// the admin records it after checking with the rider. Idempotent (same key as the delivery path).
exports.recordMissingCodRow = async (req, res) => {
  try {
    const { orderId } = req.params;
    if (!UUID_RE.test(String(orderId))) return res.status(404).json({ message: 'Order not found.' });
    const reason = String((req.body || {}).reason || '').trim();
    if (reason.length < 5) return res.status(400).json({ code: 'REASON_REQUIRED', message: 'Give a reason (at least 5 characters).' });
    const sequelize = seqOf();
    const order = await sequelize.models.Order.findByPk(orderId, { attributes: ['id', 'status', 'deliveredAt', 'updatedAt', 'paymentMethod', 'deliveryPartnerId', 'fulfilment', 'finalPrice'], raw: true });
    if (!order) return res.status(404).json({ message: 'Order not found.' });
    if (order.status !== 'Delivered' || !riderCash.isCodCashOrder(order)) return res.status(400).json({ code: 'NOT_A_COD_DELIVERY', message: 'Only a delivered COD order with a rider has a cash row.' });
    const start = await riderCash.readStart(sequelize);
    const at = new Date(order.deliveredAt || order.updatedAt);
    if (!start || at < start) return res.status(400).json({ code: 'BEFORE_LEDGER_START', message: 'This order was delivered before the cash ledger started; record any cash still held with an adjustment.' });
    const result = await sequelize.transaction(MONEY_TX, (t) => riderCash.recordCodDelivery({ t, orderId, actor: { type: 'admin', id: adminOf(req) } }));
    await audit(req, orderId, 'RIDER_CASH_COD_RECORDED', { orderId, riderId: order.deliveryPartnerId, reason, ...result });
    res.json({ message: 'Cash row recorded (or already present).', ...result });
  } catch (error) {
    reply(res, error, '[RIDER_CASH_ERROR]');
  }
};

// ── Admin: payouts ───────────────────────────────────────────────────────────────────────────────
// GET /api/admin/payouts/pending?partnerType=restaurant|vendor|rider|store
exports.getPendingPayouts = async (req, res) => {
  try {
    const partnerType = String(req.query.partnerType || 'store');
    if (!['restaurant', 'vendor', 'rider', 'store'].includes(partnerType)) return res.status(400).json({ code: 'INVALID_INPUT', message: 'partnerType must be restaurant, vendor, rider or store.' });
    const rows = await payouts.pendingPartners({ sequelize: seqOf(), partnerType });
    res.set('Cache-Control', 'no-store');
    res.json({ partnerType, asOf: new Date().toISOString(), partners: rows });
  } catch (error) {
    reply(res, error, '[PAYOUT_ERROR]');
  }
};

const statementArgs = (src) => ({
  partnerType: String(src.partnerType || ''),
  partnerId: String(src.partnerId || ''),
  from: payouts.parseDate(src.from || src.periodStart, 'from'),
  to: payouts.parseDate(src.to || src.periodEnd, 'to'),
  includeTips: !(src.includeTips === false || src.includeTips === 'false' || src.includeTips === '0'),
});

// GET /api/admin/payouts/preview?partnerType=&partnerId=&from=&to=&includeTips=
exports.previewPayout = async (req, res) => {
  try {
    const a = statementArgs(req.query || {});
    if (a.to && a.to.getTime() > Date.now() + 60 * 1000) return res.status(400).json({ code: 'INVALID_INPUT', message: 'The period cannot end in the future.' });
    const s = await payouts.buildStatement({ sequelize: seqOf(), ...a });
    res.set('Cache-Control', 'no-store');
    res.json(payouts.statementJson(s));
  } catch (error) {
    reply(res, error, '[PAYOUT_ERROR]');
  }
};

// POST /api/admin/payouts  { partnerType, partnerId, from?, to (the preview's periodEnd), includeTips?, expectedOrders, expectedNetPaise, notes? }
exports.createPayout = async (req, res) => {
  try {
    const body = req.body || {};
    const a = statementArgs(body);
    if (!a.to) return res.status(400).json({ code: 'INVALID_INPUT', message: 'Send the period end (the preview\'s periodEnd).' });
    if (a.to.getTime() > Date.now() + 60 * 1000) return res.status(400).json({ code: 'INVALID_INPUT', message: 'The period cannot end in the future.' });
    if (body.expectedOrders === undefined || body.expectedNetPaise === undefined) return res.status(400).json({ code: 'INVALID_INPUT', message: 'Preview the statement first (expectedOrders and expectedNetPaise are required).' });
    const p = await payouts.createStatement({ sequelize: seqOf(), ...a, expectedOrders: body.expectedOrders, expectedNetPaise: body.expectedNetPaise, adminId: adminOf(req), notes: body.notes });
    await audit(req, p.partnerId, 'PAYOUT_STATEMENT_CREATED', { payoutId: p.id, partnerType: p.partnerType, orderCount: p.orderCount, netPaise: p.netPaise });
    res.status(201).json({ message: 'Statement saved. Mark it paid once the money has moved.', payout: payouts.payoutJson(p) });
  } catch (error) {
    reply(res, error, '[PAYOUT_ERROR]');
  }
};

// POST /api/admin/payouts/:id/mark-paid  { utr (required), method?: bank|upi|cash|other, paidAt?, notes? }
exports.markPayoutPaid = async (req, res) => {
  try {
    const body = req.body || {};
    const r = await payouts.markPaid({ sequelize: seqOf(), payoutId: req.params.id, utr: body.utr, method: body.method, paidAt: body.paidAt, notes: body.notes, adminId: adminOf(req) });
    if (!r.alreadyPaid) await audit(req, r.payout.partnerId, 'PAYOUT_MARKED_PAID', { payoutId: r.payout.id, utr: r.payout.utr, method: r.payout.method, netPaise: r.payout.netPaise, orders: r.settledOrders });
    res.json({ message: r.alreadyPaid ? 'Already marked paid with this UTR.' : 'Payout marked paid.', alreadyPaid: r.alreadyPaid, payout: payouts.payoutJson(r.payout) });
  } catch (error) {
    reply(res, error, '[PAYOUT_ERROR]');
  }
};

// POST /api/admin/payouts/:id/cancel  { reason }
exports.cancelPayout = async (req, res) => {
  try {
    const r = await payouts.cancelStatement({ sequelize: seqOf(), payoutId: req.params.id, reason: (req.body || {}).reason, adminId: adminOf(req) });
    await audit(req, r.payout.partnerId, 'PAYOUT_CANCELLED', { payoutId: r.payout.id, releasedOrders: r.releasedOrders, reason: (req.body || {}).reason });
    res.json({ message: `Statement cancelled; ${r.releasedOrders} order(s) can go on a new one.`, releasedOrders: r.releasedOrders, payout: payouts.payoutJson(r.payout) });
  } catch (error) {
    reply(res, error, '[PAYOUT_ERROR]');
  }
};

// GET /api/admin/payouts?partnerType=&partnerId=&status=&from=&to=&page=&limit=
exports.listPayouts = async (req, res) => {
  try {
    const q = req.query || {};
    const r = await payouts.listPayouts({ sequelize: seqOf(), partnerType: q.partnerType || null, partnerId: q.partnerId || null, status: q.status || null, from: q.from, to: q.to, page: q.page, limit: q.limit });
    res.set('Cache-Control', 'no-store');
    res.json({ payouts: r.rows.map((p) => payouts.payoutJson(p)), page: r.page, limit: r.limit, hasMore: r.hasMore });
  } catch (error) {
    reply(res, error, '[PAYOUT_ERROR]');
  }
};

// GET /api/admin/payouts/:id   one statement with its order lines.
exports.getPayout = async (req, res) => {
  try {
    if (!UUID_RE.test(String(req.params.id))) return res.status(404).json({ message: 'Payout not found.' });
    const sequelize = seqOf();
    const p = await sequelize.models.Payout.findByPk(req.params.id);
    if (!p) return res.status(404).json({ message: 'Payout not found.' });
    const col = p.partnerType === 'rider' ? 'riderPayoutId' : 'payoutId';
    const orders = await sequelize.models.Order.findAll({
      where: { [col]: p.id },
      attributes: ['id', 'deliveredAt', 'updatedAt', 'totalPrice', 'finalPrice', 'deliveryFee', 'fulfilment', 'paymentMethod', 'commissionRate', 'commissionType', 'commissionAmountPaise', 'storeNetPaise'],
      order: [['deliveredAt', 'ASC']], raw: true,
    });
    const lines = orders.map((o) => (p.partnerType === 'rider'
      ? { id: o.id, ...orderNumbers.fields(o), deliveredAt: o.deliveredAt || o.updatedAt, earningPaise: earningPaise(o), paymentMethod: o.paymentMethod }
      : { id: o.id, ...orderNumbers.fields(o), deliveredAt: o.deliveredAt || o.updatedAt, ...(() => { const l = payouts.storeLine(o); return { grossPaise: l.gross, commissionPaise: l.commission, adjustmentsPaise: l.adjustments, netPaise: l.net }; })(), commissionRate: o.commissionRate, commissionType: o.commissionType, paymentMethod: o.paymentMethod }));
    res.set('Cache-Control', 'no-store');
    res.json({ payout: payouts.payoutJson(p, { withOrderIds: true }), orders: lines });
  } catch (error) {
    reply(res, error, '[PAYOUT_ERROR]');
  }
};

// ── Rider app ────────────────────────────────────────────────────────────────────────────────────
// GET /api/delivery/cash   cash held, the COD limit, the deposit banner and the net position.
exports.getMyCash = async (req, res) => {
  try {
    const sequelize = seqOf();
    const rider = await sequelize.models.DeliveryPartner.findByPk(req.user.id, { attributes: ['id', 'cashHeldPaise', 'walletBalance'], raw: true });
    if (!rider) return res.status(404).json({ message: 'Rider account not found' });
    const held = Number(rider.cashHeldPaise) || 0;
    const owed = await owedToRider(sequelize, rider.id);
    const { rows } = await riderCash.listFor({ sequelize, riderId: rider.id, page: 1, limit: 10, types: [riderCash.TYPES.CASH_DEPOSITED, riderCash.TYPES.ADJUSTMENT] });
    res.set('Cache-Control', 'no-store');
    res.json({
      ...riderCash.cashStatus(held, await riderCash.getCashLimitPaise(sequelize)),
      position: netPosition({ cashHeldPaise: held, earningsPaise: owed.earningsPaise, tipsPaise: Math.max(0, toPaise(rider.walletBalance)) }),
      recentDeposits: rows.map(riderCash.toPublic),
    });
  } catch (error) {
    reply(res, error, '[RIDER_CASH_ERROR]');
  }
};

// GET /api/delivery/cash/entries?page=&limit=&type=deposits
exports.getMyCashEntries = async (req, res) => {
  try {
    const sequelize = seqOf();
    const types = String(req.query.type || '') === 'deposits' ? [riderCash.TYPES.CASH_DEPOSITED, riderCash.TYPES.ADJUSTMENT] : null;
    const { rows, page, limit, hasMore } = await riderCash.listFor({ sequelize, riderId: req.user.id, page: req.query.page, limit: req.query.limit, types });
    res.set('Cache-Control', 'no-store');
    res.json({ entries: rows.map(riderCash.toPublic), page, limit, hasMore });
  } catch (error) {
    reply(res, error, '[RIDER_CASH_ERROR]');
  }
};

const partnerPayoutJson = (p) => {
  const j = payouts.payoutJson(p);
  // Partners see their statements; admin ids stay internal.
  delete j.createdBy; delete j.paidBy; delete j.cancelledBy;
  return j;
};

// GET /api/delivery/payouts?page=
exports.getMyPayouts = async (req, res) => {
  try {
    const r = await payouts.listPayouts({ sequelize: seqOf(), partnerType: 'rider', partnerId: String(req.user.id), page: req.query.page, limit: req.query.limit || 20 });
    res.set('Cache-Control', 'no-store');
    res.json({ payouts: r.rows.filter((p) => p.status !== 'CANCELLED').map(partnerPayoutJson), page: r.page, hasMore: r.hasMore });
  } catch (error) {
    reply(res, error, '[PAYOUT_ERROR]');
  }
};

// ── Store / vendor app (API only: neither partner app has an earnings screen yet) ───────────────
// GET /api/restaurants/:id/payouts?page=   the store's own statements + what is not on one yet.
exports.getStorePayouts = async (req, res) => {
  try {
    const isOwner = String(req.user.id) === String(req.params.id);
    const isAdmin = String(req.user.role || '').toLowerCase() === 'admin';
    if (!isOwner && !isAdmin) return res.status(403).json({ message: 'Not authorized to view these payouts' });
    if (!UUID_RE.test(String(req.params.id))) return res.status(404).json({ message: 'Store not found.' });
    const sequelize = seqOf();
    const store = await sequelize.models.Restaurant.findByPk(req.params.id, { attributes: ['id', 'name', 'vendorType'], raw: true });
    if (!store) return res.status(404).json({ message: 'Store not found.' });
    const kind = payouts.storeKind(store);
    const r = await payouts.listPayouts({ sequelize, partnerType: kind, partnerId: store.id, page: req.query.page, limit: req.query.limit || 20 });
    const pending = (await payouts.pendingPartners({ sequelize, partnerType: kind })).find((p) => p.partnerId === String(store.id)) || null;
    res.set('Cache-Control', 'no-store');
    res.json({
      partnerType: kind,
      notYetOnStatement: pending ? { orders: pending.orders, grossPaise: pending.grossPaise, commissionPaise: pending.commissionPaise, adjustmentsPaise: pending.adjustmentsPaise, netPaise: pending.netPaise, net: toRupees(pending.netPaise) } : { orders: 0, grossPaise: 0, commissionPaise: 0, adjustmentsPaise: 0, netPaise: 0, net: 0 },
      payouts: r.rows.filter((p) => p.status !== 'CANCELLED').map(partnerPayoutJson),
      page: r.page, hasMore: r.hasMore,
    });
  } catch (error) {
    reply(res, error, '[PAYOUT_ERROR]');
  }
};
