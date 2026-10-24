// The 'coride.templates' job: publishes once per (template, IST date) ~150 min before departure, honours
// skip dates, pause, the ±60 min conflict rule and never publishes a past departure; 15-min reminder once.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

let T;
// 2030-01-07 is a Monday (weekday 1). All "now" values are India time.
const DAY = '2030-01-07';
const at = (hhmm, ymd = DAY) => new Date(`${ymd}T${hhmm}:00+05:30`);
const M = (n) => H.ctx.M(n);

before(async () => {
  await H.setup();
  T = H.r('services/coRideTemplates');
});
after(H.teardown);

const mkTemplate = async (host, extra = {}) => {
  const r = await H.api('POST', '/api/bikepool/templates', host.token, H.templateBody({ days: [1], time: '12:00', ...extra }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.template;
};
const ridesOf = (templateId) => M('BikePool').findAll({ where: { templateId } });

test('publishes 150 min before departure, exactly once; a re-run is a no-op', async () => {
  const host = await H.mkUser({ gender: 'Female', genderPreference: 'Any' });
  const t = await mkTemplate(host, { autoAcceptKnown: true, womenOnly: true, rideVibe: 'Music', notes: 'Gate 2' });
  H.pushes.length = 0;
  // 09:29 is 151 min before 12:00: not yet.
  let r = await T.publishDueTemplates({ now: at('09:29') });
  assert.equal(r.published, 0);
  assert.equal((await ridesOf(t.id)).length, 0);
  r = await T.publishDueTemplates({ now: at('09:31') });
  assert.equal(r.published, 1);
  const [ride] = await ridesOf(t.id);
  assert.equal(new Date(ride.departureTime).toISOString(), at('12:00').toISOString());
  assert.equal(ride.status, 'Available');
  assert.equal(ride.creatorId, host.id);
  assert.equal(ride.creatorRole, 'rider');
  assert.equal(ride.vehicleType, 'Car');
  assert.equal(ride.availableSeats, 3);
  assert.equal(ride.estimatedFuelCost, 120);
  assert.equal(ride.autoAcceptKnown, true);
  assert.equal(ride.womenOnly, true);
  assert.equal(ride.isRecurring, true);
  assert.equal(ride.rideVibe, 'Music');
  assert.equal(ride.notes, 'Gate 2');
  assert.equal((await M('RideTemplate').findByPk(t.id)).lastPublishedDate, DAY);
  // Push to the host with the deep link.
  const p = H.pushes.find((x) => x.data.type === 'CORIDE_TEMPLATE_LIVE');
  assert.ok(p, 'live push sent');
  assert.equal(p.title, 'Your 12:00 PM ride to Benz Circle is live');
  assert.equal(p.body, '3 seats · Tap to skip today');
  assert.equal(p.data.path, '/coride/regular');
  assert.equal(p.data.poolId, String(ride.id));
  assert.equal(p.data.date, DAY);
  assert.deepEqual(p.recipients.map(String), [String(host.id)]);
  // Re-runs (later ticks) publish nothing more.
  r = await T.publishDueTemplates({ now: at('09:36') });
  assert.equal(r.published, 0);
  assert.equal(r.duplicate, 1);
  await T.publishDueTemplates({ now: at('11:00') });
  assert.equal((await ridesOf(t.id)).length, 1);
  assert.equal(H.pushes.filter((x) => x.data.type === 'CORIDE_TEMPLATE_LIVE').length, 1);
});

test('two runners at once (two instances) still publish one ride', async () => {
  const host = await H.mkUser();
  const t = await mkTemplate(host, { time: '13:00' });
  const res = await Promise.all([T.publishDueTemplates({ now: at('11:00') }), T.publishDueTemplates({ now: at('11:00') })]);
  assert.equal(res.reduce((s, x) => s + x.published, 0) >= 1, true);
  assert.equal((await ridesOf(t.id)).length, 1);
  assert.equal(await M('RideTemplateRun').count({ where: { templateId: t.id } }), 1);
  // The unique index itself refuses a second (template, date) row.
  await assert.rejects(M('RideTemplateRun').create({ templateId: t.id, creatorId: host.id, rideDate: DAY, departureAt: at('13:00') }));
});

test('skip dates, pause and other weekdays publish nothing', async () => {
  const host = await H.mkUser();
  const skipped = await mkTemplate(host, { time: '12:00' });
  await M('RideTemplate').update({ skipDates: [DAY] }, { where: { id: skipped.id } });
  const host2 = await H.mkUser();
  const paused = await mkTemplate(host2, { time: '12:00' });
  assert.equal((await H.api('POST', `/api/bikepool/templates/${paused.id}/pause`, host2.token)).status, 200);
  const host3 = await H.mkUser();
  const tuesday = await mkTemplate(host3, { time: '12:00', days: [2] });
  const r = await T.publishDueTemplates({ now: at('10:00') });
  assert.ok(r.skipped >= 1);
  assert.equal((await ridesOf(skipped.id)).length, 0);
  assert.equal((await ridesOf(paused.id)).length, 0);
  assert.equal((await ridesOf(tuesday.id)).length, 0);
  // Resumed: it publishes on the next tick.
  assert.equal((await H.api('POST', `/api/bikepool/templates/${paused.id}/resume`, host2.token)).status, 200);
  await T.publishDueTemplates({ now: at('10:05') });
  assert.equal((await ridesOf(paused.id)).length, 1);
});

test('never publishes a departure that already passed (or leaves within 10 min)', async () => {
  const host = await H.mkUser();
  const t = await mkTemplate(host, { time: '12:00' });
  let r = await T.publishDueTemplates({ now: at('12:05') });
  assert.equal((await ridesOf(t.id)).length, 0);
  assert.ok(r.past >= 1);
  r = await T.publishDueTemplates({ now: at('11:55') });
  assert.equal((await ridesOf(t.id)).length, 0);
  assert.equal(await M('RideTemplateRun').count({ where: { templateId: t.id } }), 0);
});

test('the host already has an open ride within ±60 min: skipped', async () => {
  const host = await H.mkUser();
  const t = await mkTemplate(host, { time: '12:00' });
  const manual = await H.mkRide(host.id, { departureTime: at('12:45') });
  await T.publishDueTemplates({ now: at('10:00') });
  assert.equal((await ridesOf(t.id)).length, 0);
  // Once that ride is cancelled the template publishes.
  await manual.update({ status: 'Cancelled' });
  await T.publishDueTemplates({ now: at('10:05') });
  assert.equal((await ridesOf(t.id)).length, 1);
});

test('a ride just after midnight is published the evening before', async () => {
  const host = await H.mkUser();
  const t = await mkTemplate(host, { time: '00:30', days: [2] }); // Tuesday 00:30
  await T.publishDueTemplates({ now: at('22:10') }); // Monday 22:10
  const rides = await ridesOf(t.id);
  assert.equal(rides.length, 1);
  assert.equal(new Date(rides[0].departureTime).toISOString(), at('00:30', '2030-01-08').toISOString());
});

test('15-min reminder: host and approved riders, once; not for a cancelled ride', async () => {
  const host = await H.mkUser({ name: 'Kavya Reddy' });
  const rider = await H.mkUser();
  const t = await mkTemplate(host, { time: '15:00' });
  await T.publishDueTemplates({ now: at('13:00') });
  const [ride] = await ridesOf(t.id);
  await M('PoolRequest').create({ poolId: ride.id, passengerId: rider.id, status: 'Approved' });
  H.pushes.length = 0;
  let r = await T.sendDueReminders({ now: at('14:30') }); // 30 min out: too early
  assert.equal(r.reminded, 0);
  r = await T.sendDueReminders({ now: at('14:46') });
  assert.equal(r.reminded, 1);
  const hostPush = H.pushes.find((x) => x.recipients.map(String).includes(String(host.id)));
  assert.equal(hostPush.title, 'Your 3:00 PM ride to Benz Circle leaves in 15 min');
  const riderPush = H.pushes.find((x) => x.recipients.map(String).includes(String(rider.id)));
  assert.equal(riderPush.title, 'Your ride to Benz Circle leaves at 3:00 PM');
  assert.match(riderPush.body, /Kavya/);
  r = await T.sendDueReminders({ now: at('14:51') });
  assert.equal(r.reminded, 0);

  const host2 = await H.mkUser();
  const t2 = await mkTemplate(host2, { time: '16:00' });
  await T.publishDueTemplates({ now: at('14:00') });
  await M('BikePool').update({ status: 'Cancelled' }, { where: { templateId: t2.id } });
  H.pushes.length = 0;
  await T.sendDueReminders({ now: at('15:50') });
  assert.equal(H.pushes.length, 0);
});

test('skip today after it was published cancels that ride and tells its riders', async () => {
  const host = await H.mkUser();
  const rider = await H.mkUser();
  const { istYmd, istShift } = H.r('utils/istTime');
  const dep = new Date(Date.now() + 70 * 60 * 1000);
  const hhmm = istShift(dep).toISOString().slice(11, 16);
  const date = istYmd(dep);
  const t = (await H.api('POST', '/api/bikepool/templates', host.token, H.templateBody({ days: [0, 1, 2, 3, 4, 5, 6], time: hhmm }))).body.template;
  await T.publishDueTemplates({ now: new Date() });
  const [ride] = await ridesOf(t.id);
  assert.ok(ride, 'published');
  const list = await H.api('GET', '/api/bikepool/templates', host.token);
  const mine = list.body.templates.find((x) => x.id === t.id);
  assert.equal(mine.upcomingRide.poolId, ride.id);
  assert.equal(mine.upcomingRide.status, 'Available');
  await M('PoolRequest').create({ poolId: ride.id, passengerId: rider.id, status: 'Approved' });
  H.pushes.length = 0;
  const r = await H.api('POST', `/api/bikepool/templates/${t.id}/skip`, host.token, { date });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.cancelledRideId, ride.id);
  assert.ok(r.body.template.skipDates.includes(date));
  assert.equal((await M('BikePool').findByPk(ride.id)).status, 'Cancelled');
  assert.equal((await M('PoolRequest').findOne({ where: { poolId: ride.id } })).status, 'Cancelled');
  assert.ok(H.pushes.some((x) => x.data.type === 'CORIDE_RIDE_CANCELLED' && x.recipients.map(String).includes(String(rider.id))));
  // The next tick does not re-publish it.
  await T.publishDueTemplates({ now: new Date() });
  assert.equal((await ridesOf(t.id)).length, 1);
});

test('the job is registered every 5 minutes', () => {
  const job = H.r('jobs').listJobs().find((j) => j.name === 'coride.templates');
  assert.ok(job);
  assert.equal(job.schedule.everyMs, 5 * 60 * 1000);
});
