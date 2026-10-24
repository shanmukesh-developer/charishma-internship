// Regular rides: /api/bikepool/templates CRUD, validation, owner scoping, pause / resume, skip.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

let host; let other; let woman;
before(async () => {
  await H.setup();
  host = await H.mkUser({ gender: 'Male' });
  other = await H.mkUser();
  woman = await H.mkUser({ gender: 'Female' });
});
after(H.teardown);

test('sign-in is required', async () => {
  assert.equal((await H.api('GET', '/api/bikepool/templates')).status, 401);
  assert.equal((await H.api('POST', '/api/bikepool/templates', null, H.templateBody())).status, 401);
});

test('create a template: normalised values and the response shape', async () => {
  const r = await H.api('POST', '/api/bikepool/templates', host.token, H.templateBody({ days: [5, '1', 3, 1], vibe: 'x', rideVibe: 'Chatty', notes: 'Small <b>bag</b> ok', autoAcceptKnown: true }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const t = r.body.template;
  assert.deepEqual(t.days, [1, 3, 5]);
  assert.equal(t.time, '17:30');
  assert.equal(t.vehicleType, 'Car');
  assert.equal(t.seats, 3);
  assert.equal(t.estimatedFuelCost, 120);
  assert.equal(t.name, 'SRM AP Main Gate → Benz Circle');
  assert.equal(t.notes, 'Small bbag/b ok');
  assert.equal(t.autoAcceptKnown, true);
  assert.equal(t.autoApprove, false);
  assert.equal(t.womenOnly, false);
  assert.equal(t.active, true);
  assert.deepEqual(t.skipDates, []);
  assert.equal(t.lastPublishedDate, null);
  assert.ok(t.nextDepartureAt && !Number.isNaN(Date.parse(t.nextDepartureAt)));
  assert.equal(t.upcomingRide, null);
  const list = await H.api('GET', '/api/bikepool/templates', host.token);
  assert.equal(list.status, 200);
  assert.equal(list.body.templates.length, 1);
  assert.equal(list.body.templates[0].id, t.id);
});

test('validation: days, time, vehicle / seats, fuel range, text, booleans', async () => {
  const bad = async (extra, field) => {
    const r = await H.api('POST', '/api/bikepool/templates', host.token, H.templateBody(extra));
    assert.equal(r.status, 400, `${JSON.stringify(extra)} -> ${r.status} ${JSON.stringify(r.body)}`);
    if (field) assert.equal(r.body.field, field);
  };
  await bad({ days: [] }, 'days');
  await bad({ days: [7] }, 'days');
  await bad({ days: [-1] }, 'days');
  await bad({ days: 'Mon' }, 'days');
  await bad({ days: [1.5] }, 'days');
  await bad({ days: undefined }, 'days');
  await bad({ time: '5:30 PM' }, 'time');
  await bad({ time: '24:00' }, 'time');
  await bad({ time: '17:60' }, 'time');
  await bad({ time: undefined }, 'time');
  await bad({ vehicleType: 'auto' }, 'vehicleType');
  await bad({ vehicleType: 'bike', seats: 2 }, 'seats');
  await bad({ vehicleType: 'car', seats: 5 }, 'seats');
  await bad({ vehicleType: 'car', seats: 0 }, 'seats');
  await bad({ seats: 'two' }, 'seats');
  await bad({ estimatedFuelCost: -1 }, 'estimatedFuelCost');
  await bad({ estimatedFuelCost: 5001 }, 'estimatedFuelCost');
  await bad({ estimatedFuelCost: 'abc' }, 'estimatedFuelCost');
  await bad({ origin: '' }, 'origin');
  await bad({ destination: 'x'.repeat(121) }, 'destination');
  await bad({ notes: 'x'.repeat(301) }, 'notes');
  await bad({ autoApprove: 'yes' }, 'autoApprove');
  await bad({ skipDates: ['2026-02-31'] }, 'skipDates');
  // A bike defaults to its single seat.
  const ok = await H.api('POST', '/api/bikepool/templates', other.token, H.templateBody({ vehicleType: 'Bike', seats: undefined }));
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.template.seats, 1);
  assert.equal(ok.body.template.vehicleType, 'Bike');
});

test('owner scoped: another user cannot read, change, pause, skip or delete it', async () => {
  const t = (await H.api('POST', '/api/bikepool/templates', host.token, H.templateBody({ name: 'Evening run' }))).body.template;
  const otherList = await H.api('GET', '/api/bikepool/templates', other.token);
  assert.ok(!otherList.body.templates.some((x) => x.id === t.id));
  assert.equal((await H.api('PATCH', `/api/bikepool/templates/${t.id}`, other.token, { time: '08:00' })).status, 404);
  assert.equal((await H.api('POST', `/api/bikepool/templates/${t.id}/pause`, other.token)).status, 404);
  assert.equal((await H.api('POST', `/api/bikepool/templates/${t.id}/skip`, other.token, { date: H.r('utils/istTime').istYmd() })).status, 404);
  assert.equal((await H.api('DELETE', `/api/bikepool/templates/${t.id}`, other.token)).status, 404);
  assert.equal((await H.api('DELETE', '/api/bikepool/templates/not-a-uuid', host.token)).status, 404);
  assert.equal((await H.ctx.M('RideTemplate').findByPk(t.id)).time, '17:30');
});

test('PATCH changes only what is sent and re-checks seats against the vehicle', async () => {
  const t = (await H.api('POST', '/api/bikepool/templates', host.token, H.templateBody())).body.template;
  let r = await H.api('PATCH', `/api/bikepool/templates/${t.id}`, host.token, { time: '08:15', days: [0, 6] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.template.time, '08:15');
  assert.deepEqual(r.body.template.days, [0, 6]);
  assert.equal(r.body.template.seats, 3);
  r = await H.api('PATCH', `/api/bikepool/templates/${t.id}`, host.token, { vehicleType: 'bike', seats: 3 });
  assert.equal(r.status, 400);
  r = await H.api('PATCH', `/api/bikepool/templates/${t.id}`, host.token, { vehicleType: 'bike' });
  assert.equal(r.status, 200);
  assert.equal(r.body.template.seats, 1);
  r = await H.api('PATCH', `/api/bikepool/templates/${t.id}`, host.token, { time: '8:15' });
  assert.equal(r.status, 400);
  assert.equal(r.body.field, 'time');
});

test('pause / resume / skip / delete', async () => {
  const t = (await H.api('POST', '/api/bikepool/templates', host.token, H.templateBody())).body.template;
  let r = await H.api('POST', `/api/bikepool/templates/${t.id}/pause`, host.token);
  assert.equal(r.status, 200);
  assert.equal(r.body.template.active, false);
  assert.equal(r.body.template.nextDepartureAt, null);
  r = await H.api('POST', `/api/bikepool/templates/${t.id}/resume`, host.token);
  assert.equal(r.body.template.active, true);
  const { istYmd } = H.r('utils/istTime');
  const today = istYmd();
  const tomorrow = H.r('services/coRideTemplates').addDaysYmd(today, 1);
  r = await H.api('POST', `/api/bikepool/templates/${t.id}/skip`, host.token, { date: tomorrow });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.template.skipDates, [tomorrow]);
  assert.equal(r.body.cancelledRideId, null);
  r = await H.api('POST', `/api/bikepool/templates/${t.id}/skip`, host.token, { date: tomorrow });
  assert.deepEqual(r.body.template.skipDates, [tomorrow]); // no duplicate
  assert.equal((await H.api('POST', `/api/bikepool/templates/${t.id}/skip`, host.token, { date: '2020-01-01' })).status, 400);
  assert.equal((await H.api('POST', `/api/bikepool/templates/${t.id}/skip`, host.token, { date: 'today' })).status, 400);
  assert.equal((await H.api('POST', `/api/bikepool/templates/${t.id}/skip`, host.token, { date: H.r('services/coRideTemplates').addDaysYmd(today, 90) })).status, 400);
  r = await H.api('DELETE', `/api/bikepool/templates/${t.id}`, host.token);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, id: t.id });
  assert.equal(await H.ctx.M('RideTemplate').findByPk(t.id), null);
});

test('women-only template: Female hosts only', async () => {
  const r = await H.api('POST', '/api/bikepool/templates', host.token, H.templateBody({ womenOnly: true }));
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'WOMEN_ONLY_HOST');
  const ok = await H.api('POST', '/api/bikepool/templates', woman.token, H.templateBody({ womenOnly: true }));
  assert.equal(ok.status, 201);
  assert.equal(ok.body.template.womenOnly, true);
  const t = (await H.api('POST', '/api/bikepool/templates', host.token, H.templateBody())).body.template;
  assert.equal((await H.api('PATCH', `/api/bikepool/templates/${t.id}`, host.token, { womenOnly: true })).status, 403);
});

test('at most 10 templates per user', async () => {
  const u = await H.mkUser();
  for (let i = 0; i < 10; i++) assert.equal((await H.api('POST', '/api/bikepool/templates', u.token, H.templateBody())).status, 201);
  const r = await H.api('POST', '/api/bikepool/templates', u.token, H.templateBody());
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'TEMPLATE_LIMIT');
});
