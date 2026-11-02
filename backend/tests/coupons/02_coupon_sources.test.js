// Where coupons come from (31 Oct 2026): the admin coupon form, the Lucky Spin, Vault deals and Wall photo contests.
// Each makes exactly the coupon it promises (value, type, owner, expiry, restrictions), never twice, and that coupon
// then works at checkout. Wall contests: one winner coupon per contest even when two finalize runs race, the prize is
// held to ₹1-₹1000 (create, update and old rows), and a contest nobody won announces nothing to every student.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const H = require('../c5/helpers');

const { api } = H;
const DAY = 24 * 60 * 60 * 1000;
const topicPushes = [];
let base; let server; let admin;

const call = async (method, url, token, body) => {
  const h = { 'content-type': 'application/json' };
  if (token) h.authorization = `Bearer ${token}`;
  const res = await fetch(base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json };
};
const coupons = (userId) => H.ctx.M('Coupon').findAll({ where: { userId } });
const quote = (u, items, couponCode) => api('POST', '/api/orders/quote', u.token, { items, couponCode });

before(async () => {
  await H.setup();
  // Topic pushes (every student) are recorded; the Wall code reads the function when it loads, so swap it first.
  // Wall announcements to every student (utils/campusBroadcast, 1 Nov 2026: was an FCM topic no app listens to) are
  // recorded; the Wall code calls the module's function at send time, so swapping it here is enough.
  H.r('utils/campusBroadcast').broadcastToStudents = async (title, body, data) => { topicPushes.push({ topic: 'students', title, body, data }); return { sent: true }; };
  const seq = H.ctx.sequelize;
  H.r('models/VaultItem').initVaultItemModel(seq);
  H.r('models/WallEvent').initWallEventModel(seq);
  H.r('models/WallSubmission').initWallSubmissionModel(seq);
  H.r('models/WallLike').initWallLikeModel(seq);
  const M = seq.models;
  M.WallEvent.hasMany(M.WallSubmission, { foreignKey: 'eventId', as: 'submissions' });
  M.WallSubmission.belongsTo(M.WallEvent, { foreignKey: 'eventId', as: 'event' });
  M.WallSubmission.belongsTo(M.User, { foreignKey: 'userId', as: 'user' });
  M.WallSubmission.hasMany(M.WallLike, { foreignKey: 'submissionId', as: 'likes' });
  M.WallLike.belongsTo(M.WallSubmission, { foreignKey: 'submissionId', as: 'submission' });
  for (const n of ['VaultItem', 'WallEvent', 'WallSubmission', 'WallLike']) await M[n].sync();
  const express = require(path.join(H.B, 'node_modules/express'));
  const app = express();
  app.use(express.json());
  app.use('/api/vault', H.r('routes/vaultRoutes'));
  app.use('/api/wall', H.r('routes/wallRoutes'));
  server = await require('../listenFree').listenFree(app);
  base = `http://127.0.0.1:${server.address().port}`;
  admin = await H.mkUser({ role: 'admin' });
});
after(async () => {
  if (server) await new Promise((res) => server.close(() => res()));
  await H.teardown();
});

test('admin coupon form: only real coupons are created (type, ₹0-₹5000, code, a real student, unique code); students cannot', async () => {
  const u = await H.mkUser();
  const create = (body, token = admin.token) => api('POST', '/api/admin/coupons', token, { userId: u.id, type: 'DISCOUNT', value: 50, ...body });
  assert.equal((await create({ code: 'EVT-OK-1', value: 6000 })).status, 400, 'over ₹5000');
  assert.equal((await create({ code: 'EVT-OK-1', value: -5 })).status, 400, 'negative');
  assert.equal((await create({ code: 'EVT-OK-1', type: 'PERCENT' })).status, 400, 'unknown type');
  assert.equal((await create({ code: 'EVT OK 1' })).status, 400, 'spaces in the code');
  assert.equal((await create({ code: 'EVT-OK-1', userId: '00000000-0000-4000-8000-000000000999' })).status, 404, 'no such student');
  assert.equal((await create({ code: 'EVT-OK-1', expiryDate: 'not a date' })).status, 400);
  const student = await H.mkUser();
  assert.equal((await create({ code: 'EVT-OK-1' }, student.token)).status, 403, 'students cannot create coupons');
  const ok = await create({ code: 'EVT-OK-1' });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal((await create({ code: 'EVT-OK-1' })).status, 400, 'duplicate code');
  const rows = await coupons(u.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].value, 50);
  assert.ok(new Date(rows[0].expiryDate) > new Date(), 'default expiry is ahead (7 days)');
  const { item } = await H.mkStore({ price: 100 });
  const q = await quote(u, [{ menuItemId: item.id, quantity: 1 }], 'EVT-OK-1');
  assert.equal(q.body.coupon.discount, 50);
});

test('Lucky Spin: every 15th spin is a 7-day free-delivery coupon for the spinner, and it works at checkout', async () => {
  const u = await H.mkUser({ completedOrders: 30, spinsUsed: 14 });
  const r = await api('POST', '/api/rewards/use-spin', u.token, {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.prizeIndex, 0);
  assert.ok(r.body.coupon && /^ZF-/.test(r.body.coupon.code));
  const rows = await coupons(u.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].type, 'FREEDEL');
  const days = (new Date(rows[0].expiryDate) - Date.now()) / DAY;
  assert.ok(days > 6.9 && days <= 7, `expires in 7 days (${days})`);
  const { item } = await H.mkStore({ price: 100 });
  const q = await quote(u, [{ menuItemId: item.id, quantity: 1 }], rows[0].code);
  assert.equal(q.status, 200, JSON.stringify(q.body));
  assert.equal(q.body.coupon.discount, q.body.deliveryFee);
});

test('Vault deal: one claim per student per day, stock goes down to 0 and stops, the coupon is tied to the deal', async () => {
  const { store, item } = await H.mkStore({ price: 100 });
  const box = await H.ctx.M('MenuItem').create({ restaurantId: store.id, name: 'Brownie Box', price: 249, isAvailable: true });
  const deal = await H.ctx.M('VaultItem').create({ name: 'Brownie Box', price: 99, originalPrice: 249, remainingCount: 2, isActive: true, restaurantId: store.id, menuItemId: box.id });
  const a = await H.mkUser();
  const b = await H.mkUser();
  const c = await H.mkUser();
  const first = await call('POST', `/api/vault/claim/${deal.id}`, a.token);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.coupon.type, 'DISCOUNT');
  assert.equal(first.body.coupon.value, 150, 'original ₹249 - deal ₹99');
  assert.equal(first.body.coupon.minOrderValue, 249);
  assert.equal((await call('POST', `/api/vault/claim/${deal.id}`, a.token)).status, 400, 'same student, same day');
  assert.equal((await call('POST', `/api/vault/claim/${deal.id}`, b.token)).status, 200);
  const sold = await call('POST', `/api/vault/claim/${deal.id}`, c.token);
  assert.equal(sold.status, 400, 'sold out');
  assert.equal((await H.ctx.M('VaultItem').findByPk(deal.id)).remainingCount, 0);
  assert.equal((await coupons(c.id)).length, 0);
  // At checkout: only at the deal's store, with the box, from ₹249.
  const code = first.body.code;
  const { item: otherStoreItem } = await H.mkStore({ price: 300 });
  assert.equal((await quote(a, [{ menuItemId: otherStoreItem.id, quantity: 1 }], code)).body.code, 'COUPON_WRONG_STORE');
  assert.equal((await quote(a, [{ menuItemId: item.id, quantity: 3 }], code)).body.code, 'COUPON_ITEM_REQUIRED');
  const ok = await quote(a, [{ menuItemId: box.id, quantity: 1 }], code);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.coupon.discount, 150);
  const expires = new Date((await coupons(a.id))[0].expiryDate);
  assert.ok(expires - Date.now() <= DAY, 'valid until the end of today (IST)');
});

test('Wall contest: one ₹ coupon for the most-voted photo even when two finalize runs race; one announcement, first name only', async () => {
  const { processExpiredWallEvents } = H.r('cron/wallCron');
  const M = H.ctx.sequelize.models;
  const ev = await M.WallEvent.create({ title: 'Diwali Lights', startTime: new Date(Date.now() - 2 * DAY), endTime: new Date(Date.now() - 60 * 1000), status: 'ACTIVE', couponValue: 150 });
  const winner = await H.mkUser({ name: 'Ananya Reddy Kumari' });
  const runnerUp = await H.mkUser();
  const voters = await Promise.all([1, 2, 3].map(() => H.mkUser()));
  const s1 = await M.WallSubmission.create({ eventId: ev.id, userId: winner.id, imageUrl: 'https://example.invalid/a.jpg', isApproved: true });
  const s2 = await M.WallSubmission.create({ eventId: ev.id, userId: runnerUp.id, imageUrl: 'https://example.invalid/b.jpg', isApproved: true, likeCount: 99 });
  await M.WallLike.create({ submissionId: s1.id, userId: voters[0].id });
  await M.WallLike.create({ submissionId: s1.id, userId: voters[1].id });
  await M.WallLike.create({ submissionId: s2.id, userId: voters[2].id });
  topicPushes.length = 0;
  const done = await Promise.all([processExpiredWallEvents(), processExpiredWallEvents()]);
  assert.equal(done[0] + done[1], 1, 'finalized once');
  const won = await coupons(winner.id);
  assert.equal(won.length, 1);
  assert.equal(won[0].type, 'DISCOUNT');
  assert.equal(won[0].value, 150);
  assert.match(won[0].code, /^WALL-/);
  assert.equal((await coupons(runnerUp.id)).length, 0, 'counted from real votes, not the cached likeCount');
  const fresh = await M.WallEvent.findByPk(ev.id);
  assert.equal(fresh.status, 'ENDED');
  assert.equal(fresh.couponCode, won[0].code);
  const ann = topicPushes.filter((p) => p.data && p.data.type === 'WALL_EVENT_ENDED');
  assert.equal(ann.length, 1);
  assert.match(ann[0].body, /Congratulations to Ananya for winning/);
  assert.doesNotMatch(ann[0].body, /Reddy/);
  const { item } = await H.mkStore({ price: 200 });
  const q = await quote(winner, [{ menuItemId: item.id, quantity: 1 }], won[0].code);
  assert.equal(q.body.coupon.discount, 150);
});

test('Wall contest nobody voted for: ends with no coupon and no "we have a winner" push to every student', async () => {
  const { processExpiredWallEvents } = H.r('cron/wallCron');
  const M = H.ctx.sequelize.models;
  const ev = await M.WallEvent.create({ title: 'Quiet Week', startTime: new Date(Date.now() - 2 * DAY), endTime: new Date(Date.now() - 60 * 1000), status: 'ACTIVE', couponValue: 100 });
  const u = await H.mkUser();
  await M.WallSubmission.create({ eventId: ev.id, userId: u.id, imageUrl: 'https://example.invalid/c.jpg', isApproved: true });
  topicPushes.length = 0;
  assert.equal(await processExpiredWallEvents(), 1);
  assert.equal((await M.WallEvent.findByPk(ev.id)).status, 'ENDED');
  assert.equal((await coupons(u.id)).length, 0);
  assert.equal(topicPushes.length, 0, JSON.stringify(topicPushes));
});

test('Wall prize held to ₹1-₹1000: create / update refuse anything else; an old out-of-range row pays at most ₹1000', async () => {
  const soon = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const later = new Date(Date.now() + 3 * DAY).toISOString();
  const create = (body) => call('POST', '/api/wall/events', admin.token, { title: 'Prize Check', startTime: soon, endTime: later, ...body });
  for (const bad of [0, -100, 1001, 10000, 'abc', 99.5]) {
    const r = await create({ couponValue: bad });
    assert.equal(r.status, 400, `prize ${bad}: ${JSON.stringify(r.body)}`);
  }
  assert.equal((await create({ endTime: soon, startTime: later })).status, 400, 'end before start');
  assert.equal((await create({ startTime: new Date(Date.now() - 2 * DAY).toISOString(), endTime: new Date(Date.now() - DAY).toISOString() })).status, 400, 'already over');
  assert.equal((await create({ startTime: 'tomorrow-ish' })).status, 400, 'not a time');
  const student = await H.mkUser();
  assert.equal((await call('POST', '/api/wall/events', student.token, { title: 'x', startTime: soon, endTime: later })).status, 403);
  const def = await create({});
  assert.equal(def.status, 201, JSON.stringify(def.body));
  assert.equal(def.body.couponValue, 100, 'default prize');
  const ok = await create({ couponValue: 250 });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.couponValue, 250);
  const id = ok.body.id;
  assert.equal((await call('PUT', `/api/wall/events/${id}`, admin.token, { couponValue: 2000 })).status, 400);
  assert.equal((await call('PUT', `/api/wall/events/${id}`, admin.token, { endTime: soon.replace(/T.*/, 'T00:00:00.000Z') })).status, 400, 'end before start');
  const up = await call('PUT', `/api/wall/events/${id}`, admin.token, { couponValue: 500 });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  assert.equal((await H.ctx.sequelize.models.WallEvent.findByPk(id)).couponValue, 500);
  // A row saved before these checks (direct database edit / older build) with ₹5000: the winner gets ₹1000.
  const M = H.ctx.sequelize.models;
  const old = await M.WallEvent.create({ title: 'Old Row', startTime: new Date(Date.now() - 2 * DAY), endTime: new Date(Date.now() - 1000), status: 'ACTIVE', couponValue: 5000 });
  const w = await H.mkUser();
  const voter = await H.mkUser();
  const sub = await M.WallSubmission.create({ eventId: old.id, userId: w.id, imageUrl: 'https://example.invalid/d.jpg', isApproved: true });
  await M.WallLike.create({ submissionId: sub.id, userId: voter.id });
  await H.r('cron/wallCron').processExpiredWallEvents();
  const won = await coupons(w.id);
  assert.equal(won.length, 1);
  assert.equal(won[0].value, 1000);
});

// 1 Nov 2026: Wall announcements reach real devices (tokens, not an FCM topic) and only while Campus is on.
test('Wall announcement: every active student device while Campus is on; nothing while Campus is off', async () => {
  const CB = H.r('utils/campusBroadcast');
  const real = CB.broadcastToStudents;
  // The real helper again (the suite swapped it to record announcements).
  delete require.cache[require.resolve(require('path').join(H.B, 'utils/campusBroadcast'))];
  const fresh = require(require('path').join(H.B, 'utils/campusBroadcast'));
  const push = H.r('utils/push');
  const savedTokens = push.sendPushToTokens;
  const calls = [];
  push.sendPushToTokens = async (tokens, title, body, data, opts) => { calls.push({ tokens, title, data, recipients: (opts && opts.recipients) || [] }); };
  const flags = H.r('modules/friends/services/featureFlags');
  try {
    const a = await H.mkUser();
    const b = await H.mkUser();
    const U = H.ctx.sequelize.models.User;
    await U.update({ fcmTokens: ['tok-a1', 'tok-a2'] }, { where: { id: a.id } });
    await U.update({ fcmTokens: JSON.stringify(['tok-b1', 'tok-a1']) }, { where: { id: b.id } });
    await flags.setConfig({ enabled: true });
    const on = await fresh.broadcastToStudents('📸 The Wall Photo Contest is LIVE!', 'Submit your photo', { type: 'WALL_EVENT_STARTED' });
    assert.equal(on.sent, true, JSON.stringify(on));
    assert.equal(calls.length, 1);
    for (const t of ['tok-a1', 'tok-a2', 'tok-b1']) assert.ok(calls[0].tokens.includes(t), t);
    assert.equal(new Set(calls[0].tokens).size, calls[0].tokens.length, 'each device once');
    assert.ok(calls[0].recipients.includes(a.id) && calls[0].recipients.includes(b.id));
    await flags.setConfig({ enabled: false });
    const off = await fresh.broadcastToStudents('📸 The Wall Photo Contest is LIVE!', 'Submit your photo', { type: 'WALL_EVENT_STARTED' });
    assert.deepEqual(off, { sent: false, reason: 'campus_off' });
    assert.equal(calls.length, 1, 'nothing sent while Campus is off');
  } finally {
    await flags.setConfig({ enabled: true });
    push.sendPushToTokens = savedTokens;
    CB.broadcastToStudents = real;
  }
});
