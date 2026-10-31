// config/db.js addMissingColumns: the boot-time catch-up that adds new model columns to existing tables
// (e.g. Restaurants.visibleCampuses, 31 Oct 2026). A column that fails once (the database connection dropped
// mid-boot) is retried; one that still fails is reported, so the boot does not save the schema fingerprint and
// the next boot checks again instead of skipping the check with the column missing.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Sequelize, DataTypes } = require('sequelize');
const { addMissingColumns } = require('../../config/db');

async function freshDb() {
  const db = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false });
  db.define('Shop', {
    name: { type: DataTypes.STRING },
    visibleCampuses: { type: DataTypes.JSON, allowNull: true },
    rating: { type: DataTypes.FLOAT, defaultValue: 4.5 },
  });
  // The table as an older deploy created it: without the two new columns.
  await db.query('CREATE TABLE "Shops" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "name" VARCHAR(255), "createdAt" DATETIME NOT NULL, "updatedAt" DATETIME NOT NULL)');
  return db;
}
const columns = async (db) => Object.keys(await db.getQueryInterface().describeTable('Shops')).sort();
const quiet = async (fn) => {
  const { log, warn } = console;
  console.log = () => {}; console.warn = () => {};
  try { return await fn(); } finally { console.log = log; console.warn = warn; }
};

test('adds every missing column and reports none failed', async () => {
  const db = await freshDb();
  const r = await quiet(() => addMissingColumns(db, { retryDelayMs: 5 }));
  assert.deepEqual(r, { added: 2, failed: 0 });
  assert.deepEqual(await columns(db), ['createdAt', 'id', 'name', 'rating', 'updatedAt', 'visibleCampuses']);
  const again = await quiet(() => addMissingColumns(db, { retryDelayMs: 5 }));
  assert.deepEqual(again, { added: 0, failed: 0 }, 'second boot: nothing to add');
  await db.close();
});

test('a column that fails once (connection dropped) is retried and added', async () => {
  const db = await freshDb();
  const qi = db.getQueryInterface();
  const real = qi.addColumn.bind(qi);
  let failedOnce = false;
  qi.addColumn = async (table, field, spec) => {
    if (field === 'visibleCampuses' && !failedOnce) { failedOnce = true; throw new Error('Connection terminated unexpectedly'); }
    return real(table, field, spec);
  };
  const r = await quiet(() => addMissingColumns(db, { retryDelayMs: 5 }));
  assert.deepEqual(r, { added: 2, failed: 0 });
  assert.ok((await columns(db)).includes('visibleCampuses'));
  await db.close();
});

test('the first try went through but its answer was lost: the retry sees the column and counts it', async () => {
  const db = await freshDb();
  const qi = db.getQueryInterface();
  const real = qi.addColumn.bind(qi);
  let lostOnce = false;
  qi.addColumn = async (table, field, spec) => {
    const out = await real(table, field, spec);
    if (field === 'visibleCampuses' && !lostOnce) { lostOnce = true; throw new Error('read ECONNRESET'); }
    return out;
  };
  const r = await quiet(() => addMissingColumns(db, { retryDelayMs: 5 }));
  assert.deepEqual(r, { added: 2, failed: 0 });
  await db.close();
});

test('a column that keeps failing is reported (the boot then keeps the fingerprint unsaved)', async () => {
  const db = await freshDb();
  const qi = db.getQueryInterface();
  const real = qi.addColumn.bind(qi);
  let tries = 0;
  qi.addColumn = async (table, field, spec) => {
    if (field === 'visibleCampuses') { tries++; throw new Error('permission denied for table Shops'); }
    return real(table, field, spec);
  };
  const r = await quiet(() => addMissingColumns(db, { retryDelayMs: 5 }));
  assert.deepEqual(r, { added: 1, failed: 1 });
  assert.equal(tries, 2, 'tried once, retried once');
  assert.ok(!(await columns(db)).includes('visibleCampuses'));
  await db.close();
});

test('the production boot saves the schema fingerprint only when no column failed', () => {
  const src = require('fs').readFileSync(require.resolve('../../config/db'), 'utf8');
  assert.match(src, /const columns = await addMissingColumns\(sequelize\);\s*\/\/[^\n]*\n\s*if \(syncOk && columns\.failed === 0\) await saveSchemaFingerprint\(sequelize, fingerprint\);/);
});
