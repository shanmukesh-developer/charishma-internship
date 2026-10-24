// Catalogue clean-up v2 (scripts/catalogue_cleanup_import.js + data/catalogue_cleanup_v2_2026-10-24.json)
// on temp SQLite DBs seeded from the data file's own "expect" + "current" snapshot: the first run rewrites
// the repair descriptions and renames Today's deals so each name says what the claim really gives, in
// one transaction per store / for the deals, and writes GlobalConfig CATALOGUE_CLEANUP_V2_DONE; a re-run
// is a no-op; a row an admin edited is skipped untouched; v2 runs on its own whether or not v1 already
// ran (and never touches v1's marker); runCatalogueCleanups runs v1, v2 then v3; DISABLE_CATALOGUE_CLEANUP
// switches it off. Never touches a real database or the network.
process.env.NODE_ENV = 'test';
delete process.env.DATABASE_URL;
delete process.env.DISABLE_CATALOGUE_CLEANUP;

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

let ctx = null;
stub('config/db.js', { getSequelize: () => (ctx ? ctx.sequelize : null), connectDB: async () => {} });
let cacheClears = 0;
stub('controllers/adminController.js', { clearRestaurantsCache: () => { cacheClears++; } });
const invalidated = [];
stub('utils/responseCache.js', { invalidate: (...g) => { invalidated.push(...g); } });

const { Sequelize } = require(path.join(B, 'node_modules/sequelize'));
const { runCatalogueCleanup, runCatalogueCleanups, buildUpdate, buildVaultUpdate, DATA_PATH, DEFAULT_MARKER, V2_DATA_PATH, V2_MARKER } = r('scripts/catalogue_cleanup_import');
const data = JSON.parse(fs.readFileSync(V2_DATA_PATH, 'utf8'));
const items = data.stores.flatMap((s) => s.items.map((i) => ({ ...i, storeId: s.storeId, storeName: s.storeName })));
const deals = data.vault;
const files = [];

// A fresh temp DB with the repair stores / items and the deals exactly as in the v2 snapshot.
const freshDb = async () => {
  if (ctx) await ctx.sequelize.close();
  const file = path.join(os.tmpdir(), `catalogue-cleanup-v2-${process.pid}-${crypto.randomBytes(4).toString('hex')}.sqlite`);
  files.push(file);
  const sequelize = new Sequelize({ dialect: 'sqlite', storage: file, logging: false });
  r('models/Restaurant').initRestaurantModel(sequelize);
  r('models/MenuItem').initMenuItemModel(sequelize);
  r('models/GlobalConfig').initGlobalConfigModel(sequelize);
  r('models/VaultItem').initVaultItemModel(sequelize);
  await sequelize.sync();
  const M = sequelize.models;
  for (const s of data.stores) {
    await M.Restaurant.create({ id: s.storeId, name: s.storeName, location: 'SRM AP', vendorType: 'SERVICE', isActive: true });
  }
  for (const i of items) {
    await M.MenuItem.create({
      id: i.id, restaurantId: i.storeId, name: i.expect.name, price: i.expect.price,
      category: i.current.category, description: i.current.description, isAvailable: true, specs: { keep: 'me' },
    });
  }
  for (const d of deals) {
    await M.VaultItem.create({ id: d.id, name: d.expect.name, price: d.expect.price, originalPrice: d.expect.originalPrice, remainingCount: 40, isActive: true, streakRequirement: 3 });
  }
  ctx = { sequelize, M };
  return M;
};

test.after(async () => {
  if (ctx) await ctx.sequelize.close();
  ctx = null;
  for (const f of files) for (const x of [f, `${f}-journal`]) { try { fs.unlinkSync(x); } catch { /* gone */ } }
});

const opTo = (row, op) => (row.ops.find((o) => o.op === op) || {}).to;

test('v2 data file: own marker, known ops with reasons, honest copy, deal names match the coupon the claim makes', () => {
  assert.strictEqual(data.version, 2);
  assert.strictEqual(data.marker, V2_MARKER);
  assert.notStrictEqual(V2_MARKER, DEFAULT_MARKER);
  assert.notStrictEqual(V2_DATA_PATH, DATA_PATH);
  const ids = new Set();
  for (const i of items) {
    assert.match(i.id, /^[0-9a-f-]{36}$/);
    assert.ok(!ids.has(i.id), `${i.id} listed once`);
    ids.add(i.id);
    assert.ok(i.expect.name && Number.isFinite(i.expect.price));
    for (const o of i.ops) {
      assert.ok(['setDescription', 'rename'].includes(o.op), o.op);
      assert.ok(o.reason, `${i.expect.name} ${o.op} has a reason`);
    }
    const desc = opTo(i, 'setDescription') || i.current.description;
    assert.ok(!/\d+\s*x\s+faster|genuine windows|boost speed/i.test(desc), `${i.expect.name}: no ad copy`);
  }
  for (const d of deals) {
    assert.match(d.id, /^[0-9a-f-]{36}$/);
    assert.ok(!ids.has(d.id));
    ids.add(d.id);
    assert.ok(d.ops.length === 1 && d.ops[0].op === 'rename' && d.ops[0].reason);
    const name = d.ops[0].to;
    // routes/vaultRoutes.js: a "free delivery" name makes a FREEDEL coupon, else a coupon worth originalPrice - price.
    const value = Math.max(0, d.expect.originalPrice - d.expect.price);
    if (/free\s*delivery/i.test(d.expect.name)) {
      assert.match(name, /free\s*delivery/i, 'still a free-delivery deal');
      assert.ok(!/\bpass\b|\(\s*\d+\s*orders?\s*\)/i.test(name), `${name}: one coupon, not a pass`);
    } else {
      const promised = (name.match(/₹\s?(\d+)\s*off/i) || [])[1];
      assert.strictEqual(Number(promised), value, `${name} promises the real ₹${value}`);
    }
    assert.ok(name === name.trim() && !/\b[A-Z]{4,}\b/.test(name), `${name}: sentence case`);
  }
});

test('first run applies every v2 op once, writes the v2 marker (v1 marker untouched); a re-run is a no-op', async () => {
  const M = await freshDb();
  cacheClears = 0;
  invalidated.length = 0;
  const first = await runCatalogueCleanup({ dataPath: V2_DATA_PATH });
  assert.strictEqual(first.storesFailed, 0);
  assert.strictEqual(first.skipped, 0);
  assert.strictEqual(first.applied, items.length + deals.length);
  assert.strictEqual(first.ops, [...items, ...deals].reduce((n, x) => n + x.ops.length, 0));
  assert.ok(cacheClears >= 1, 'store cache cleared');
  assert.ok(invalidated.includes('vault'), 'deals cache cleared');

  for (const i of items) {
    const row = await M.MenuItem.findByPk(i.id);
    assert.strictEqual(row.description, opTo(i, 'setDescription'));
    assert.strictEqual(row.name, i.expect.name, 'names kept (service forms match on them)');
    assert.strictEqual(row.price, i.expect.price);
    assert.strictEqual(row.isAvailable, true);
    assert.strictEqual(row.specs.keep, 'me');
  }
  for (const d of deals) {
    const row = await M.VaultItem.findByPk(d.id);
    assert.strictEqual(row.name, opTo(d, 'rename'));
    assert.strictEqual(row.price, d.expect.price, 'coupon value unchanged');
    assert.strictEqual(row.originalPrice, d.expect.originalPrice);
    assert.strictEqual(row.remainingCount, 40);
    assert.strictEqual(row.isActive, true);
  }
  const mark = await M.GlobalConfig.findOne({ where: { key: V2_MARKER } });
  assert.ok(mark && mark.value.applied === items.length + deals.length);
  assert.strictEqual(await M.GlobalConfig.findOne({ where: { key: DEFAULT_MARKER } }), null, 'v1 marker not written by v2');

  assert.deepStrictEqual(await runCatalogueCleanup({ dataPath: V2_DATA_PATH }), { skipped: 'already done' });
  // Without the marker every deal guard now skips (names changed); descriptions are rewritten to the same text.
  await mark.destroy();
  const again = await runCatalogueCleanup({ dataPath: V2_DATA_PATH });
  assert.strictEqual(again.storesFailed, 0);
  assert.strictEqual(again.skipped, deals.length);
  for (const d of deals) assert.strictEqual((await M.VaultItem.findByPk(d.id)).name, opTo(d, 'rename'));
});

test('guards: a deal or repair the admin edited is skipped and left exactly as the admin set it', async () => {
  const M = await freshDb();
  const [d1, d2] = deals;
  await M.VaultItem.update({ name: 'Admin deal name' }, { where: { id: d1.id } });
  await M.VaultItem.update({ price: d2.expect.price + 5 }, { where: { id: d2.id } });
  const [i1] = items;
  await M.MenuItem.update({ description: 'Admin text', price: i1.expect.price + 100 }, { where: { id: i1.id } });

  const res = await runCatalogueCleanup({ dataPath: V2_DATA_PATH });
  assert.strictEqual(res.skipped, 3);
  assert.strictEqual(res.applied, items.length + deals.length - 3);
  assert.deepStrictEqual(new Set(res.skippedIds), new Set([d1.id, d2.id, i1.id]));
  assert.strictEqual((await M.VaultItem.findByPk(d1.id)).name, 'Admin deal name');
  const r2 = await M.VaultItem.findByPk(d2.id);
  assert.strictEqual(r2.name, d2.expect.name);
  assert.strictEqual(r2.price, d2.expect.price + 5);
  assert.strictEqual((await M.MenuItem.findByPk(i1.id)).description, 'Admin text');
});

test('v2 runs whether or not v1 already ran; runCatalogueCleanups runs both versions in order; the switch turns it off', async () => {
  const M = await freshDb();
  await M.GlobalConfig.create({ key: DEFAULT_MARKER, value: { doneAt: 'earlier' }, description: 'v1 done' });
  process.env.DISABLE_CATALOGUE_CLEANUP = 'true';
  try {
    assert.deepStrictEqual(await runCatalogueCleanups(), { v1: { skipped: 'disabled' }, v2: { skipped: 'disabled' }, v3: { skipped: 'disabled' } });
    assert.strictEqual((await M.VaultItem.findByPk(deals[0].id)).name, deals[0].expect.name);
  } finally { delete process.env.DISABLE_CATALOGUE_CLEANUP; }
  const all = await runCatalogueCleanups();
  assert.deepStrictEqual(all.v1, { skipped: 'already done' });
  assert.strictEqual(all.v2.applied, items.length + deals.length);
  assert.ok(await M.GlobalConfig.findOne({ where: { key: V2_MARKER } }));
  assert.deepStrictEqual(await runCatalogueCleanups(), { v1: { skipped: 'already done' }, v2: { skipped: 'already done' }, v3: { skipped: 'already done' } });
});

test('malformed ops are refused: an empty or very long description, a vault op other than rename', () => {
  const row = { price: 100, specs: {} };
  assert.strictEqual(buildUpdate(row, [{ op: 'setDescription', to: '  ' }]), null);
  assert.strictEqual(buildUpdate(row, [{ op: 'setDescription', to: 'x'.repeat(501) }]), null);
  assert.deepStrictEqual(buildUpdate(row, [{ op: 'setDescription', to: ' Fine text. ' }]), { description: 'Fine text.' });
  assert.strictEqual(buildVaultUpdate([{ op: 'setPrice', to: 10 }]), null);
  assert.strictEqual(buildVaultUpdate([{ op: 'rename', to: '' }]), null);
  assert.deepStrictEqual(buildVaultUpdate([{ op: 'rename', to: '₹30 off one order' }]), { name: '₹30 off one order' });
});
