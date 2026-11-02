// Colleges (owner, 31 Oct 2026: "SRM AP and VIT AP now, Amrita soon; admin can block ordering per college; each
// restaurant visible to its own college, no conflicts"). utils/campuses + GET /api/config/campuses, admin
// GET/PUT /api/admin/campuses, store visibleCampuses (admin save), GET /api/restaurants?college=, and the order /
// quote refusals: a paused or not-yet-open college, or a store that does not serve the student's college.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const H = require('../c5/helpers');

let base; let server; let admin;
test.before(async () => {
  await H.setup();
  const express = require(path.join(H.B, 'node_modules/express'));
  const app = express();
  app.use(express.json());
  app.use('/api/config', H.r('routes/appConfigRoutes'));
  app.use('/api/restaurants', H.r('routes/restaurantRoutes'));
  app.use('/api/catalogue', H.r('routes/catalogueRoutes'));
  server = await require('../listenFree').listenFree(app);
  base = `http://127.0.0.1:${server.address().port}`;
  admin = await H.mkUser({ role: 'admin' });
});
test.after(async () => {
  if (server) await new Promise((res) => server.close(() => res()));
  await H.teardown();
});

const get = async (url) => { const r = await fetch(base + url); return { status: r.status, body: await r.json() }; };
const flush = () => { H.r('utils/campuses')._resetCache(); H.r('utils/responseCache').invalidate('config'); H.r('utils/responseCache').invalidate('catalog'); try { H.r('controllers/adminController').clearRestaurantsCache(); } catch { /* ok */ } };
const setStatus = (key, status, token = admin.token) => H.api('PUT', `/api/admin/campuses/${key}`, token, { status });
const order = (u, itemId, campus, address, extra = {}) => H.api('POST', '/api/orders', u.token, { ...H.orderBody(itemId, 'COD'), campus, deliveryAddress: address, ...extra });
const quote = (u, itemId, campus) => H.api('POST', '/api/orders/quote', u.token, { items: [{ menuItemId: itemId, quantity: 1 }], campus });
const SRM_ADDR = 'Block A, Room 101, SRM AP';
const VIT_ADDR = 'Block C, Room 12, VIT AP';

test('college list: SRM AP and VIT AP open, Amrita coming soon by default', async () => {
  flush();
  const r = await get('/api/config/campuses');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.campuses.map((c) => [c.key, c.label, c.status]), [['srmap', 'SRM AP', 'open'], ['vitap', 'VIT AP', 'open'], ['amrita', 'Amrita', 'soon']]);
});

test('admin pauses / reopens a college (validated, admins only); the generic config route cannot write it', async () => {
  const student = await H.mkUser();
  assert.equal((await setStatus('srmap', 'paused', student.token)).status, 403);
  assert.equal((await setStatus('harvard', 'paused')).status, 400);
  assert.equal((await setStatus('srmap', 'closed')).status, 400);
  const p = await setStatus('srmap', 'paused');
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.equal((await get('/api/config/campuses')).body.campuses.find((c) => c.key === 'srmap').status, 'paused', 'public list updated at once');
  const list = await H.api('GET', '/api/admin/campuses', admin.token);
  assert.equal(list.status, 200);
  assert.ok(list.body.campuses.every((c) => Number.isInteger(c.stores)));
  assert.equal((await H.api('POST', '/api/admin/config', admin.token, { key: 'CAMPUS_SERVICE', value: { srmap: 'open' } })).status, 400);
  assert.equal((await setStatus('srmap', 'open')).status, 200);
});

test('ordering: a paused college or a coming-soon one is refused (order and bill), the other college still orders', async () => {
  const { item } = await H.mkStore({ price: 100 });
  const u = await H.mkUser();
  await setStatus('srmap', 'paused');
  const r = await order(u, item.id, 'srmap', SRM_ADDR);
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'CAMPUS_PAUSED');
  assert.match(r.body.message, /SRM AP is paused/);
  assert.equal((await quote(u, item.id, 'srmap')).body.code, 'CAMPUS_PAUSED');
  const vit = await order(u, item.id, 'vitap', VIT_ADDR);
  assert.equal(vit.status, 201, JSON.stringify(vit.body));
  const am = await order(u, item.id, 'amrita', 'Amrita, Block 1');
  assert.equal(am.status, 400);
  assert.equal(am.body.code, 'CAMPUS_SOON');
  await setStatus('srmap', 'open');
  assert.equal((await order(u, item.id, 'srmap', SRM_ADDR)).status, 201);
  assert.equal(await H.ctx.M('Order').count({ where: { userId: u.id } }), 2, 'refused orders were never created');
});

test('stores: each college sees only its stores (and the all-colleges ones); a store never takes another college\'s order', async () => {
  const { store: a, item: aItem } = await H.mkStore({ price: 100 });
  const { store: b, item: bItem } = await H.mkStore({ price: 100 });
  const { store: c } = await H.mkStore({ price: 100 });
  const save = (id, visibleCampuses) => H.api('POST', `/api/admin/restaurants/${id}`, admin.token, { visibleCampuses });
  let s = await save(a.id, ['SRM AP']);
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.deepEqual(s.body.visibleCampuses, ['srmap']);
  assert.deepEqual((await save(b.id, 'vit')).body.visibleCampuses, ['vitap']);
  assert.equal((await save(c.id, ['harvard'])).status, 400, 'unknown college');
  assert.equal((await save(c.id, ['srmap', 'vitap', 'amrita'])).body.visibleCampuses, null, 'every college = no limit');
  assert.equal((await save(c.id, [])).body.visibleCampuses, null);
  flush();
  const ids = (body) => body.map((r) => r.id || r._id);
  const srm = ids((await get('/api/restaurants?college=srmap')).body);
  const vit = ids((await get('/api/restaurants?college=vitap')).body);
  const all = ids((await get('/api/restaurants')).body);
  assert.ok(srm.includes(a.id) && srm.includes(c.id) && !srm.includes(b.id), 'SRM: its store + the all-colleges one');
  assert.ok(vit.includes(b.id) && vit.includes(c.id) && !vit.includes(a.id), 'VIT: its store + the all-colleges one');
  assert.ok([a.id, b.id, c.id].every((id) => all.includes(id)), 'no college asked: every store (older app builds)');
  const u = await H.mkUser();
  const cross = await order(u, bItem.id, 'srmap', SRM_ADDR);
  assert.equal(cross.status, 400);
  assert.equal(cross.body.code, 'STORE_NOT_AT_CAMPUS');
  assert.match(cross.body.message, /delivers to VIT AP only/);
  assert.equal((await quote(u, bItem.id, 'srmap')).body.code, 'STORE_NOT_AT_CAMPUS');
  assert.equal((await order(u, bItem.id, 'vitap', VIT_ADDR)).status, 201);
  assert.equal((await order(u, aItem.id, 'srmap', SRM_ADDR)).status, 201);
});

test('every list the app reads is scoped: Home stores, Groceries catalogue (types, stores, items), search', async () => {
  const M = H.ctx.sequelize.models;
  // Search loads each item's store (config/db.js makes this link on the server; the test harness does not).
  if (!M.MenuItem.associations.restaurant) M.MenuItem.belongsTo(M.Restaurant, { foreignKey: 'restaurantId', as: 'restaurant' });
  const hours = { start: '00:00', end: '00:00' };
  const mk = async (name, vendorType, visibleCampuses) => {
    const st = await M.Restaurant.create({ name, location: 'Campus', vendorType, operatingHours: hours, isActive: true, isOpenNow: true, password: 'storepass1', visibleCampuses });
    await M.MenuItem.create({ restaurantId: st.id, name: `${name} Special Thali`, price: 90, isAvailable: true, category: 'Meals' });
    return st;
  };
  const srmFood = await mk('Zeta SRM Mess', 'RESTAURANT', ['srmap']);
  const vitFood = await mk('Zeta VIT Mess', 'RESTAURANT', ['vitap']);
  const srmShop = await mk('Zeta SRM Mart', 'GROCERY', ['srmap']);
  const vitShop = await mk('Zeta VIT Mart', 'GROCERY', ['vitap']);
  flush();
  const ids = (list) => list.map((r) => r.id || r._id);
  // Home (GET /api/users/restaurants, the list the app really reads).
  const home = async (college) => ids((await H.api('GET', `/api/users/restaurants?fields=summary${college ? `&college=${college}` : ''}`)).body);
  const homeSrm = await home('srmap');
  assert.ok(homeSrm.includes(srmFood.id) && !homeSrm.includes(vitFood.id), 'Home: SRM sees its kitchen only');
  const homeVit = await home('vitap');
  assert.ok(homeVit.includes(vitFood.id) && !homeVit.includes(srmFood.id), 'Home: VIT sees its kitchen only');
  const homeAll = await home(null);
  assert.ok(homeAll.includes(srmFood.id) && homeAll.includes(vitFood.id), 'no college asked: all (older builds)');
  // Groceries catalogue.
  const items = async (college) => (await get(`/api/catalogue/items?type=grocery&college=${college}`)).body.items.map((it) => it.restaurantId || (it.store && it.store.id));
  assert.ok((await items('srmap')).includes(srmShop.id) && !(await items('srmap')).includes(vitShop.id), 'items: SRM only');
  assert.ok((await items('vitap')).includes(vitShop.id) && !(await items('vitap')).includes(srmShop.id), 'items: VIT only');
  const stores = ids((await get('/api/catalogue/stores?type=grocery&college=vitap')).body);
  assert.ok(stores.includes(vitShop.id) && !stores.includes(srmShop.id), 'stores: VIT only');
  // Search.
  const search = async (college) => (await H.api('GET', `/api/users/search?q=Zeta&college=${college}`)).body;
  const sSrm = await search('srmap');
  const names = (r) => [...r.restaurants.map((x) => x.name), ...r.items.map((x) => x.restaurantId && x.restaurantId.name)];
  assert.ok(names(sSrm).some((n) => /SRM/.test(n)) && !names(sSrm).some((n) => /VIT/.test(n)), `search SRM: ${names(sSrm).join(', ')}`);
  const sVit = await search('vitap');
  assert.ok(names(sVit).some((n) => /VIT/.test(n)) && !names(sVit).some((n) => /SRM/.test(n)), `search VIT: ${names(sVit).join(', ')}`);
});
