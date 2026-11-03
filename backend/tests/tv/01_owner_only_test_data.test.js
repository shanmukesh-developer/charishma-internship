// Owner-only test data (owner, 3 Nov 2026: "add valid mock data in every section, I will test it on the live server",
// then "only my accounts"): utils/testView + scripts/test_data_v2_seed.js. The seeded stores, items and deals are
// seen only by the accounts whose phones are in TEST_VIEWER_PHONES (and by admins); a signed-out caller, any other
// customer and any other rider never see them in lists, store pages, search, the catalogue or deals, and the shared
// caches never hand a tester's answer to anyone else. Test orders ring tester riders only; removal deletes it all and
// keeps it from coming back.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

process.env.NODE_ENV = 'test';
if (process.env.DELIVERY_SLOTS === undefined) process.env.DELIVERY_SLOTS = 'off';
process.env.JWT_SECRET = 'tv-owner-test-data-secret-not-for-prod';
delete process.env.DATABASE_URL;
delete process.env.REDIS_URL;
delete process.env.REDIS_ENABLED;
delete process.env.TEST_VIEWER_PHONES;
delete process.env.DISABLE_TEST_DATA_V2;
delete process.env.REMOVE_TEST_DATA_V2;

const B = path.join(__dirname, '..', '..');
const r = (rel) => require(path.join(B, rel));
const { Sequelize } = require(path.join(B, 'node_modules/sequelize'));
const express = require(path.join(B, 'node_modules/express'));
const jwt = require(path.join(B, 'node_modules/jsonwebtoken'));

const TESTER_PHONE = '9000000101';
const TESTER_TWO_PHONE = '9000000106';
const RIDER_TESTER_PHONE = '9000000103';
let ctx;
const tokenFor = (id, role) => jwt.sign({ id, role, tv: 0 }, process.env.JWT_SECRET);

test.before(async () => {
  const file = path.join(os.tmpdir(), `tv-${process.pid}-${crypto.randomBytes(4).toString('hex')}.sqlite`);
  const sequelize = new Sequelize({ dialect: 'sqlite', storage: file, logging: false });
  for (const [m, fn] of [
    ['models/User', 'initUserModel'], ['models/GlobalConfig', 'initGlobalConfigModel'], ['models/Notification', 'initNotificationModel'],
    ['models/Restaurant', 'initRestaurantModel'], ['models/MenuItem', 'initMenuItemModel'], ['models/DeliveryPartner', 'initDeliveryPartnerModel'],
    ['models/Order', 'initOrderModel'], ['models/VaultItem', 'initVaultItemModel'], ['models/Coupon', 'initCouponModel'],
    ['models/PGHostel', 'initPGHostelModel'], ['models/PGRoom', 'initPGRoomModel'], ['models/PGBooking', 'initPGBookingModel'],
    ['models/PGReview', 'initPGReviewModel'], ['models/PgPromotion', 'initPgPromotionModel'], ['models/BikePool', 'initBikePoolModel'],
    ['models/PoolRequest', 'initPoolRequestModel'],
  ]) r(m)[fn](sequelize);
  const M = sequelize.models;
  M.Order.belongsTo(M.Restaurant, { foreignKey: 'restaurantId', as: 'restaurant' });
  M.Restaurant.hasMany(M.MenuItem, { foreignKey: 'restaurantId', as: 'menuItems' });
  M.MenuItem.belongsTo(M.Restaurant, { foreignKey: 'restaurantId', as: 'restaurant' });
  M.PGRoom.belongsTo(M.PGHostel, { foreignKey: 'hostelId', as: 'hostel' });
  M.PGHostel.hasMany(M.PGRoom, { foreignKey: 'hostelId', as: 'rooms' });
  M.BikePool.belongsTo(M.User, { foreignKey: 'creatorId', as: 'creator' });
  M.BikePool.hasMany(M.PoolRequest, { foreignKey: 'poolId', as: 'requests' });
  r('utils/testView').hideTestRows(M.Restaurant, M.MenuItem, M.Order, M.VaultItem, M.PGHostel, M.PGRoom, M.BikePool);
  await sequelize.sync();
  r('config/db.js').getSequelize = () => sequelize;

  const app = express();
  app.use(express.json());
  app.use('/api', r('utils/testView').middleware());
  app.use('/api/restaurants', r('routes/restaurantRoutes'));
  app.use('/api/catalogue', r('routes/catalogueRoutes'));
  app.use('/api/search', r('routes/searchRoutes'));
  app.use('/api/vault', r('routes/vaultRoutes'));
  app.use('/api/pg', r('routes/pgRoutes'));
  app.use('/api/users', r('routes/userRoutes'));
  const server = await require('../listenFree').listenFree(app);

  const mkUser = (name, phone, role = 'student') => M.User.create({ name, phone, role, isActive: true, isVerified: true, password: `x-tv-${phone}` });
  const tester = await mkUser('TV Tester', TESTER_PHONE);
  const testerTwo = await mkUser('TV Tester Two', TESTER_TWO_PHONE);
  const customer = await mkUser('TV Student', '9000000102');
  const admin = await mkUser('TV Admin', '9000000104', 'admin');
  const testRider = await M.DeliveryPartner.create({ name: 'TV Rider (tester)', phone: RIDER_TESTER_PHONE, password: 'x-tv-r1', isApproved: true, isOnline: true });
  const rider = await M.DeliveryPartner.create({ name: 'TV Rider', phone: '9000000105', password: 'x-tv-r2', isApproved: true, isOnline: true });
  const real = await M.Restaurant.create({ name: 'TV Real Kitchen', location: 'Neerukonda', vendorType: 'RESTAURANT', isActive: true });
  await M.MenuItem.create({ restaurantId: real.id, name: 'TV Real Dosa', price: 60, isAvailable: true });
  ctx = {
    sequelize, M, server, file, base: `http://127.0.0.1:${server.address().port}`,
    tester: tokenFor(tester.id, 'student'), testerTwoId: testerTwo.id, testerId: tester.id, customer: tokenFor(customer.id, 'student'), admin: tokenFor(admin.id, 'admin'),
    testRider, rider, real,
  };
});

test.after(async () => {
  if (!ctx) return;
  await new Promise((res) => ctx.server.close(() => res()));
  await ctx.sequelize.close();
  for (const f of [ctx.file, `${ctx.file}-journal`]) { try { fs.unlinkSync(f); } catch { /* gone */ } }
});

const get = async (url, token) => {
  const res = await fetch(ctx.base + url, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, text, cache: res.headers.get('x-cache'), cc: res.headers.get('cache-control') };
};
const seed = () => r('scripts/test_data_v2_seed');
const testView = () => r('utils/testView');
const data = () => r('data/test_data_v2_2026-11-03.json');
const storeId = (key) => seed().idFor(key);

test('phone list: commas, spaces and +91 are cleaned; junk is dropped', () => {
  assert.deepStrictEqual(testView().parsePhones('+91 90000 00101, 9000000102;\n91-9000000103, abc, 123'), ['9000000101', '9000000102', '9000000103']);
  assert.deepStrictEqual(testView().parsePhones(['9000000101', 9000000101, null]), ['9000000101']);
});

test('the seed adds every store, item and deal once, all marked test data; a second run adds nothing', async () => {
  const d = data();
  const first = await seed().runTestDataV2Seed({ reason: 'test' });
  assert.strictEqual(first.stores, d.stores.length);
  assert.strictEqual(first.items, d.stores.reduce((n, s) => n + s.items.length, 0));
  assert.ok(first.deals >= 3);
  const { M } = ctx;
  assert.strictEqual(await M.Restaurant.count({ where: { isTestData: true } }), d.stores.length);
  assert.strictEqual(await M.MenuItem.count({ where: { isTestData: true } }), first.items);
  assert.strictEqual(await M.VaultItem.count({ where: { isTestData: true } }), first.deals);
  const again = await seed().runTestDataV2Seed({ reason: 'test' });
  assert.deepStrictEqual([again.stores, again.items, again.deals], [0, 0, 0]);
  assert.strictEqual(await M.Restaurant.count({ where: { isTestData: true } }), d.stores.length);
  // every item has its own photo, no store repeats one
  for (const s of d.stores) {
    const photos = s.items.map((i) => i.imageUrl);
    assert.ok(photos.every((u) => /^https:\/\/images\.unsplash\.com\/photo-/.test(u)), s.name);
    assert.strictEqual(new Set(photos).size, photos.length, s.name);
  }
});

test('nobody sees the test data before a tester phone is saved (signed out, a customer)', async () => {
  for (const token of [null, ctx.customer, ctx.tester]) {
    const list = await get('/api/restaurants', token);
    assert.strictEqual(list.status, 200);
    assert.ok(list.text.includes('TV Real Kitchen'));
    assert.ok(!list.text.includes('Tandoori Nights'), 'test store leaked');
  }
});

test('with the phone saved in Admin > Config, the tester sees the test stores; everyone else still does not', async () => {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } };
  await r('controllers/adminController').updateGlobalConfig({ body: { key: 'TEST_VIEWER_PHONES', value: `+91 ${TESTER_PHONE.slice(0, 5)} ${TESTER_PHONE.slice(5)}, ${RIDER_TESTER_PHONE}, ${TESTER_TWO_PHONE}` }, user: { id: 'admin' } }, res);
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepStrictEqual(res.body.value, [TESTER_PHONE, RIDER_TESTER_PHONE, TESTER_TWO_PHONE]);
  assert.deepStrictEqual(res.body.matched, { customers: 2, riders: 1 });

  const signedOut = await get('/api/restaurants');
  assert.ok(!signedOut.text.includes('Tandoori Nights'));
  const mine = await get('/api/restaurants', ctx.tester);
  assert.ok(mine.text.includes('Tandoori Nights') && mine.text.includes('TV Real Kitchen'));
  assert.strictEqual(mine.cache, 'BYPASS');
  assert.match(mine.cc, /private/);
  // the tester's answer was not cached for others, nor theirs served to the tester
  const afterTester = await get('/api/restaurants');
  assert.ok(!afterTester.text.includes('Tandoori Nights'), 'shared cache carried test stores');
  const other = await get('/api/restaurants', ctx.customer);
  assert.ok(!other.text.includes('Tandoori Nights'));
  const admin = await get('/api/restaurants', ctx.admin);
  assert.ok(admin.text.includes('Tandoori Nights'));
});

test('store page, menu, stalls, catalogue, search and deals: the tester sees test rows, others do not', async () => {
  const tandoori = storeId('restaurant:tandoori-nights');
  const page = await get(`/api/users/restaurants/${tandoori}`);
  assert.strictEqual(page.status, 404);
  const pageT = await get(`/api/users/restaurants/${tandoori}`, ctx.tester);
  assert.strictEqual(pageT.status, 200);
  assert.ok(pageT.text.includes('Tandoori Nights'));

  const menu = await get(`/api/restaurants/${tandoori}/menu`, ctx.customer);
  assert.ok(menu.status === 404 || !menu.text.includes('Mutton Rogan Josh'), menu.text.slice(0, 200));
  const menuT = await get(`/api/restaurants/${tandoori}/menu`, ctx.tester);
  assert.strictEqual(menuT.status, 200);
  assert.ok(menuT.text.includes('Mutton Rogan Josh'));

  const stalls = await get('/api/restaurants/local-vendors');
  assert.ok(!stalls.text.includes('Main Gate Chai Adda'));
  const stallsT = await get('/api/restaurants/local-vendors', ctx.tester);
  assert.ok(stallsT.text.includes('Main Gate Chai Adda'));

  const groceries = await get('/api/catalogue/items?type=grocery&includeUnavailable=true');
  assert.ok(!groceries.text.includes('Neerukonda Fresh Mart') && !groceries.text.includes('Robusta Bananas'));
  const groceriesT = await get('/api/catalogue/items?type=grocery&includeUnavailable=true', ctx.tester);
  assert.ok(groceriesT.text.includes('Robusta Bananas'));
  const repairs = await get('/api/catalogue/items?type=repairs&includeUnavailable=true', ctx.customer);
  assert.ok(!repairs.text.includes('Laptop Screen Replacement'));
  const repairsT = await get('/api/catalogue/items?type=repairs&includeUnavailable=true', ctx.tester);
  assert.ok(repairsT.text.includes('Laptop Screen Replacement'));

  const search = await get('/api/search?q=tandoori');
  assert.ok(!search.text.includes('Tandoori Nights'));
  const searchT = await get('/api/search?q=tandoori', ctx.tester);
  assert.ok(searchT.text.includes('Tandoori Nights'));
  const searchAgain = await get('/api/search?q=tandoori');
  assert.ok(!searchAgain.text.includes('Tandoori Nights'), 'search cache carried a test store');

  const deals = await get('/api/vault');
  assert.ok(!deals.text.includes('Mutton Rogan Josh'));
  const dealsT = await get('/api/vault', ctx.tester);
  assert.ok(dealsT.text.includes('Mutton Rogan Josh'));
});

test('PG stays: two test PGs with rooms; the tester sees them on the PG home and page, others do not', async () => {
  const { M } = ctx;
  assert.strictEqual(await M.PGHostel.count({ where: { isTestData: true } }), 2);
  assert.strictEqual(await M.PGRoom.count({ where: { isTestData: true } }), 7);
  const green = await M.PGHostel.findOne({ where: { name: 'Greenfield Boys PG' } });
  assert.ok(Array.isArray(green.photos) && green.photos.length === 3 && green.photos[0].isCover);
  assert.ok(green.photos.every((ph) => /^https:\/\/(thumb|upload)\.wikimedia\.org\//.test(ph.url)));
  assert.ok(green.messTimetable && green.messTimetable.meals.length === 4);
  const home = await get('/api/pg/home', ctx.customer);
  assert.strictEqual(home.status, 200);
  assert.ok(!home.text.includes('Greenfield Boys PG'));
  const homeT = await get('/api/pg/home', ctx.tester);
  assert.ok(homeT.text.includes('Greenfield Boys PG') && homeT.text.includes('Sunbeam'));
  const homeAgain = await get('/api/pg/home');
  assert.ok(!homeAgain.text.includes('Greenfield Boys PG'), 'PG cache carried a test PG');
  assert.strictEqual((await get(`/api/pg/${green.id}`)).status, 404);
  assert.strictEqual((await get(`/api/pg/${green.id}`, ctx.tester)).status, 200);
});

test('Co-Ride: rides hosted by the testers for the next days; only testers see them', async () => {
  const { M } = ctx;
  const out = await seed().runTestDataV2Seed({ reason: 'test' });
  const rides = await M.BikePool.findAll({ where: { isTestData: true } });
  assert.strictEqual(rides.length, 15, JSON.stringify(out));
  assert.ok(rides.every((x) => [ctx.testerId, ctx.testerTwoId].includes(x.creatorId) && new Date(x.departureTime) > new Date()));
  const tv = testView();
  assert.strictEqual((await tv.runAs({ filter: true }, () => M.BikePool.findAll({ where: { status: 'Available' } }))).length, 0);
  assert.strictEqual((await tv.runAs({ filter: false, tester: true }, () => M.BikePool.findAll({ where: { status: 'Available' } }))).length, 15);
  assert.strictEqual((await tv.runAs({ filter: true }, () => M.BikePool.count())), 0);
  // a second run tops up the same days without doubling them
  await seed().runTestDataV2Seed({ reason: 'test' });
  assert.strictEqual(await M.BikePool.count({ where: { isTestData: true } }), 15);
});

test('test orders: hidden from other customers and riders, offered only to tester riders', async () => {
  const { M } = ctx;
  const tandoori = storeId('restaurant:tandoori-nights');
  const order = await M.Order.create({ userId: (await M.User.findOne({ where: { phone: TESTER_PHONE } })).id, restaurantId: tandoori, items: [], totalPrice: 340, deliveryFee: 0, finalPrice: 340, paymentMethod: 'COD', status: 'Pending', isTestData: true });
  const tv = testView();
  const seen = async (view) => tv.runAs(view, () => M.Order.findAll({ where: { id: order.id } }));
  assert.strictEqual((await seen({ filter: true })).length, 0);
  assert.strictEqual((await seen({ filter: false, tester: true })).length, 1);
  assert.strictEqual((await M.Order.findAll({ where: { id: order.id } })).length, 1, 'outside a request nothing is filtered');

  const ranked = await r('utils/riderDispatch').rankOnlineRiders(await M.Restaurant.findByPk(tandoori));
  assert.deepStrictEqual(ranked.map((x) => x.rider.phone), [RIDER_TESTER_PHONE]);
  const rankedPartial = await r('utils/riderDispatch').rankOnlineRiders({ id: tandoori, location: 'x' });
  assert.deepStrictEqual(rankedPartial.map((x) => x.rider.phone), [RIDER_TESTER_PHONE]);
  const real = await r('utils/riderDispatch').rankOnlineRiders(ctx.real);
  assert.deepStrictEqual(real.map((x) => x.rider.phone).sort(), [RIDER_TESTER_PHONE, '9000000105']);

  // a rider's request: the tester rider sees the test order, another rider does not
  assert.deepStrictEqual(tv.viewOf({ headers: { authorization: `Bearer ${tokenFor(ctx.testRider.id, 'rider')}` } }), { filter: false, tester: true });
  assert.deepStrictEqual(tv.viewOf({ headers: { authorization: `Bearer ${tokenFor(ctx.rider.id, 'rider')}` } }), { filter: true, tester: false });
  assert.deepStrictEqual(tv.viewOf({ headers: { authorization: `Bearer ${tokenFor(ctx.real.id, 'restaurant')}` } }), { filter: false, tester: false });
  assert.deepStrictEqual(tv.viewOf({ headers: { authorization: 'Bearer not-a-token' } }), { filter: true, tester: false });
});

test('removal: test orders, deals, items and stores go; the real store stays; the seed does not add them back', async () => {
  const { M } = ctx;
  const out = await seed().removeTestDataV2({ by: 'test' });
  assert.deepStrictEqual(out.errors, []);
  assert.strictEqual(await M.Restaurant.count({ where: { isTestData: true } }), 0);
  assert.strictEqual(await M.MenuItem.count({ where: { isTestData: true } }), 0);
  assert.strictEqual(await M.VaultItem.count({ where: { isTestData: true } }), 0);
  assert.strictEqual(await M.Order.count({ where: { isTestData: true } }), 0);
  assert.strictEqual(await M.PGHostel.count({ where: { isTestData: true } }), 0);
  assert.strictEqual(await M.PGRoom.count({ where: { isTestData: true } }), 0);
  assert.strictEqual(await M.BikePool.count({ where: { isTestData: true } }), 0);
  assert.strictEqual(await M.Restaurant.count({ where: { name: 'TV Real Kitchen' } }), 1);
  assert.strictEqual(await M.MenuItem.count({ where: { name: 'TV Real Dosa' } }), 1);
  assert.deepStrictEqual(await seed().runTestDataV2Seed({ reason: 'test' }), { skipped: 'removed' });
  const status = await seed().testDataStatus();
  assert.ok(status.removed);
  assert.strictEqual(status.counts.stores, 0);

  const back = await seed().allowTestDataV2Again();
  assert.strictEqual(back.stores, data().stores.length);
  assert.strictEqual(await M.Restaurant.count({ where: { isTestData: true } }), data().stores.length);
  assert.strictEqual(await M.PGHostel.count({ where: { isTestData: true } }), 2);
  assert.strictEqual(await M.BikePool.count({ where: { isTestData: true } }), 15);
});

test('DISABLE_TEST_DATA_V2 skips the seed; REMOVE_TEST_DATA_V2 removes on the next start', async () => {
  process.env.DISABLE_TEST_DATA_V2 = 'true';
  assert.deepStrictEqual(await seed().runTestDataV2Seed(), { skipped: 'disabled' });
  delete process.env.DISABLE_TEST_DATA_V2;
  process.env.REMOVE_TEST_DATA_V2 = 'true';
  const out = await seed().runTestDataV2Seed();
  delete process.env.REMOVE_TEST_DATA_V2;
  assert.ok(out.removed && out.removed.stores >= 1);
  assert.strictEqual(await ctx.M.Restaurant.count({ where: { isTestData: true } }), 0);
});
