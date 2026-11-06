// Boot backfill of human order IDs (utils/orderNumbers.runOrderNumberMigrations) on its own temp SQLite: a database
// that predates numbering gets ZEN-1.. oldest first across Orders, MegaBaskets and CampusBookings; running it again
// changes nothing; later unnumbered rows (an old instance during a rolling deploy) continue the count; new rows
// continue after the backfilled ones; a fresh empty database is fine.
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const B = path.join(__dirname, '..', '..');
const r = (rel) => require(path.join(B, rel));
const { Sequelize } = require(path.join(B, 'node_modules/sequelize'));
const ON = r('utils/orderNumbers');

const files = [];
const fresh = async () => {
  const file = path.join(os.tmpdir(), `ordernum-${process.pid}-${crypto.randomBytes(4).toString('hex')}.sqlite`);
  files.push(file);
  const sequelize = new Sequelize({ dialect: 'sqlite', storage: file, logging: false });
  r('models/Order').initOrderModel(sequelize);
  r('models/MegaBasket').initMegaBasketModel(sequelize);
  r('models/ReceiptCounter').initReceiptCounterModel(sequelize);
  r('modules/campusBooking').initCampusBookingModels(sequelize);
  await sequelize.sync();
  return sequelize;
};
test.after(async () => {
  for (const f of files) for (const x of [f, `${f}-journal`, `${f}-wal`, `${f}-shm`]) { try { fs.unlinkSync(x); } catch { /* gone */ } }
});

const uuid = () => crypto.randomUUID();
const at = (min) => new Date(Date.UTC(2026, 9, 1, 0, min)); // 1 Oct 2026 + min minutes
const mkOrder = (s, createdAt) => s.models.Order.create({ userId: uuid(), restaurantId: uuid(), items: [], totalPrice: 100, deliveryFee: 19, finalPrice: 123, paymentMethod: 'COD', createdAt, updatedAt: createdAt }, { silent: true });
const mkBasket = (s, createdAt) => s.models.MegaBasket.create({ userId: uuid(), estimatedTotal: 50, deliveryAddress: 'Block C', createdAt, updatedAt: createdAt }, { silent: true });
const mkBooking = (s, createdAt) => s.models.CampusBooking.create({ userId: uuid(), restaurantId: uuid(), ref: `CB${crypto.randomBytes(2).toString('hex')}`, pickupCode: 'XY12', items: [], createdAt, updatedAt: createdAt }, { silent: true });
// Rows as they were before numbering existed: no number, no counter.
const unnumberAll = async (s) => {
  for (const t of ['Orders', 'MegaBaskets', 'CampusBookings']) await s.query(`UPDATE "${t}" SET "orderNumber" = NULL`);
  await s.query('DELETE FROM "ReceiptCounters" WHERE "series" = :s', { replacements: { s: ON.COUNTER_SERIES } });
};
const numberOf = async (s, model, id) => (await s.models[model].findByPk(id, { attributes: ['id', 'orderNumber'], raw: true })).orderNumber;

test('fresh empty database: migration succeeds, numbers nothing, first order is ZEN-1', async () => {
  const s = await fresh();
  const m = await ON.runOrderNumberMigrations(s);
  assert.ok(m.ok, JSON.stringify(m));
  assert.strictEqual(m.numbered, 0);
  const o = await mkOrder(s, at(0));
  assert.strictEqual(o.orderNumber, 1);
  assert.strictEqual(o.toJSON().orderCode, 'ZEN-1');
  await s.close();
});

test('existing rows: oldest first across all tables is ZEN-1; re-running is a no-op; new rows continue', async () => {
  const s = await fresh();
  // Created out of order on purpose (the insert order must not matter, createdAt does).
  const o3 = await mkOrder(s, at(30));
  const b2 = await mkBasket(s, at(20));
  const o1 = await mkOrder(s, at(5));
  const c4 = await mkBooking(s, at(40));
  const o5 = await mkOrder(s, at(50));
  const o0 = await mkOrder(s, at(1));
  await unnumberAll(s);
  assert.strictEqual(await numberOf(s, 'Order', o3.id), null);

  const updatedBefore = (await s.models.Order.findByPk(o3.id, { raw: true })).updatedAt;
  const m = await ON.runOrderNumberMigrations(s);
  assert.ok(m.ok, JSON.stringify(m));
  assert.strictEqual(m.numbered, 6);
  assert.strictEqual(await numberOf(s, 'Order', o0.id), 1);
  assert.strictEqual(await numberOf(s, 'Order', o1.id), 2);
  assert.strictEqual(await numberOf(s, 'MegaBasket', b2.id), 3);
  assert.strictEqual(await numberOf(s, 'Order', o3.id), 4);
  assert.strictEqual(await numberOf(s, 'CampusBooking', c4.id), 5);
  assert.strictEqual(await numberOf(s, 'Order', o5.id), 6);
  assert.deepStrictEqual((await s.models.Order.findByPk(o3.id, { raw: true })).updatedAt, updatedBefore, 'backfill never touches updatedAt');

  // Every boot runs it again: nothing to do, nothing changes.
  const again = await ON.runOrderNumberMigrations(s);
  assert.ok(again.ok);
  assert.strictEqual(again.numbered, 0);
  assert.strictEqual(await numberOf(s, 'Order', o5.id), 6);

  // New orders continue the count.
  const n7 = await mkOrder(s, new Date());
  assert.strictEqual(n7.orderNumber, 7);

  // A row an old instance created without a number (rolling deploy) gets the next number on the re-check,
  // never one already used.
  const late = await mkOrder(s, at(10));
  await s.query('UPDATE "Orders" SET "orderNumber" = NULL WHERE "id" = :id', { replacements: { id: late.id } });
  assert.strictEqual(await ON.backfill(s), 1);
  assert.strictEqual(await numberOf(s, 'Order', late.id), 9, '8 was drawn by the create above, then nulled');
  const n10 = await mkOrder(s, new Date());
  assert.strictEqual(n10.orderNumber, 10);

  const all = [];
  for (const t of ['Orders', 'MegaBaskets', 'CampusBookings']) all.push(...(await s.query(`SELECT "orderNumber" AS n FROM "${t}"`, { type: 'SELECT' })).map((x) => x.n));
  assert.strictEqual(new Set(all).size, all.length, 'unique across all three tables');
  assert.ok(all.every((n) => Number.isInteger(n) && n > 0));
  await s.close();
});

test('the unique index refuses a duplicate number even from raw SQL', async () => {
  const s = await fresh();
  await ON.runOrderNumberMigrations(s);
  const a = await mkOrder(s, at(0));
  const b = await mkOrder(s, at(1));
  await assert.rejects(s.query('UPDATE "Orders" SET "orderNumber" = :n WHERE "id" = :id', { replacements: { n: a.orderNumber, id: b.id } }));
  await s.close();
});
