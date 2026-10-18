// Payments: CASH only by default; WALLET behind AUTO_RIDE_WALLET_ENABLED. Failed / abandoned payment
// never confirms seats (S14); refunds follow the policy and are credited exactly once (S15).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

const { api } = H;

before(async () => {
  await H.setup({ label: 'ar-wallet' });
  await H.setFlag(true);
});
after(H.teardown);

test('wallet is off by default: only CASH offered, WALLET refused', async () => {
  const u = await H.mkUser({ wallet: 500 });
  const s = await api('GET', '/api/auto-ride/status', u.token);
  assert.deepEqual(s.body.paymentMethods, ['CASH']);
  const t = await H.mkTrip({ capacity: 3, seatFare: 40 });
  const h = await api('POST', `/api/auto-ride/trips/${t.trip.id}/holds`, u.token, { seatCount: 1 });
  const c = await api('POST', `/api/auto-ride/bookings/${h.body.booking.id}/confirm`, u.token, { paymentMethod: 'WALLET' });
  assert.equal(c.status, 403);
  assert.equal(c.body.code, 'PAYMENT_METHOD_OFF');
  const bad = await api('POST', `/api/auto-ride/bookings/${h.body.booking.id}/confirm`, u.token, { paymentMethod: 'UPI' });
  assert.equal(bad.status, 400);
  await u.reload();
  assert.equal(u.walletBalance, 500);
});

test('S14 failed payment (insufficient wallet) leaves the hold unconfirmed; abandoned hold expires', async () => {
  await H.setWallet(true);
  const t = await H.mkTrip({ capacity: 3, seatFare: 70 });
  const u = await H.mkUser({ wallet: 100 });
  const h = await api('POST', `/api/auto-ride/trips/${t.trip.id}/holds`, u.token, { seatCount: 2 });
  const c = await api('POST', `/api/auto-ride/bookings/${h.body.booking.id}/confirm`, u.token, { paymentMethod: 'WALLET' });
  assert.equal(c.status, 402);
  assert.equal(c.body.code, 'INSUFFICIENT_WALLET');
  const b = await api('GET', `/api/auto-ride/bookings/${h.body.booking.id}`, u.token);
  assert.equal(b.body.booking.status, 'HELD');
  assert.equal(b.body.booking.paymentStatus, 'NONE');
  assert.equal(b.body.booking.trip.confirmedSeats, 0, 'seats are not confirmed');
  assert.equal(b.body.booking.trip.heldSeats, 2);
  await u.reload();
  assert.equal(u.walletBalance, 100, 'nothing debited');
  assert.equal(await H.ctx.M('WalletTransaction').count({ where: { ownerId: u.id } }), 0, 'C5: no ledger row for a failed debit');
  H.advance(6 * H.MIN);
  await H.r('modules/autoRide/jobs').runAutoRideJobs(new Date(H.now()));
  const after2 = await api('GET', `/api/auto-ride/bookings/${h.body.booking.id}`, u.token);
  assert.equal(after2.body.booking.status, 'EXPIRED');
  assert.equal((await H.ctx.M('AutoTrip').findByPk(t.trip.id)).seatsHeld, 0);
  assert.ok((await H.notificationsFor(u.id)).some((n) => n.type === 'AUTO_HOLD_EXPIRED'));
});

test('S15 wallet: debit exactly the server amount; cancel before departure confirmed -> 100 % refund, exactly once', async () => {
  await H.setWallet(true);
  const t = await H.mkTrip({ capacity: 6, seatFare: 55 });
  const u = await H.mkUser({ wallet: 300 });
  const r = await H.book(t.trip.id, { seatCount: 2, user: u, paymentMethod: 'WALLET' });
  assert.equal(r.confirm.status, 200);
  assert.equal(r.booking.paymentStatus, 'PAID');
  await u.reload();
  assert.equal(u.walletBalance, 190);
  const cs = await Promise.all([1, 2, 3].map(() => api('POST', `/api/auto-ride/bookings/${r.booking.id}/cancel`, u.token, {})));
  assert.equal(cs.filter((c) => c.status === 200).length, 1, 'one cancel wins');
  const ok = cs.find((c) => c.status === 200);
  assert.equal(ok.body.booking.status, 'REFUNDED');
  assert.equal(ok.body.booking.refundAmount, 110);
  await u.reload();
  assert.equal(u.walletBalance, 300, 'refunded once');
  await H.r('modules/autoRide/jobs').runAutoRideJobs(new Date(H.now()));
  await u.reload();
  assert.equal(u.walletBalance, 300, 'job does not refund again');
  // C5 ledger: opening 300, AUTORIDE_PAYMENT -110, exactly one AUTORIDE_REFUND +110 (3 parallel cancels + the job).
  const rows = (await H.ctx.M('WalletTransaction').findAll({ where: { ownerType: 'user', ownerId: u.id }, order: [['createdAt', 'ASC']] })).map((x) => [x.type, x.amountPaise, x.balanceAfterPaise, x.refType, x.refId]);
  assert.deepEqual(rows, [
    ['OPENING_BALANCE', 30000, 30000, null, null],
    ['AUTORIDE_PAYMENT', -11000, 19000, 'AUTO_BOOKING', r.booking.id],
    ['AUTORIDE_REFUND', 11000, 30000, 'AUTO_BOOKING', r.booking.id],
  ]);
});

test('refund policy: customer cancel after the driver confirmed departure -> 0 %; driver cancel -> 100 %', async () => {
  await H.setWallet(true);
  const t = await H.mkTrip({ capacity: 3, seatFare: 50, minSeatsToDepart: 1 });
  const a = await H.book(t.trip.id, { seatCount: 1, user: await H.mkUser({ wallet: 50 }), paymentMethod: 'WALLET' });
  await api('POST', `/api/auto-ride/driver/trips/${t.trip.id}/actions/confirm-departure`, t.token, { ready: true });
  const c = await api('POST', `/api/auto-ride/bookings/${a.booking.id}/cancel`, a.user.token, {});
  assert.equal(c.status, 200);
  assert.equal(c.body.booking.status, 'CANCELLED');
  assert.equal(c.body.booking.paymentStatus, 'NOT_REFUNDED');
  await a.user.reload();
  assert.equal(a.user.walletBalance, 0);

  const t2 = await H.mkTrip({ capacity: 3, seatFare: 45 });
  const b = await H.book(t2.trip.id, { seatCount: 2, user: await H.mkUser({ wallet: 90 }), paymentMethod: 'WALLET' });
  const cash = await H.book(t2.trip.id, { seatCount: 1 });
  const dc = await api('POST', `/api/auto-ride/driver/trips/${t2.trip.id}/actions/cancel`, t2.token, { reason: 'Clutch broke' });
  assert.equal(dc.status, 200);
  assert.equal(dc.body.bookingsCancelled, 2);
  await b.user.reload();
  assert.equal(b.user.walletBalance, 90, 'driver cancellation refunds in full');
  const bb = await api('GET', `/api/auto-ride/bookings/${b.booking.id}`, b.user.token);
  assert.equal(bb.body.booking.status, 'REFUNDED');
  const cb = await api('GET', `/api/auto-ride/bookings/${cash.booking.id}`, cash.user.token);
  assert.equal(cb.body.booking.status, 'CANCELLED');
  assert.ok((await H.notificationsFor(b.user.id)).some((n) => n.type === 'AUTO_TRIP_CANCELLED'));
});

test('full auto paid by wallet: insufficient balance -> request declined, nothing booked', async () => {
  await H.setWallet(true);
  const t = await H.mkTrip({ capacity: 6, seatFare: 30, fullAutoFare: 500, privateBookingEnabled: true });
  const u = await H.mkUser({ wallet: 100 });
  const r = await api('POST', `/api/auto-ride/trips/${t.trip.id}/private-requests`, u.token, { passengers: 6, paymentMethod: 'WALLET' });
  assert.equal(r.status, 201);
  const acc = await api('POST', `/api/auto-ride/driver/private-requests/${r.body.request.id}/accept`, t.token);
  assert.equal(acc.status, 409);
  assert.equal(acc.body.code, 'PAYMENT_FAILED');
  const trip = await H.ctx.M('AutoTrip').findByPk(t.trip.id);
  assert.equal(trip.mode, 'SHARED');
  assert.equal(trip.seatsConfirmed, 0);
  await u.reload();
  assert.equal(u.walletBalance, 100);
  await H.setWallet(false);
  const s = await api('GET', '/api/auto-ride/status', u.token);
  assert.deepEqual(s.body.paymentMethods, ['CASH']);
});
