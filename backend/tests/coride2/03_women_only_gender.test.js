// Women-only rides (host and join rules, list visibility, womenOnly in responses) and the profile gender
// update (PUT /api/users/profile { gender }) with its fixed list.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

let man; let woman; let woman2; let unset;
before(async () => {
  await H.setup();
  man = await H.mkUser({ gender: 'Male' });
  woman = await H.mkUser({ gender: 'Female' });
  woman2 = await H.mkUser({ gender: 'female' }); // older free-text rows still count
  unset = await H.mkUser();
});
after(H.teardown);

const post = (u, extra = {}) => H.api('POST', '/api/bikepool/posts', u.token, {
  creatorRole: 'rider', origin: 'SRM AP Main Gate', destination: 'Guntur', departureTime: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
  vehicleType: 'Car', availableSeats: 3, ...extra,
});

test('only a Female host can post a women-only ride', async () => {
  let r = await post(man, { womenOnly: true });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'WOMEN_ONLY_HOST');
  r = await post(unset, { womenOnly: true });
  assert.equal(r.status, 403);
  r = await post(man, { womenOnly: 'yes' });
  assert.equal(r.status, 400);
  r = await post(woman, { womenOnly: true });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.womenOnly, true);
  r = await post(man);
  assert.equal(r.status, 201);
  assert.equal(r.body.womenOnly, false);
});

test('joining a women-only ride needs a Female profile (403 otherwise); list hides it from others', async () => {
  const ride = (await post(woman, { womenOnly: true, autoApprove: true })).body;
  let r = await H.api('POST', `/api/bikepool/posts/${ride.id}/join`, man.token);
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'WOMEN_ONLY');
  assert.match(r.body.message, /women only/i);
  r = await H.api('POST', `/api/bikepool/posts/${ride.id}/join`, unset.token);
  assert.equal(r.status, 403);
  assert.equal(await H.ctx.M('PoolRequest').count({ where: { poolId: ride.id } }), 0);

  const manList = await H.api('GET', '/api/bikepool/posts', man.token);
  assert.ok(!manList.body.some((x) => x.id === ride.id));
  const womanList = await H.api('GET', '/api/bikepool/posts', woman2.token);
  const seen = womanList.body.find((x) => x.id === ride.id);
  assert.ok(seen);
  assert.equal(seen.womenOnly, true);

  r = await H.api('POST', `/api/bikepool/posts/${ride.id}/join`, woman2.token);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.pool.womenOnly, true);
  const mine = await H.api('GET', '/api/bikepool/my-rides', woman2.token);
  assert.equal(mine.body.find((x) => x.id === ride.id).womenOnly, true);
});

test('gender update: fixed list, case-insensitive, blank = Prefer not to say', async () => {
  const u = await H.mkUser({ gender: 'Male' });
  let r = await H.api('PUT', '/api/users/profile', u.token, { gender: 'female' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.gender, 'Female');
  assert.equal((await H.ctx.M('User').findByPk(u.id)).gender, 'Female');
  r = await H.api('PUT', '/api/users/profile', u.token, { gender: 'Alien' });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'INVALID_GENDER');
  r = await H.api('PUT', '/api/users/profile', u.token, { gender: 42 });
  assert.equal(r.status, 400);
  assert.equal((await H.ctx.M('User').findByPk(u.id)).gender, 'Female');
  r = await H.api('PUT', '/api/users/profile', u.token, { gender: 'PREFER NOT TO SAY' });
  assert.equal(r.body.gender, 'Prefer not to say');
  r = await H.api('PUT', '/api/users/profile', u.token, { gender: 'Other' });
  assert.equal(r.body.gender, 'Other');
  r = await H.api('PUT', '/api/users/profile', u.token, { gender: '' });
  assert.equal(r.body.gender, 'Prefer not to say');

  // After switching to Female the same account can host a women-only ride.
  await H.api('PUT', '/api/users/profile', u.token, { gender: 'Female' });
  assert.equal((await post(u, { womenOnly: true })).status, 201);
});
