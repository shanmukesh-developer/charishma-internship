// Auto-Ride payments. v1 launch: CASH to the driver at boarding (the only method enabled by default).
// WALLET (Zenvy Wallet) is implemented but only offered when GlobalConfig AUTO_RIDE_WALLET_ENABLED is on:
//  - debit at confirmation, inside the trip transaction, with a conditional decrement
//    (walletBalance >= amount), the same pattern as orders: a failed debit leaves the hold unconfirmed.
//  - refund exactly once: the booking is first marked REFUND_PENDING (same transaction as the
//    cancellation), then processRefund flips REFUND_PENDING -> REFUNDED with a conditional UPDATE and
//    credits the wallet in that same transaction. A failure leaves REFUND_PENDING for the lifecycle job.
const { Transaction } = require('sequelize');
const { getModel, getSequelize } = require('../index');
const E = require('../enums');
const { fail, money } = require('./util');
const clock = require('./clock');
const { readWalletFlag } = require('./flag');
const walletLedger = require('../../../utils/walletLedger');

const B = E.BOOKING_STATUS;
const P = E.PAYMENT_STATUS;

/** Payment methods currently offered to customers. */
const enabledMethods = async () => ((await readWalletFlag()) ? [E.PAYMENT_METHODS.CASH, E.PAYMENT_METHODS.WALLET] : [E.PAYMENT_METHODS.CASH]);

/** Validates the requested method (default CASH). Throws 400 / 403 for unknown / disabled methods. */
const pickMethod = async (raw) => {
  const m = String(raw || E.PAYMENT_METHODS.CASH).toUpperCase();
  if (!Object.values(E.PAYMENT_METHODS).includes(m)) throw fail(400, 'INVALID_INPUT', 'Payment method must be CASH or WALLET.', { field: 'paymentMethod' });
  if (!(await enabledMethods()).includes(m)) throw fail(403, 'PAYMENT_METHOD_OFF', 'Zenvy Wallet is not available for autos yet. Please pay the driver in cash.', { field: 'paymentMethod' });
  return m;
};

/**
 * Charges a booking being confirmed (inside transaction t). Returns the columns to set.
 * WALLET: conditional decrement; throws 402 INSUFFICIENT_WALLET (nothing changes) when short.
 */
const charge = async ({ userId, amount, method, t, ref = null }) => {
  const amt = money(amount);
  if (method === E.PAYMENT_METHODS.WALLET) {
    if (amt > 0) {
      // C5: conditional debit + AUTORIDE_PAYMENT ledger row in the trip transaction.
      try {
        await walletLedger.applyWalletChange({
          t, ownerType: 'user', ownerId: userId, amountPaise: -walletLedger.toPaise(amt), type: walletLedger.TYPES.AUTORIDE_PAYMENT,
          ref, actor: { type: 'user', id: userId },
        });
      } catch (err) {
        if (walletLedger.isInsufficient(err)) throw fail(402, 'INSUFFICIENT_WALLET', `Not enough Zenvy Wallet balance for ₹${amt}. Pay in cash or add money to your wallet.`);
        throw err;
      }
    }
    return { paymentMethod: method, paymentStatus: P.PAID, walletDebited: amt };
  }
  return { paymentMethod: E.PAYMENT_METHODS.CASH, paymentStatus: P.CASH_DUE, walletDebited: 0 };
};

/** Columns for a cancellation under `pct` % refund (inside the cancelling transaction). */
const cancellationColumns = (booking, pct) => {
  const debited = money(booking.walletDebited);
  if (booking.paymentMethod === E.PAYMENT_METHODS.WALLET && debited > 0) {
    const refund = money((debited * Math.max(0, Math.min(100, pct))) / 100);
    if (refund > 0) return { status: B.REFUND_PENDING, paymentStatus: P.REFUND_PENDING, refundAmount: refund };
    return { status: B.CANCELLED, paymentStatus: P.NOT_REFUNDED, refundAmount: 0 };
  }
  return { status: B.CANCELLED, paymentStatus: P.NONE, refundAmount: 0 };
};

/** REFUND_PENDING -> REFUNDED + wallet credit, exactly once. Returns the amount credited (0 if not pending). */
const processRefund = async (bookingId) => {
  const Booking = getModel('AutoBooking');
  try {
    return await getSequelize().transaction({ type: Transaction.TYPES.IMMEDIATE }, async (t) => {
      const b = await Booking.findByPk(bookingId, { transaction: t });
      if (!b || b.status !== B.REFUND_PENDING) return 0;
      const amt = money(b.refundAmount);
      const [n] = await Booking.update(
        { status: B.REFUNDED, paymentStatus: P.REFUNDED, refundedAt: clock.now() },
        { where: { id: b.id, status: B.REFUND_PENDING, refundedAt: null }, transaction: t },
      );
      if (!n) return 0;
      // C5: credit + AUTORIDE_REFUND ledger row, in the transaction that flipped REFUND_PENDING -> REFUNDED.
      if (amt > 0) {
        await walletLedger.applyWalletChange({
          t, ownerType: 'user', ownerId: b.userId, amountPaise: walletLedger.toPaise(amt), type: walletLedger.TYPES.AUTORIDE_REFUND,
          ref: { type: 'AUTO_BOOKING', id: b.id }, actor: { type: 'system' },
        });
      }
      return amt;
    });
  } catch (err) {
    console.warn('[AUTORIDE_REFUND_WARN]', bookingId, err.message);
    try { await Booking.increment('refundAttempts', { by: 1, where: { id: bookingId } }); } catch { /* retried by the job */ }
    return 0;
  }
};

/** Refund % for a cancellation. Driver / admin / system: always 100. Customer: policy by trip status. */
const refundPct = async (by, trip) => {
  if (by !== 'customer') return 100;
  const s = await require('./flag').readSettings();
  const st = trip.status === E.TRIP_STATUS.DELAYED ? (trip.statusBeforeDelay || trip.status) : trip.status;
  return E.PRE_DEPARTURE_STATUSES.includes(st) ?s.customerRefundBeforeConfirmPct : s.customerRefundAfterConfirmPct;
};

module.exports = { enabledMethods, pickMethod, charge, cancellationColumns, processRefund, refundPct };
