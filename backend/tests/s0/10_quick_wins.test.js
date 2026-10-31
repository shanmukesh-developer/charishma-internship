// S0 item 10 quick wins: auth cache keyed by account type, inactive stores hidden from the public store
// endpoint, the community feed's fallback path applies moderation / block filters, and the
// community_new_post broadcast carries only public card fields.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers');

let student; let admin; let rider; let store; let inactive;
test.before(async () => {
  await H.setup();
  student = await H.mkUser({ name: 'Quick Student' });
  admin = await H.mkUser({ role: 'admin' });
  rider = await H.mkRider();
  store = await H.mkStore();
  inactive = await H.mkStore({ isActive: false });
});
test.after(() => H.teardown());

test('auth cache: a token is never answered from another account type\'s cached row', async () => {
  // prime the cache with the rider account
  let r = await H.api('GET', '/api/orders/myorders', rider.token);
  assert.notStrictEqual(r.status, 401);
  // same id, customer-type token (e.g. a forged / mixed-up role claim): must not reuse the rider row
  const crossToken = H.tokenFor(rider.id, 'student');
  r = await H.api('GET', '/api/chat/conversations', crossToken);
  assert.strictEqual(r.status, 401, `got ${r.status} ${JSON.stringify(r.body)}`);
  // and the rider token is still a rider (403 on a student route, not 401)
  r = await H.api('GET', '/api/chat/conversations', rider.token);
  assert.strictEqual(r.status, 403);
});

test('auth cache: a suspension applies at once (clearCachedUser drops every account type; never cached as active)', async () => {
  const { protect, clearCachedUser } = H.r('middleware/authMiddleware');
  let r = await H.api('GET', '/api/chat/conversations', student.token);
  assert.strictEqual(r.status, 200);
  await H.ctx.M.User.update({ isActive: false }, { where: { id: student.id } });
  clearCachedUser(student.id);
  r = await H.api('GET', '/api/chat/conversations', student.token);
  assert.strictEqual(r.status, 403);
  // repeated calls stay 403 (a suspended row is never cached as a live session)
  const call = () => new Promise((res) => {
    const req = { headers: { authorization: `Bearer ${student.token}` } };
    const out = { status: (c) => ({ json: () => res(c) }) };
    protect(req, out, () => res('next'));
  });
  assert.strictEqual(await call(), 403);
  assert.strictEqual(await call(), 403);
  await H.ctx.M.User.update({ isActive: true }, { where: { id: student.id } });
  clearCachedUser(student.id);
  assert.strictEqual(await call(), 'next');
});

test('inactive store: public 404 (not cached for others); the store itself and admins still read it', async () => {
  let r = await H.api('GET', `/api/users/restaurants/${inactive.id}`);
  assert.strictEqual(r.status, 404);
  r = await H.api('GET', `/api/users/restaurants/${inactive.id}`, student.token);
  assert.strictEqual(r.status, 404);
  r = await H.api('GET', `/api/users/restaurants/${inactive.id}`, inactive.token);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  r = await H.api('GET', `/api/users/restaurants/${inactive.id}`, admin.token);
  assert.strictEqual(r.status, 200);
  // the store's own read did not fill the shared cache for anonymous callers
  r = await H.api('GET', `/api/users/restaurants/${inactive.id}`);
  assert.strictEqual(r.status, 404);
  // another store's token cannot read it
  r = await H.api('GET', `/api/users/restaurants/${inactive.id}`, store.token);
  assert.strictEqual(r.status, 404);
  r = await H.api('GET', `/api/users/restaurants/${store.id}`);
  assert.strictEqual(r.status, 200, 'active stores unchanged');
});

test('community feed fallback path hides moderated posts and people blocked with the viewer', async () => {
  const M = H.ctx.M;
  const blockedAuthor = await H.mkUser({ name: 'Blocked Author' });
  const okPost = await M.CommunityPost.create({ userId: admin.id, userName: 'Admin', content: 'visible post', likes: 0 });
  const hiddenPost = await M.CommunityPost.create({ userId: admin.id, userName: 'Admin', content: 'moderated post', likes: 0 });
  const blockedPost = await M.CommunityPost.create({ userId: blockedAuthor.id, userName: 'Blocked Author', content: 'blocked post', likes: 0 });
  await M.FriendsContentState.create({ targetType: 'community_post', targetId: hiddenPost.id, status: 'hidden' });
  await M.Friendship.create({ requesterId: student.id, recipientId: blockedAuthor.id, status: 'blocked' });
  // force the fallback branch: the first findAll (with parentId / expiresAt) fails once
  const CP = M.CommunityPost;
  const orig = CP.findAll;
  let first = true;
  CP.findAll = function (...a) { if (first) { first = false; return Promise.reject(new Error('no parentId column')); } return orig.apply(this, a); };
  try {
    const r = await H.api('GET', '/api/community', student.token);
    assert.strictEqual(r.status, 200);
    const contents = r.body.map((p) => p.content);
    assert.ok(contents.includes('visible post'));
    assert.ok(!contents.includes('moderated post'), 'moderated post leaked through the fallback');
    assert.ok(!contents.includes('blocked post'), 'blocked author leaked through the fallback');
  } finally {
    CP.findAll = orig;
  }
  assert.ok(okPost && blockedPost);
});

test('community_new_post broadcast: public card fields only (no author account / order / store ids)', async () => {
  H.ctx.emitted.length = 0;
  const r = await H.api('POST', '/api/community', student.token, { content: 'hello campus feed' });
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  const ev = H.ctx.emitted.find((e) => e.ev === 'community_new_post');
  assert.ok(ev);
  assert.strictEqual(ev.p.id, r.body.id);
  assert.strictEqual(ev.p.content, 'hello campus feed');
  for (const k of ['userId', 'orderId', 'restaurantId', 'likedBy']) assert.strictEqual(ev.p[k], undefined, k);
  // the author's own POST response keeps the full shape
  assert.strictEqual(r.body.userId, student.id);
});

test('likes: a burst on one post is one broadcast (plus one with the latest count); 30 a minute per account', async () => {
  const author = await H.mkUser({ name: 'Post Author' });
  const post = await H.api('POST', '/api/community', author.token, { content: 'like storm test' });
  assert.strictEqual(post.status, 201, JSON.stringify(post.body));
  const liker = await H.mkUser({ name: 'Fast Liker' });
  H.ctx.emitted.length = 0;
  let last;
  for (let i = 0; i < 30; i++) {
    last = await H.api('PUT', `/api/community/${post.body.id}/like`, liker.token);
    assert.strictEqual(last.status, 200, JSON.stringify(last.body));
  }
  const now = H.ctx.emitted.filter((e) => e.ev === 'community_post_liked');
  assert.strictEqual(now.length, 1, `one immediate broadcast, got ${now.length}`);
  const over = await H.api('PUT', `/api/community/${post.body.id}/like`, liker.token);
  assert.strictEqual(over.status, 429, JSON.stringify(over.body));
  await new Promise((r) => setTimeout(r, 1700));
  const all = H.ctx.emitted.filter((e) => e.ev === 'community_post_liked');
  assert.strictEqual(all.length, 2, 'then one more with the latest count');
  assert.strictEqual(all[1].p.likes, 0, '30 toggles end unliked');
});
