// Driver SOS location (21 Oct polish): the Auto Driver app has no GPS module, so an SOS without lat / lon
// carries the current trip's pickup stand as the last known spot (clearly labelled, never as live GPS).
// With lat / lon the live position is used as before.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

const { api } = H;

before(async () => {
  await H.setup({ label: 'ar-sos-location' });
  await H.mkAdmin();
});
after(H.teardown);

test('SOS without GPS: the current trip pickup stand is the last known spot', async () => {
  await H.setFlag(true);
  const t = await H.mkTrip({ capacity: 4, seatFare: 30 });
  const r = await api('POST', '/api/auto-ride/driver/sos', t.token, { note: 'Feeling unsafe' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.locationSource, 'pickupPoint');
  assert.equal(r.body.incident.tripId, t.trip.id);
  assert.match(r.body.incident.description, /Feeling unsafe/);
  assert.match(r.body.incident.description, /Last known spot \(trip pickup stand, not live GPS\): Main Gate Stand, Opposite the main gate\./);
  assert.match(r.body.incident.description, /16\.4625,80\.5065 \(https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=16\.4625,80\.5065\)/);
  assert.equal(r.body.emergencyNumber, '112');
});

test('SOS with GPS keeps the live position; no trip and no GPS has no location', async () => {
  const t = await H.mkTrip({ capacity: 4, seatFare: 30 });
  const r = await api('POST', '/api/auto-ride/driver/sos', t.token, { lat: 16.47, lon: 80.51 });
  assert.equal(r.status, 201);
  assert.equal(r.body.locationSource, 'gps');
  assert.match(r.body.incident.description, /Location: 16\.47,80\.51/);
  assert.doesNotMatch(r.body.incident.description, /pickup stand/);

  const d = await H.mkDriver({ capacity: 2 });
  const r2 = await api('POST', '/api/auto-ride/driver/sos', d.token, {});
  assert.equal(r2.status, 201);
  assert.equal(r2.body.locationSource, null);
  assert.doesNotMatch(r2.body.incident.description, /Location|Last known/);
});
