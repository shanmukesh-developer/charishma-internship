// scripts/verify_db_copy.js against two local SQLite copies (read-only on both).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const sqlite3 = require('sqlite3');

const { verify, assertReadOnly, norm } = require('../../scripts/verify_db_copy');
const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'verify_db_copy.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zenvy-verify-'));

const exec = (file, sql) => new Promise((resolve, reject) => {
  const db = new sqlite3.Database(file);
  db.exec(sql, (err) => db.close(() => (err ? reject(err) : resolve())));
});
const hash = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const quiet = () => {};

const SCHEMA = `
CREATE TABLE "Users" ("id" UUID PRIMARY KEY, "name" TEXT, "updatedAt" DATETIME NOT NULL);
CREATE INDEX "users_name" ON "Users" ("name");
CREATE TABLE "Orders" ("id" UUID PRIMARY KEY, "userId" UUID, "total" REAL, "updatedAt" DATETIME NOT NULL);
CREATE UNIQUE INDEX "orders_user" ON "Orders" ("userId", "id");
CREATE TABLE "Counters" ("n" INTEGER PRIMARY KEY AUTOINCREMENT, "label" TEXT);
CREATE TABLE "FriendLinks" ("a" UUID NOT NULL, "b" UUID NOT NULL, "updatedAt" DATETIME, PRIMARY KEY ("a", "b"));
CREATE TABLE "Logs" ("msg" TEXT);
`;
const seed = () => {
  let sql = SCHEMA;
  for (let i = 0; i < 40; i++) sql += `INSERT INTO "Users" VALUES ('00000000-0000-4000-8000-${String(i).padStart(12, '0')}', 'user ${i}', '2026-10-1${i % 9} 10:00:00.000 +00:00');\n`;
  for (let i = 0; i < 25; i++) sql += `INSERT INTO "Orders" VALUES ('10000000-0000-4000-8000-${String(i).padStart(12, '0')}', '00000000-0000-4000-8000-${String(i).padStart(12, '0')}', ${i * 10.5}, '2026-10-18 0${i % 10}:00:00.000 +00:00');\n`;
  for (let i = 0; i < 7; i++) sql += `INSERT INTO "Counters" ("label") VALUES ('c${i}');\n`;
  sql += `INSERT INTO "FriendLinks" VALUES ('a1','b1','2026-10-18 01:00:00.000 +00:00'), ('a1','b2',NULL);\nINSERT INTO "Logs" VALUES ('x'),('y');\n`;
  return sql;
};

test('read-only guard refuses every kind of write', () => {
  for (const ok of ['SELECT 1', ' select * from "Users"', 'WITH x AS (SELECT 1) SELECT * FROM x', 'PRAGMA table_info("Users")', 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY', 'ROLLBACK', 'SELECT "update" FROM "delete"']) {
    assert.doesNotThrow(() => assertReadOnly(ok), ok);
  }
  for (const bad of ['DELETE FROM "Users"', 'UPDATE "Users" SET name = 1', 'INSERT INTO x VALUES (1)', 'DROP TABLE x', 'SELECT 1; DELETE FROM x', 'WITH d AS (DELETE FROM x RETURNING *) SELECT * FROM d', 'PRAGMA writable_schema = 1', 'SET default_transaction_read_only = off', 'TRUNCATE x', 'ALTER TABLE x ADD y INT', 'CREATE TABLE z (a INT)', 'COPY x TO STDOUT', 'COMMIT', 'VACUUM']) {
    assert.throws(() => assertReadOnly(bad), /refuses/, bad);
  }
});

test('norm: same instant from SQLite text and a Date gives the same value', () => {
  assert.equal(norm('2026-10-18 10:15:00.000 +00:00'), norm(new Date('2026-10-18T10:15:00Z')));
  assert.equal(norm(null), '∅');
});

test('identical copies PASS; neither file is modified', async () => {
  const a = path.join(tmp, 'a.sqlite');
  await exec(a, seed());
  const b = path.join(tmp, 'b.sqlite');
  fs.copyFileSync(a, b);
  const [ha, hb] = [hash(a), hash(b)];
  const r = await verify({ source: `sqlite:${a}`, target: `sqlite:${b}`, out: quiet });
  assert.equal(r.ok, true, JSON.stringify(r, null, 1));
  assert.equal(r.tables.length, 5);
  assert.ok(r.tables.find((t) => t.table === 'Logs').checksum.startsWith('n/a'));
  assert.equal(r.indexesChecked >= 2, true);
  assert.equal(r.sequencesChecked, 1);
  assert.equal(hash(a), ha); assert.equal(hash(b), hb);
});

test('differences are caught: missing row, changed updatedAt, missing index, lower sequence, missing table / column', async () => {
  const a = path.join(tmp, 'a2.sqlite');
  await exec(a, seed());
  const b = path.join(tmp, 'b2.sqlite');
  fs.copyFileSync(a, b);
  await exec(b, `
    DELETE FROM "Users" WHERE "name" = 'user 3';
    UPDATE "Orders" SET "updatedAt" = '2026-10-19 00:00:00.000 +00:00' WHERE "total" = 21;
    DROP INDEX "users_name";
    UPDATE sqlite_sequence SET seq = 2 WHERE name = 'Counters';
    DROP TABLE "Logs";
  `);
  const r = await verify({ source: `sqlite:${a}`, target: `sqlite:${b}`, out: quiet });
  assert.equal(r.ok, false);
  const t = Object.fromEntries(r.tables.map((x) => [x.table, x]));
  assert.equal(t.Users.result, 'FAIL'); assert.match(t.Users.note, /row count/);
  assert.equal(t.Orders.result, 'FAIL'); assert.equal(t.Orders.srcRows, t.Orders.dstRows); assert.match(t.Orders.note, /checksum/);
  assert.equal(t.Logs.result, 'FAIL'); assert.match(t.Logs.note, /missing on target/);
  assert.equal(t.FriendLinks.result, 'PASS');
  assert.ok(r.missingIndexes.includes('Users.users_name'));
  assert.ok(r.sequenceProblems.some((p) => /Counters/.test(p)));

  const c = path.join(tmp, 'c2.sqlite');
  await exec(c, seed().replace('"name" TEXT, "updatedAt"', '"updatedAt"').replace(/INSERT INTO "Users" VALUES \('([^']+)', '[^']*', /g, `INSERT INTO "Users" VALUES ('$1', `));
  const r2 = await verify({ source: `sqlite:${a}`, target: `sqlite:${c}`, tables: ['Users'], out: quiet });
  assert.equal(r2.ok, false); assert.match(r2.tables[0].note, /columns missing on target: name/);
});

test('CLI: exit 0 / 1 / 2 and a printed table', async () => {
  const a = path.join(tmp, 'a3.sqlite');
  await exec(a, seed());
  const b = path.join(tmp, 'b3.sqlite');
  fs.copyFileSync(a, b);
  let r = spawnSync(process.execPath, [SCRIPT, `--source=sqlite:${a}`, `--target=sqlite:${b}`], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /RESULT: PASS/); assert.match(r.stdout, /Orders\s+25\s+25/);
  await exec(b, 'DELETE FROM "Orders";');
  r = spawnSync(process.execPath, [SCRIPT, `--source=sqlite:${a}`, `--target=sqlite:${b}`], { encoding: 'utf8' });
  assert.equal(r.status, 1); assert.match(r.stdout, /RESULT: FAIL/);
  r = spawnSync(process.execPath, [SCRIPT, `--source=sqlite:${a}`, `--target=sqlite:${a}`], { encoding: 'utf8' });
  assert.equal(r.status, 2); assert.match(r.stderr, /same database/);
});
