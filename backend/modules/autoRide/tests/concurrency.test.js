// Concurrency and invariant tests (plan §N): last-seat race with 20 parallel holds, same-seat race,
// random parallel hold / confirm / cancel, private accept vs shared hold, queue numbers under 20
// parallel publishes. Each race runs twice: with the in-process queue (one Node process) and with it
// switched OFF, so only the database guards (IMMEDIATE transactions + partial unique indexes) protect it,
// which is what a second process / instance would rely on.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

const { api } = H;
let locks;

before(async () => {
  await H.setup({ label: 'ar-concurrency' });
  await H.setFlag(true);
  locks = H.r('modules/autoRide/services/locks');
});
after(async () => { locks.setInProcessQueue(true); await H.teardown(); });

const modes = [['in-process queue on', true], ['in-process queue OFF (database guards only)', false]];

for (const [label, queueOn] of modes) {
  test(`last-seat race, 20 parallel holds (${label})`, async () => {
    locks.setInProcessQueue(true);
    const t = await H.mkTrip({ capacity: 6, seatFare: 33 });
    const takenBefore = [];
    for (let i = 0; i < 5; i++) takenBefore.push(...((await H.book(t.trip.id, { seatCount: 1 })).booking.seatNumbers || []));
    // The one seat nobody holds yet (boys get the back rows first, the front seats last).
    const lastFree = [1, 2, 3, 4, 5, 6].filter((n) => !takenBefore.includes(n));
    const users = await Promise.all(Array.from({ length: 20 }, () => H.mkUser()));
    locks.setInProcessQueue(queueOn);
    const rs = await Promise.all(users.map((u) => api('POST', `/api/auto-ride/trips/${t.trip.id}/holds`, u.token, { seatCount: 1 })));
    locks.setInProcessQueue(true);
    const codes = rs.map((r) => r.status);
    assert.equal(codes.filter((c) => c === 201).length, 1, `exactly one winner: ${codes.join(',')}`);
    assert.ok(codes.every((c) => c === 201 || c === 409), `only 201 / 409: ${codes.join(',')}`);
    const winner = rs.find((r) => r.status === 201);
    assert.deepEqual(winner.body.booking.seatNumbers, lastFree);
    const { problems, trip } = await H.checkInvariants(t.trip.id);
    assert.deepEqual(problems, []);
    assert.equal(trip.seatsHeld + trip.seatsConfirmed, 6);
  });

  test(`same-seat race, 12 users want seat 4 (${label})`, async () => {
    locks.setInProcessQueue(true);
    const t = await H.mkTrip({ capacity: 8, seatFare: 27 });
    const users = await Promise.all(Array.from({ length: 12 }, () => H.mkUser()));
    locks.setInProcessQueue(queueOn);
    const rs = await Promise.all(users.map((u) => api('POST', `/api/auto-ride/trips/${t.trip.id}/holds`, u.token, { seatCount: 1, seatNumbers: [4] })));
    locks.setInProcessQueue(true);
    assert.equal(rs.filter((r) => r.status === 201).length, 1);
    assert.ok(rs.filter((r) => r.status !== 201).every((r) => r.status === 409 && r.body.code === 'SEAT_TAKEN'), JSON.stringify(rs.map((r) => r.body.code)));
    assert.deepEqual((await H.checkInvariants(t.trip.id)).problems, []);
  });

  test(`queue numbers unique, 20 parallel publishes at one stand (${label})`, async () => {
    locks.setInProcessQueue(true);
    const { route, pickup } = await H.mkRoute({ name: `Queue route ${label}` });
    const drafts = [];
    for (let i = 0; i < 20; i++) {
      const d = await H.mkDriver({ capacity: [3, 6, 8][i % 3] });
      const c = await api('POST', '/api/auto-ride/driver/trips', d.token, {
        vehicleId: d.vehicle.id, routeId: route.id, pickupPointId: pickup.id, departureAt: new Date(H.now() + (30 + i) * H.MIN).toISOString(), seatFare: 30 + i,
      });
      assert.equal(c.status, 201);
      drafts.push({ id: c.body.trip.id, token: d.token });
    }
    locks.setInProcessQueue(queueOn);
    const rs = await Promise.all(drafts.map((d) => api('POST', `/api/auto-ride/driver/trips/${d.id}/publish`, d.token)));
    locks.setInProcessQueue(true);
    assert.ok(rs.every((r) => r.status === 200), JSON.stringify(rs.filter((r) => r.status !== 200).map((r) => r.body)));
    const nums = rs.map((r) => r.body.trip.queueNumber).sort((a, b) => a - b);
    assert.deepEqual(nums, Array.from({ length: 20 }, (_, i) => i + 1), 'numbers 1..20, no gaps, no duplicates');
    const counter = await H.ctx.M('AutoQueueCounter').findAll({ where: { pickupPointId: pickup.id } });
    assert.equal(counter.length, 1);
    assert.equal(counter[0].lastNumber, 20);
  });
}

test('random parallel hold / confirm / cancel / release keeps every invariant (capacity 8)', async () => {
  const t = await H.mkTrip({ capacity: 8, seatFare: 41 });
  const users = await Promise.all(Array.from({ length: 24 }, () => H.mkUser()));
  const state = new Map(); // userId -> booking id
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let wave = 0; wave < 6; wave++) {
    const ops = users.map((u) => async () => {
      const b = state.get(u.id);
      const pick = rnd(10);
      if (!b || pick < 3) {
        const r = await api('POST', `/api/auto-ride/trips/${t.trip.id}/holds`, u.token, { seatCount: 1 + rnd(3) });
        if (r.status === 201 || r.status === 200) state.set(u.id, r.body.booking.id);
        else assert.equal(r.status, 409, JSON.stringify(r.body));
        return;
      }
      if (pick < 6) {
        const r = await api('POST', `/api/auto-ride/bookings/${b}/confirm`, u.token, {});
        assert.ok([200, 409, 410].includes(r.status), JSON.stringify(r.body));
      } else if (pick < 8) {
        const r = await api('POST', `/api/auto-ride/bookings/${b}/cancel`, u.token, {});
        assert.ok([200, 409].includes(r.status), JSON.stringify(r.body));
        if (r.status === 200) state.delete(u.id);
      } else {
        const r = await api('POST', `/api/auto-ride/bookings/${b}/release`, u.token, {});
        assert.ok([200, 409].includes(r.status), JSON.stringify(r.body));
        if (r.status === 200) state.delete(u.id);
      }
    });
    await Promise.all(ops.map((f) => f()));
    const { problems } = await H.checkInvariants(t.trip.id);
    assert.deepEqual(problems, [], `wave ${wave}`);
  }
  const trip = await H.ctx.M('AutoTrip').findByPk(t.trip.id);
  assert.ok(trip.seatsConfirmed + trip.seatsHeld <= 8);
});

test('private accept vs shared holds racing: never both (5 rounds, capacity 3 and 6)', async () => {
  for (let round = 0; round < 5; round++) {
    const cap = round % 2 ? 3 : 6;
    const t = await H.mkTrip({ capacity: cap, seatFare: 30, fullAutoFare: 300, privateBookingEnabled: true });
    const owner = await H.mkUser();
    const req = await api('POST', `/api/auto-ride/trips/${t.trip.id}/private-requests`, owner.token, { passengers: 2 });
    assert.equal(req.status, 201);
    const others = await Promise.all(Array.from({ length: 4 }, () => H.mkUser()));
    const holds = others.map((u) => api('POST', `/api/auto-ride/trips/${t.trip.id}/holds`, u.token, { seatCount: 1 }));
    const accept = api('POST', `/api/auto-ride/driver/private-requests/${req.body.request.id}/accept`, t.token);
    const [acc, ...hs] = await Promise.all([accept, ...holds]);
    const held = hs.filter((h) => h.status === 201).length;
    if (acc.status === 200) {
      assert.equal(held, 0, 'private accepted -> no shared seat');
      assert.ok(hs.every((h) => h.status === 409 && h.body.code === 'TRIP_PRIVATE'));
    } else {
      assert.equal(acc.status, 409);
      assert.equal(acc.body.code, 'SEATS_ALREADY_BOOKED');
      assert.ok(held >= 1);
    }
    const { problems, trip } = await H.checkInvariants(t.trip.id);
    assert.deepEqual(problems, []);
    if (acc.status === 200) assert.equal(trip.mode, 'PRIVATE');
    else assert.equal(trip.mode, 'SHARED');
  }
});

const isUnique = (e) => e && e.name === 'SequelizeUniqueConstraintError';
test('database guards exist: duplicate live seat / queue number / active trip inserts are refused', async () => {
  const t = await H.mkTrip({ capacity: 3, seatFare: 30 });
  const r = await H.book(t.trip.id, { seatCount: 1, seatNumbers: [2] });
  const Seat = H.ctx.M('AutoSeat');
  await assert.rejects(Seat.create({ tripId: t.trip.id, seatNo: 2, bookingId: r.booking.id, status: 'HELD' }), isUnique);
  // A released row does not block the seat.
  await Seat.create({ tripId: t.trip.id, seatNo: 3, bookingId: r.booking.id, status: 'RELEASED' });
  const Trip = H.ctx.M('AutoTrip');
  const row = await Trip.findByPk(t.trip.id);
  await assert.rejects(Trip.create({ ...row.get({ plain: true }), id: undefined, driverId: (await H.mkDriver()).driver.id, vehicleId: '00000000-0000-4000-8000-000000000001' }), isUnique, 'duplicate queue number');
  await assert.rejects(Trip.create({ ...row.get({ plain: true }), id: undefined, queueNumber: null, driverId: (await H.mkDriver()).driver.id }), isUnique, 'one active trip per vehicle');
  const names = (await H.ctx.sequelize.query("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'auto_%'", { type: 'SELECT' })).map((x) => x.name);
  for (const n of ['auto_seats_live_unique', 'auto_trips_queue_unique', 'auto_queue_counters_key', 'auto_trips_vehicle_one_active', 'auto_trips_driver_one_active', 'auto_bookings_user_trip_live', 'auto_bookings_user_idem', 'auto_bookings_private_request', 'auto_bookings_code', 'auto_drivers_phone', 'auto_vehicles_reg', 'auto_private_req_open']) {
    assert.ok(names.includes(n), `index ${n}`);
  }
});
