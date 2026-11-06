// Campus Events payments (owner decision 16 Oct: no gateway yet, COD-style + Wallet).
//  FREE    total 0: no payment step at all.
//  VENUE   "Pay at venue": the registration is CONFIRMED with paymentStatus DUE_AT_VENUE; staff / the
//          organizer mark it PAID_AT_VENUE (audited) at check-in or from the registrations list. A student
//          can hold at most settings.maxUnpaidVenueReservations unpaid venue reservations at once.
//  WALLET  behind CAMPUS_EVENTS_WALLET_ENABLED (default OFF): conditional decrement inside the event
//          transaction; refunds exactly once (REFUND_PENDING -> REFUNDED + credit in one transaction).
//  ONLINE  Razorpay (./razorpay.js): PENDING_PAYMENT until a verified webhook says captured.
// Prices / totals are always computed here from the event / slot rows, never taken from the client.
const { Op, Transaction } = require('sequelize');
const { getModel, getSequelize } = require('../../index');
const E = require('../../enums');
const { fail, money, toPaise } = require('../util');
const clock = require('../clock');
const flag = require('../flag');
const razorpay = require('./razorpay');
const walletLedger = require('../../../../utils/walletLedger');

const M = E.PAYMENT_MODE;
const P = E.PAYMENT_STATUS;

/** { amount, extras, total } for one registration (team: the team price). */
const priceFor = (event, slot) => {
  if (event.priceType !== E.PRICE_TYPE.PAID) return { amount: 0, extras: 0, total: 0 };
  const base = slot && slot.price !== null && slot.price !== undefined ? Number(slot.price) : Number(event.price);
  const amount = money(Math.max(0, base || 0));
  const extras = money((Array.isArray(event.extraCharges) ? event.extraCharges : []).reduce((a, c) => a + Math.max(0, Number(c && c.amount) || 0), 0));
  return { amount, extras, total: money(amount + extras) };
};

/** Modes offered for this event right now (organizer's list ∩ switched-on providers). */
const enabledModes = async (event) => {
  const wanted = Array.isArray(event.paymentModes) ? event.paymentModes.map((m) => String(m).toUpperCase()) : [M.VENUE];
  const out = [];
  if (wanted.includes(M.VENUE)) out.push(M.VENUE);
  if (wanted.includes(M.WALLET) && (await flag.readWalletFlag())) out.push(M.WALLET);
  if (wanted.includes(M.ONLINE) && (await razorpay.configured())) out.push(M.ONLINE);
  return out;
};

/** Validates the requested mode for a total. FREE -> NONE. */
const pickMode = async (event, raw, total) => {
  if (!(total > 0)) return M.NONE;
  const wanted = Array.isArray(event.paymentModes) ? event.paymentModes.map((m) => String(m).toUpperCase()) : [M.VENUE];
  const offered = await enabledModes(event);
  const m = String(raw || offered[0] || wanted[0] || M.VENUE).toUpperCase();
  if (!E.PAID_MODES.includes(m)) throw fail(400, 'INVALID_INPUT', 'Payment mode must be VENUE, WALLET or ONLINE.', { field: 'paymentMode' });
  if (!wanted.includes(m)) throw fail(400, 'PAYMENT_MODE_NOT_OFFERED', 'The organizer does not accept that payment mode for this event.', { field: 'paymentMode', offered });
  if (m === M.ONLINE && !offered.includes(M.ONLINE)) await razorpay.assertConfigured();
  if (m === M.WALLET && !offered.includes(M.WALLET)) throw fail(403, 'PAYMENT_METHOD_OFF', 'ZenWe Wallet is not available for events yet.', { field: 'paymentMode' });
  return m;
};

/** Pay-at-venue reservation cap (unpaid, live). */
const assertVenueQuota = async (userId, t) => {
  const s = await flag.readSettings();
  const n = await getModel('CeRegistration').count({
    where: { userId, paymentMode: M.VENUE, paymentStatus: P.DUE_AT_VENUE, status: { [Op.in]: [...E.LIVE_REG_STATUSES, E.REG_STATUS.WAITLISTED] } },
    transaction: t,
  });
  if (n >= s.maxUnpaidVenueReservations) {
    throw fail(409, 'TOO_MANY_UNPAID', `You already have ${n} unpaid pay-at-venue reservations. Pay or cancel one first.`, { limit: s.maxUnpaidVenueReservations });
  }
};

/** Wallet debit inside t (conditional decrement). Throws 402 when short; nothing changes then. */
const debitWallet = async (userId, amount, t, ref = null) => {
  const amt = money(amount);
  if (!(amt > 0)) return 0;
  // C5: conditional debit + EVENT_PAYMENT ledger row in the event transaction.
  try {
    await walletLedger.applyWalletChange({
      t, ownerType: 'user', ownerId: userId, amountPaise: -walletLedger.toPaise(amt), type: walletLedger.TYPES.EVENT_PAYMENT,
      ref, actor: { type: 'user', id: userId },
    });
  } catch (err) {
    if (walletLedger.isInsufficient(err)) throw fail(402, 'INSUFFICIENT_WALLET', `Not enough ZenWe Wallet balance for ₹${amt}.`);
    throw err;
  }
  return amt;
};

/** Refund % on a student's own cancellation (organizer / admin / system cancellations: 100). */
const refundPct = async (event, by) => {
  if (by !== 'user') return 100;
  const s = await flag.readSettings();
  const pol = event.cancellationPolicy && typeof event.cancellationPolicy === 'object' ? event.cancellationPolicy : {};
  const pct = Number(pol.refundPct);
  return Number.isInteger(pct) && pct >= 0 && pct <= 100 ? pct : s.defaultRefundPct;
};

/** Payment columns when a registration ends (inside the cancelling transaction). */
const endColumns = (reg, pct) => {
  const paidMoney = reg.paymentMode === M.WALLET ? money(reg.walletDebited)
    : (reg.paymentStatus === P.SUCCESS || reg.paymentStatus === P.PAID_AT_VENUE ? money(reg.total) : 0);
  if (paidMoney > 0) {
    const refund = money((paidMoney * Math.max(0, Math.min(100, pct))) / 100);
    if (refund > 0) return { paymentStatus: P.REFUND_PENDING, refundAmount: refund };
    return { refundAmount: 0 };
  }
  if ([P.DUE_AT_VENUE, P.PENDING, P.FAILED].includes(reg.paymentStatus)) return { paymentStatus: P.CANCELLED, refundAmount: 0 };
  return { refundAmount: 0 };
};

/**
 * REFUND_PENDING -> REFUNDED, exactly once. WALLET: credit in the same transaction as the flip.
 * ONLINE: Razorpay refund first (CePayment marked REFUND_PENDING), then the flip. VENUE (cash): left for
 * the organizer / admin to mark (markVenueRefunded). Returns the amount refunded (0 when nothing done).
 */
const processRefund = async (regId) => {
  const Reg = getModel('CeRegistration');
  const reg0 = await Reg.findByPk(regId);
  if (!reg0 || reg0.paymentStatus !== P.REFUND_PENDING) return 0;
  try {
    if (reg0.paymentMode === M.ONLINE) {
      const Pay = getModel('CePayment');
      const pay = await Pay.findOne({ where: { registrationId: reg0.id, status: { [Op.in]: [E.PAY_ROW_STATUS.SUCCESS, E.PAY_ROW_STATUS.REFUND_PENDING] } } });
      if (!pay || !pay.providerPaymentId) throw new Error('no captured payment to refund');
      if (!razorpay.keysPresent()) throw new Error('razorpay keys missing');
      await Pay.update({ status: E.PAY_ROW_STATUS.REFUND_PENDING }, { where: { id: pay.id, status: E.PAY_ROW_STATUS.SUCCESS } });
      if (!pay.providerRefundId) {
        const r = await razorpay.refund({ paymentId: pay.providerPaymentId, amountPaise: toPaise(reg0.refundAmount) });
        await Pay.update({ providerRefundId: r.id, refundAmountPaise: toPaise(reg0.refundAmount) }, { where: { id: pay.id } });
      }
      const [n] = await Reg.update({ paymentStatus: P.REFUNDED, refundedAt: clock.now() }, { where: { id: reg0.id, paymentStatus: P.REFUND_PENDING } });
      await Pay.update({ status: E.PAY_ROW_STATUS.REFUNDED, refundedAt: clock.now() }, { where: { id: pay.id } });
      return n ? money(reg0.refundAmount) : 0;
    }
    if (reg0.paymentMode !== M.WALLET) return 0;
    return await getSequelize().transaction({ type: Transaction.TYPES.IMMEDIATE }, async (t) => {
      const reg = await Reg.findByPk(regId, { transaction: t });
      if (!reg || reg.paymentStatus !== P.REFUND_PENDING) return 0;
      const amt = money(reg.refundAmount);
      const [n] = await Reg.update({ paymentStatus: P.REFUNDED, refundedAt: clock.now() }, { where: { id: reg.id, paymentStatus: P.REFUND_PENDING, refundedAt: null }, transaction: t });
      if (!n) return 0;
      // C5: credit + EVENT_REFUND ledger row, in the transaction that flipped REFUND_PENDING -> REFUNDED.
      if (amt > 0) {
        // Back to whoever paid: a team registration moves to the new captain on a captaincy hand-over
        // (teams.transferCaptain), but the wallet debit was the old captain's.
        const paid = await getSequelize().models.WalletTransaction.findOne({
          where: { ownerType: 'user', type: walletLedger.TYPES.EVENT_PAYMENT, refType: 'EVENT_REGISTRATION', refId: String(reg.id) },
          attributes: ['ownerId'], order: [['createdAt', 'ASC']], transaction: t,
        }).catch(() => null);
        await walletLedger.applyWalletChange({
          t, ownerType: 'user', ownerId: (paid && paid.ownerId) || reg.userId, amountPaise: walletLedger.toPaise(amt), type: walletLedger.TYPES.EVENT_REFUND,
          ref: { type: 'EVENT_REGISTRATION', id: reg.id }, actor: { type: 'system' },
        });
      }
      return amt;
    });
  } catch (err) {
    console.warn('[CAMPUS_EVENTS_REFUND_WARN]', regId, err.message);
    try { await Reg.increment('refundAttempts', { by: 1, where: { id: regId } }); } catch { /* the job retries */ }
    return 0;
  }
};

module.exports = { priceFor, enabledModes, pickMode, assertVenueQuota, debitWallet, refundPct, endColumns, processRefund, razorpay };
