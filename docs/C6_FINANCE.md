# C6 — Rider COD cash, earnings, commission snapshot, payouts

## Rider cash ledger (`RiderCashEntries`, `DeliveryPartner.cashHeldPaise`)

- Integer paise, signed. Every change goes through `utils/riderCash.applyCashChange` inside the caller's
  transaction, with a `balanceAfterPaise` and an optional idempotency key (unique per rider).
- `COD_COLLECTED` (+ order total): written in the **same transaction** as the Delivered flip, both on the rider
  app PIN confirm and when support marks the order delivered. Exactly once per order (only the request that
  flips the order writes it; `cod:<orderId>` key + unique `(orderId, type)` index as backstop). Prepaid
  (Wallet) and stall orders write nothing. If the cash row cannot be written, the delivery rolls back.
- `STORE_PURCHASE` (−): buy-at-store orders (`Order.storePaidByRider`, set at creation) — what the rider paid
  the shop (approved bill, else the item subtotal). Same transaction.
- `CASH_DEPOSITED` (−): admin records a handover — method `cash` or `upi` + reference (receipt / UTR) required;
  cannot take the balance below zero.
- `ADJUSTMENT` (±): admin, reason required (≥ 5 characters, shown to the rider).
- **Opening balances: none.** The ledger starts at the C6 deploy (`GlobalConfig.RIDER_CASH_LEDGER_START`, set
  once at first boot, never edited). Cash riders held before that is unknown to the server; if a rider still
  holds older cash, record an `ADJUSTMENT` (+, reason "cash held before ledger start") before taking the deposit.
- Rider cash is **not** the rider wallet (tips, C5). Payouts never deduct cash; cash is settled by deposits.

### Cash limit (`GlobalConfig.RIDER_CASH_LIMIT`, whole rupees)

Owner decision: **default 0 = OFF** — riders are never blocked from COD orders. The rider app only shows
"Cash with you: ₹X". If an admin sets a limit > 0 (Admin → Config → Rider cash limit), a rider holding cash ≥
the limit cannot claim **new COD** orders (409 `CASH_LIMIT`, "Deposit ₹X to keep taking COD orders"); prepaid
orders still work. The check runs inside the existing claim path (rider row lock on Postgres).

## One earnings rule (`utils/riderEarnings`)

Per delivered order: the stored delivery fee when > 0, otherwise ₹30; stall orders 0; tips separate.
This is exactly what the rider app always showed (`riderPayout`) and what `totalEarnings` accumulated. The old
admin payout list summed the raw `deliveryFee`, which paid ₹0 for orders whose fee was 0; for every order with a
fee > 0 both views were already identical, so historical rider-app numbers do not change. Used by the rider
API (today / week / history / delivered reply), admin rider payouts, rider statements and the finance report.

## Commission snapshot (`Order.commissionRate/Type/AmountPaise/storeNetPaise/commissionSource`)

Taken from the store's rate when the order is created (item subtotal base, the same base store payouts always
used; percentage rounds half up; flat = min(rate, subtotal)). Never recomputed. At startup, unsettled orders
without one are snapshotted **once** with the store's current rate (`commissionSource = 'backfill'`, count
logged as `[C6_COMMISSION_BACKFILL]` and stored in `GlobalConfig.C6_COMMISSION_BACKFILL`); settled orders keep
none (the finance report marks them `commissionEstimated`). Packaging fee is not part of the store payout
(unchanged from before).

## Payout statements (`Payouts`)

Preview → create (PENDING; orders claimed via `Order.payoutId` / `riderPayoutId`; 409 if the numbers changed
since the preview) → mark paid (UTR required; sets the old `payoutSettled` / `riderPayoutSettled` flags; rider
tips leave the wallet as `TIP_PAYOUT` in the same transaction) or cancel (reason; orders released).

- Store: gross (item subtotal) − commission (snapshot) + adjustments. Stall orders (`fulfilment VENDOR`): the
  customer paid the stall in cash, so that cash is a negative adjustment — net can be negative (stall owes
  Zenvy the commission). Buy-at-store orders are never on a store statement (the rider paid the shop).
- Rider: earnings + tips. Cash held is shown, never deducted.
- The legacy `POST /api/admin/finance/settle-restaurant|settle-rider` now also create a PAID Payout and need a UTR.

## Reconciliation

Daily job `riderCash.reconcile` (04:45 IST, single runner) and `GET /api/admin/rider-cash/reconcile`: ledger sum
vs cash held per rider; every COD order delivered by a rider since the ledger start has exactly one
`COD_COLLECTED` row of the order total for that rider; no cash row for a non-COD delivery. Read-only; problems
push the admins. A missing row (e.g. delivered by the old process during a deploy) is recorded only by an admin
(Finance → Rider cash → Run cash check → Record). Metrics: `/api/admin/metrics/perf` → `riderCash`.

## Collecting cash from riders (owner process)

1. Finance → Rider cash lists who holds how much (and what Zenvy owes them).
2. Rider hands over cash or pays by UPI to Zenvy's account.
3. Open the rider → Record deposit: amount, method, reference (receipt number / who received it, or UPI UTR).
4. Pay riders their earnings + tips separately: Finance → Payouts → Riders → Generate statement → Mark paid with the UTR.
5. If the daily cash check alerts, open Rider cash → Run cash check and follow each line (never auto-fixed).
