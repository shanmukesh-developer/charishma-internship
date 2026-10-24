// ZCS Auto stands seed (scripts/auto_routes_seed.js + data/auto_routes_v1_2026-10-24.json) on temp SQLite DBs:
// the first run creates the owner's 5 routes from SRM AP Main Gate with the exact seat fares (default inside
// min-max) and one pickup point each, and writes GlobalConfig AUTO_ROUTES_V1_DONE; a re-run is a no-op (with or
// without the marker, never a duplicate); a destination that already exists is skipped and left untouched (admin
// edits win); the data passes the admin controller's validation. Never touches a real database or the network.
process.env.NODE_ENV = 'test';
delete process.env.DATABASE_URL;
delete process.env.DISABLE_AUTO_ROUTES_SEED;

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const B = path.join(__dirname, '..', '..');
const r = (rel) => require(path.join(B, rel));
const stub = (rel, exports) => {
  const p = require.resolve(path.join(B, rel));
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
};
stub('config/firebase.js', { apps: [], getApps: () => [] });

const { Sequelize } = require(path.join(B, 'node_modules/sequelize'));
const autoRide = r('modules/autoRide');
const { runAutoRoutesSeed, DATA_PATH, DEFAULT_MARKER } = r('scripts/auto_routes_seed');
const { routeInput, pickupInput } = r('modules/autoRide/controllers/admin');
const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));

// The owner's fares: destination -> [default, min, max].
const OWNER_FARES = {
  Mangalagiri: [30, 25, 40],
  'Vijayawada (Benz Circle)': [100, 90, 120],
  Guntur: [100, 90, 120],
  Tadepalli: [40, 30, 50],
  Undavalli: [80, 70, 95],
};

let ctx = null;
const files = [];
const freshDb = async () => {
  if (ctx) await ctx.sequelize.close();
  const file = path.join(os.tmpdir(), `auto-routes-seed-${process.pid}-${crypto.randomBytes(4).toString('hex')}.sqlite`);
  files.push(file);
  const sequelize = new Sequelize({ dialect: 'sqlite', storage: file, logging: false });
  r('models/GlobalConfig').initGlobalConfigModel(sequelize);
  autoRide.initAutoRideModels(sequelize);
  await sequelize.sync();
  ctx = { sequelize, M: sequelize.models };
  return ctx.M;
};
const quiet = async (fn) => {
  const o = console.log;
  console.log = () => {};
  try { return await fn(); } finally { console.log = o; }
};

test.after(async () => {
  if (ctx) await ctx.sequelize.close();
  ctx = null;
  for (const f of files) for (const x of [f, `${f}-journal`, `${f}-wal`, `${f}-shm`]) { try { fs.unlinkSync(x); } catch { /* gone */ } }
});

test('data file: 5 owner routes, default fare inside min-max, passes the admin validation', () => {
  assert.strictEqual(data.marker, DEFAULT_MARKER);
  assert.strictEqual(DEFAULT_MARKER, 'AUTO_ROUTES_V1_DONE');
  assert.strictEqual(data.routes.length, 5);
  assert.deepStrictEqual(data.routes.map((x) => x.destinationLabel).sort(), Object.keys(OWNER_FARES).sort());
  for (const route of data.routes) {
    const [def, min, max] = OWNER_FARES[route.destinationLabel];
    assert.deepStrictEqual([route.seatFareDefault, route.seatFareMin, route.seatFareMax], [def, min, max], route.destinationLabel);
    assert.ok(route.seatFareDefault >= route.seatFareMin && route.seatFareDefault <= route.seatFareMax);
    assert.ok(route.fullFareMin <= route.seatFareDefault * 8 && route.seatFareDefault * 8 <= route.fullFareMax, 'full auto ~8x seat');
    assert.strictEqual(route.originLabel, 'SRM AP Main Gate');
    assert.strictEqual(route.isActive, true);
    assert.strictEqual(route.pickupPoints.length, 1);
    const v = routeInput(route); // throws on anything the admin UI would refuse
    assert.strictEqual(v.seatFareDefault, def);
    assert.ok(v.operatingPeriods.length >= 1 && v.minSeatsToDepartDefault >= 1);
    const p = pickupInput(route.pickupPoints[0]);
    assert.strictEqual(p.name, 'SRM AP Main Gate');
    assert.strictEqual(p.landmark, 'Main gate, Neerukonda');
    assert.ok(Math.abs(p.lat - 16.4636) < 0.01 && Math.abs(p.lon - 80.5069) < 0.01);
  }
});

test('first run creates every route + pickup with the exact fares and writes the marker; re-run is a no-op', async () => {
  const M = await freshDb();
  const res = await quiet(() => runAutoRoutesSeed());
  assert.strictEqual(res.created, 5);
  assert.strictEqual(res.skipped, 0);
  assert.strictEqual(res.pickupsCreated, 5);
  const routes = await M.AutoRoute.findAll();
  assert.strictEqual(routes.length, 5);
  for (const row of routes) {
    const [def, min, max] = OWNER_FARES[row.destinationLabel];
    assert.strictEqual(row.seatFareDefault, def);
    assert.strictEqual(row.seatFareMin, min);
    assert.strictEqual(row.seatFareMax, max);
    assert.ok(row.seatFareDefault >= row.seatFareMin && row.seatFareDefault <= row.seatFareMax);
    assert.strictEqual(row.isActive, true);
    const pickups = await M.AutoPickupPoint.findAll({ where: { routeId: row.id } });
    assert.strictEqual(pickups.length, 1);
    assert.strictEqual(pickups[0].name, 'SRM AP Main Gate');
    assert.strictEqual(pickups[0].landmark, 'Main gate, Neerukonda');
    assert.strictEqual(pickups[0].isActive, true);
  }
  // The union queue reads the default fare.
  const { routeSeatFare } = r('modules/autoRide/services/chargeLine');
  const und = routes.find((x) => x.destinationLabel === 'Undavalli');
  assert.deepStrictEqual(routeSeatFare(und), { fare: 80, source: 'DEFAULT' });
  const mark = await M.GlobalConfig.findOne({ where: { key: DEFAULT_MARKER } });
  assert.ok(mark && mark.value && mark.value.created === 5);

  assert.deepStrictEqual(await quiet(() => runAutoRoutesSeed()), { skipped: 'already done' });
  assert.strictEqual(await M.AutoRoute.count(), 5);
  assert.strictEqual(await M.AutoPickupPoint.count(), 5);

  // Marker deleted: still no duplicates (every destination exists now).
  await mark.destroy();
  const again = await quiet(() => runAutoRoutesSeed());
  assert.strictEqual(again.created, 0);
  assert.strictEqual(again.skipped, 5);
  assert.strictEqual(await M.AutoRoute.count(), 5);
  assert.strictEqual(await M.AutoPickupPoint.count(), 5);
});

test('an existing route (same destination + pickup) is skipped and never edited', async () => {
  const M = await freshDb();
  const mine = await M.AutoRoute.create({
    name: 'Admin Mangalagiri', originLabel: 'SRM AP Main Gate', destinationLabel: 'mangalagiri',
    seatFareMin: 20, seatFareMax: 35, seatFareDefault: 28, isActive: false, sortOrder: 1,
  });
  await M.AutoPickupPoint.create({ routeId: mine.id, name: 'SRM AP Main Gate', landmark: 'Admin landmark', lat: 16.1, lon: 80.1 });
  const res = await quiet(() => runAutoRoutesSeed());
  assert.strictEqual(res.created, 4);
  assert.strictEqual(res.skipped, 1);
  assert.deepStrictEqual(res.skippedNames, ['Mangalagiri']);
  assert.strictEqual(await M.AutoRoute.count(), 5);
  assert.strictEqual(await M.AutoRoute.count({ where: { destinationLabel: 'Mangalagiri' } }), 0, 'no duplicate Mangalagiri');
  await mine.reload();
  assert.deepStrictEqual([mine.name, mine.seatFareMin, mine.seatFareMax, mine.seatFareDefault, mine.isActive], ['Admin Mangalagiri', 20, 35, 28, false]);
  const p = await M.AutoPickupPoint.findOne({ where: { routeId: mine.id } });
  assert.deepStrictEqual([p.landmark, p.lat, p.lon], ['Admin landmark', 16.1, 80.1]);
  assert.strictEqual(await M.AutoPickupPoint.count({ where: { routeId: mine.id } }), 1);
});

test('invalid data creates nothing and writes no marker; DISABLE_AUTO_ROUTES_SEED switches it off', async () => {
  const M = await freshDb();
  const bad = path.join(os.tmpdir(), `auto-routes-bad-${process.pid}-${crypto.randomBytes(4).toString('hex')}.json`);
  files.push(bad);
  const broken = JSON.parse(JSON.stringify(data));
  broken.routes[4].seatFareDefault = 200; // above its max (95)
  fs.writeFileSync(bad, JSON.stringify(broken));
  await assert.rejects(() => quiet(() => runAutoRoutesSeed({ dataPath: bad })), (e) => e.code === 'INVALID_INPUT' || /default seat fare/i.test(e.message));
  assert.strictEqual(await M.AutoRoute.count(), 0);
  assert.strictEqual(await M.GlobalConfig.count({ where: { key: DEFAULT_MARKER } }), 0);

  process.env.DISABLE_AUTO_ROUTES_SEED = 'true';
  try {
    assert.deepStrictEqual(await runAutoRoutesSeed(), { skipped: 'disabled' });
  } finally { delete process.env.DISABLE_AUTO_ROUTES_SEED; }
  assert.strictEqual(await M.AutoRoute.count(), 0);
});
