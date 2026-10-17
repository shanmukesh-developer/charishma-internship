// utils/mediaStorage (db + s3), utils/s3Lite (AWS SigV4 vectors), mediaController wiring, CampusMedia hooks,
// scripts/migrate_media_to_r2.js. The s3 driver runs against a MOCKED client always, and against a real
// local S3-compatible server (s3rver) when S3RVER_MODULE is set (tests/infra/run.js explains).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const express = require('express');
const { Sequelize } = require('sequelize');

const BACKEND = path.join(__dirname, '..', '..');
const storage = require('../../utils/mediaStorage');
const { S3Lite, sha256Hex } = require('../../utils/s3Lite');
const { initCampusMediaModel } = require('../../modules/campus/models/CampusMedia');

// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const png = (n) => Buffer.concat([PNG, Buffer.from(`-${n}-${'x'.repeat(50)}`)]);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const OWNER = '11111111-1111-4111-8111-111111111111';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zenvy-media-'));

// ── Fake S3 client (same surface as S3Lite) ─────────────────────────────────────────────────────
const fakeS3 = () => {
  const objects = new Map(); // `${bucket}/${key}` -> { body, contentType, metadata }
  const calls = [];
  const { Readable } = require('stream');
  return {
    objects,
    calls,
    failPut: false,
    async putObject(bucket, key, body, { contentType, metadata = {} } = {}) {
      calls.push(['put', bucket, key]);
      if (this.failPut) throw new Error('simulated R2 outage');
      objects.set(`${bucket}/${key}`, { body: Buffer.from(body), contentType, metadata });
      return { etag: 'e' };
    },
    async getObject(bucket, key) {
      calls.push(['get', bucket, key]);
      const o = objects.get(`${bucket}/${key}`);
      return o ? { stream: Readable.from([o.body]), contentType: o.contentType, contentLength: o.body.length, metadata: o.metadata } : null;
    },
    async getObjectBuffer(bucket, key) { const o = objects.get(`${bucket}/${key}`); return o ? Buffer.from(o.body) : null; },
    async headObject(bucket, key) { const o = objects.get(`${bucket}/${key}`); return o ? { contentLength: o.body.length, metadata: o.metadata } : null; },
    async deleteObject(bucket, key) { calls.push(['delete', bucket, key]); objects.delete(`${bucket}/${key}`); return true; },
    presignGet(bucket, key, ttl) { return `https://signed.example/${bucket}/${key}?ttl=${ttl}`; },
  };
};

const R2_ENV = { MEDIA_STORAGE: 's3', R2_ACCOUNT_ID: 'acc123', R2_ACCESS_KEY_ID: 'AK', R2_SECRET_ACCESS_KEY: 'SK', R2_BUCKET: 'zenvy-private' };

const newDb = async (file = ':memory:') => {
  const sequelize = new Sequelize({ dialect: 'sqlite', storage: file, logging: false });
  const Media = initCampusMediaModel(sequelize);
  await sequelize.sync();
  return { sequelize, Media };
};

const listen = (app) => new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const fetchRaw = (port, p, headers = {}) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path: p, headers }, (res) => {
    const chunks = [];
    res.on('data', (d) => chunks.push(d));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
  }).on('error', reject);
});
const mediaApp = () => {
  const { uploadMedia, serveMedia, parseUpload } = require('../../modules/campus/controllers/mediaController');
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.post('/api/campus/media', (req, res, next) => { req.user = { id: OWNER }; next(); }, parseUpload, uploadMedia);
  app.get('/api/campus/media/:id', serveMedia);
  return app;
};
const postJson = (port, p, body) => new Promise((resolve, reject) => {
  const data = Buffer.from(JSON.stringify(body));
  const req = http.request({ host: '127.0.0.1', port, path: p, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': data.length } }, (res) => {
    let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(b) }));
  });
  req.on('error', reject); req.end(data);
});

test('S3Lite signs exactly like AWS (published SigV4 examples)', () => {
  const c = new S3Lite({ endpoint: 'https://examplebucket.s3.amazonaws.com', region: 'us-east-1', accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' });
  const now = new Date('2013-05-24T00:00:00Z');
  // GET Object example
  let s = c.sign('GET', '/test.txt', { headers: { range: 'bytes=0-9' }, payloadHash: sha256Hex(''), now });
  assert.match(s.headers.authorization, /Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41$/);
  // PUT Object example
  s = c.sign('PUT', '/test%24file.text', { headers: { date: 'Fri, 24 May 2013 00:00:00 GMT', 'x-amz-storage-class': 'REDUCED_REDUNDANCY' }, payloadHash: sha256Hex('Welcome to Amazon S3.'), now });
  assert.match(s.headers.authorization, /Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd$/);
  // Pre-signed URL example
  c.path = () => '/test.txt';
  assert.match(c.presignGet('examplebucket', 'test.txt', 86400, now), /X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404$/);
});

test('config: default driver is db; s3 needs full config; public URL needs a separate public bucket', () => {
  let c = storage.reload({});
  assert.equal(storage.driverName(), 'db'); assert.equal(c.configured, false); assert.equal(storage.objectStoreConfigured(), false);
  c = storage.reload({ MEDIA_STORAGE: 's3', R2_BUCKET: 'b' });
  assert.equal(storage.driverName(), 'db', 's3 requested but incomplete → db');
  c = storage.reload(R2_ENV);
  assert.equal(storage.driverName(), 's3'); assert.equal(c.endpoint, 'https://acc123.r2.cloudflarestorage.com');
  c = storage.reload({ ...R2_ENV, R2_PUBLIC_URL: 'https://media.zenvy.in' });
  assert.equal(c.publicUrl, '', 'refused: no separate public bucket');
  c = storage.reload({ ...R2_ENV, R2_PUBLIC_URL: 'https://media.zenvy.in', R2_PUBLIC_BUCKET: 'zenvy-private' });
  assert.equal(c.publicUrl, '', 'refused: public bucket = private bucket');
  c = storage.reload({ ...R2_ENV, R2_PUBLIC_URL: 'https://media.zenvy.in/', R2_PUBLIC_BUCKET: 'zenvy-public' });
  assert.equal(c.publicUrl, 'https://media.zenvy.in');
  assert.equal(storage.bucketFor(true), 'zenvy-private'); assert.equal(storage.bucketFor(false), 'zenvy-public');
  const st = storage.status();
  assert.equal(st.driver, 's3'); assert.ok(!JSON.stringify(st).includes('SK'), 'no secret in status');
  storage.reload({});
});

test('db driver (default): rows keep their bytes, served exactly as before; hooks do nothing', async () => {
  storage.reload({}, { factory: null });
  const { sequelize, Media } = await newDb();
  const s = await listen(mediaApp());
  try {
    const p = s.address().port;
    const up = await postJson(p, '/api/campus/media', { image: png(1).toString('base64'), purpose: 'post' });
    assert.equal(up.status, 201);
    assert.deepEqual(Object.keys(up.body).sort(), ['absoluteUrl', 'id', 'imageUrl', 'isPrivate', 'mime', 'purpose', 'size', 'url'].sort());
    const row = await Media.findByPk(up.body.id);
    assert.ok(Buffer.from(row.bytes).equals(png(1)));
    const r = await fetchRaw(p, up.body.url);
    assert.equal(r.status, 200); assert.ok(r.body.equals(png(1)));
    assert.equal(r.headers['cache-control'], 'public, max-age=31536000, immutable');
    // db driver interface
    const d = storage.getDriver('db');
    const got = await d.get(row.id);
    const chunks = []; for await (const ch of got.stream) chunks.push(ch);
    assert.ok(Buffer.concat(chunks).equals(png(1)));
    assert.equal(d.publicUrl(row.id), `/api/campus/media/${row.id}`);
    await Media.destroy({ where: { id: row.id } });
    assert.equal(await Media.count(), 0);
  } finally { s.close(); await sequelize.close(); }
});

test('s3 driver (mocked client): upload goes to the bucket, row bytes empty, same response shape; serve proxies', async () => {
  const fake = fakeS3();
  storage.reload(R2_ENV, { factory: () => fake });
  const { sequelize, Media } = await newDb();
  const s = await listen(mediaApp());
  try {
    const p = s.address().port;
    const up = await postJson(p, '/api/campus/media', { image: png(2).toString('base64'), purpose: 'post' });
    assert.equal(up.status, 201);
    assert.deepEqual(Object.keys(up.body).sort(), ['absoluteUrl', 'id', 'imageUrl', 'isPrivate', 'mime', 'purpose', 'size', 'url'].sort());
    const row = await Media.findByPk(up.body.id);
    assert.equal(Buffer.from(row.bytes).length, 0); assert.equal(row.size, png(2).length); assert.equal(row.sha256, sha(png(2)));
    assert.ok(storage.isExternal(row));
    const obj = fake.objects.get(`zenvy-private/campus-media/${row.id}`);
    assert.ok(obj && obj.body.equals(png(2))); assert.equal(obj.metadata.sha256, sha(png(2)));
    let r = await fetchRaw(p, up.body.url);
    assert.equal(r.status, 200); assert.ok(r.body.equals(png(2)));
    assert.equal(r.headers['content-type'], 'image/png'); assert.equal(r.headers['cache-control'], 'public, max-age=31536000, immutable');
    assert.equal(r.headers.etag, `"m-${row.id}"`);
    r = await fetchRaw(p, up.body.url, { 'if-none-match': `"m-${row.id}"` });
    assert.equal(r.status, 304);
    // Same bytes again → same row (dedupe), no second object.
    const again = await postJson(p, '/api/campus/media', { image: png(2).toString('base64'), purpose: 'post' });
    assert.equal(again.body.id, up.body.id);
    assert.equal(fake.calls.filter((c) => c[0] === 'put').length, 1);
    // Private upload: object stored, served only with a signed link (proxied by default).
    const priv = await postJson(p, '/api/campus/media', { image: png(3).toString('base64'), purpose: 'id_card' });
    assert.equal(priv.body.isPrivate, true);
    r = await fetchRaw(p, priv.body.url);
    assert.equal(r.status, 404, 'private without signature/owner');
    const signed = new URL(priv.body.previewUrl);
    r = await fetchRaw(p, signed.pathname + signed.search);
    if (process.env.JWT_SECRET) { assert.equal(r.status, 200); assert.ok(r.body.equals(png(3))); assert.equal(r.headers['cache-control'], 'private, max-age=86400'); }
  } finally { s.close(); await sequelize.close(); storage.reload({}, { factory: null }); }
});

test('s3 driver: R2_PUBLIC_URL redirects public photos; MEDIA_PRIVATE_DELIVERY=redirect presigns private ones', async () => {
  const fake = fakeS3();
  storage.reload({ ...R2_ENV, R2_PUBLIC_URL: 'https://media.zenvy.in', R2_PUBLIC_BUCKET: 'zenvy-public', MEDIA_PRIVATE_DELIVERY: 'redirect' }, { factory: () => fake });
  const { sequelize, Media } = await newDb();
  const s = await listen(mediaApp());
  try {
    const p = s.address().port;
    const up = await postJson(p, '/api/campus/media', { image: png(4).toString('base64'), purpose: 'post' });
    assert.ok(fake.objects.has(`zenvy-public/campus-media/${up.body.id}`), 'public photo in the public bucket');
    let r = await fetchRaw(p, up.body.url);
    assert.equal(r.status, 302); assert.equal(r.headers.location, `https://media.zenvy.in/campus-media/${up.body.id}`);
    assert.equal(r.headers['cache-control'], 'public, max-age=86400');
    const plan = storage.deliveryPlan({ id: 'x', isPrivate: true, size: 3 });
    assert.match(plan.redirect, /^https:\/\/signed\.example\/zenvy-private\/campus-media\/x\?ttl=300$/);
    assert.equal(plan.cacheControl, 'private, no-store');
    const priv = await postJson(p, '/api/campus/media', { image: png(5).toString('base64'), purpose: 'id_card' });
    assert.ok(fake.objects.has(`zenvy-private/campus-media/${priv.body.id}`), 'private photo never in the public bucket');
    assert.ok(!fake.objects.has(`zenvy-public/campus-media/${priv.body.id}`));
    void Media;
  } finally { s.close(); await sequelize.close(); storage.reload({}, { factory: null }); }
});

test('s3 driver: an R2 outage during upload falls back to the database (upload still succeeds)', async () => {
  const fake = fakeS3(); fake.failPut = true;
  storage.reload(R2_ENV, { factory: () => fake });
  const { sequelize, Media } = await newDb();
  const warn = console.warn; console.warn = () => {};
  try {
    const { saveImageBytes } = require('../../utils/imageStore');
    const saved = await saveImageBytes(png(6), { ownerId: OWNER, purpose: 'post' });
    const row = await Media.findByPk(saved.id);
    assert.ok(Buffer.from(row.bytes).equals(png(6)), 'bytes kept in the row');
    assert.equal(storage.isExternal(row), false);
  } finally { console.warn = warn; await sequelize.close(); storage.reload({}, { factory: null }); }
});

test('CampusMedia hooks: destroying R2-backed rows deletes their objects (after commit only)', async () => {
  const fake = fakeS3();
  storage.reload(R2_ENV, { factory: () => fake });
  const { sequelize, Media } = await newDb();
  try {
    const a = await storage.createMediaRow(Media, { ownerId: OWNER, purpose: 'chat', mime: 'image/png', size: png(7).length, sha256: sha(png(7)), isPrivate: false }, png(7));
    const b = await storage.createMediaRow(Media, { ownerId: OWNER, purpose: 'chat', mime: 'image/png', size: png(8).length, sha256: sha(png(8)), isPrivate: false }, png(8));
    assert.equal(fake.objects.size, 2);
    // Rolled-back transaction: nothing deleted.
    const t = await sequelize.transaction();
    await Media.destroy({ where: { id: a.id }, transaction: t });
    await t.rollback();
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(fake.objects.size, 2);
    // Committed transaction: object deleted after commit.
    await sequelize.transaction(async (tx) => { await Media.destroy({ where: { id: a.id }, transaction: tx }); });
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(fake.objects.has(`zenvy-private/campus-media/${a.id}`), false);
    // Instance destroy without a transaction.
    const rowB = await Media.findByPk(b.id);
    await rowB.destroy();
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(fake.objects.size, 0);
    // A row with bytes in the DB never triggers an object delete.
    storage.reload({ ...R2_ENV, MEDIA_STORAGE: 'db' }, { factory: () => fake });
    const c = await storage.createMediaRow(Media, { ownerId: OWNER, purpose: 'chat', mime: 'image/png', size: png(9).length, sha256: sha(png(9)) }, png(9));
    const before = fake.calls.filter((x) => x[0] === 'delete').length;
    await Media.destroy({ where: { id: c.id } });
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(fake.calls.filter((x) => x[0] === 'delete').length, before);
  } finally { await sequelize.close(); storage.reload({}, { factory: null }); }
});

// ── Real local S3-compatible server (s3rver) ───────────────────────────────────────────────────────
const S3RVER = process.env.S3RVER_MODULE;
const withS3rver = async (fn) => {
  const S3rver = require(S3RVER);
  const dir = fs.mkdtempSync(path.join(tmp, 's3-'));
  const srv = new S3rver({ port: 0, address: '127.0.0.1', silent: true, directory: dir, configureBuckets: [{ name: 'zpriv' }, { name: 'zpub' }] });
  const info = await srv.run();
  const port = info.port || (srv.httpServer && srv.httpServer.address().port);
  try { return await fn(`http://127.0.0.1:${port}`); } finally { await srv.close(); }
};
const S3_ENV = (endpoint) => ({ MEDIA_STORAGE: 's3', R2_ENDPOINT: endpoint, R2_REGION: 'us-east-1', R2_ACCESS_KEY_ID: 'S3RVER', R2_SECRET_ACCESS_KEY: 'S3RVER', R2_BUCKET: 'zpriv' });

test('s3 driver against a local S3 server: upload, stream back, presign, delete', { skip: !S3RVER && 'S3RVER_MODULE not set' }, async () => {
  await withS3rver(async (endpoint) => {
    storage.reload(S3_ENV(endpoint), { factory: null });
    const { sequelize, Media } = await newDb();
    const s = await listen(mediaApp());
    try {
      const p = s.address().port;
      const up = await postJson(p, '/api/campus/media', { image: png(10).toString('base64'), purpose: 'post' });
      assert.equal(up.status, 201);
      const row = await Media.findByPk(up.body.id);
      assert.ok(storage.isExternal(row));
      const r = await fetchRaw(p, up.body.url);
      assert.equal(r.status, 200); assert.ok(r.body.equals(png(10)));
      const signed = storage.getDriver('s3').signedUrl(storage.objectKey(row.id), { isPrivate: false });
      const pr = await fetch(signed);
      assert.equal(pr.status, 200); assert.ok(Buffer.from(await pr.arrayBuffer()).equals(png(10)));
      await Media.destroy({ where: { id: row.id } });
      await new Promise((res) => setTimeout(res, 200));
      assert.equal(await storage.client().headObject('zpriv', storage.objectKey(row.id)), null, 'object deleted with the row');
    } finally { s.close(); await sequelize.close(); storage.reload({}, { factory: null }); }
  });
});

// Async on purpose: the local S3 server runs in THIS process, so a blocking spawnSync would deadlock it.
const runScript = (args, env) => new Promise((resolve) => {
  const child = spawn(process.execPath, [path.join(BACKEND, 'scripts', 'migrate_media_to_r2.js'), ...args], {
    cwd: BACKEND, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env },
  });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('close', (status) => resolve({ status, stdout, stderr }));
});

test('migrate_media_to_r2: dry run writes nothing; apply verifies; purge empties bytes; resumable; --to-db restores', { skip: !S3RVER && 'S3RVER_MODULE not set' }, async () => {
  await withS3rver(async (endpoint) => {
    const file = path.join(tmp, 'migrate.sqlite');
    const state = path.join(tmp, 'migrate_state.json');
    const { sequelize, Media } = await newDb(file);
    const bufs = [1, 2, 3, 4, 5].map((n) => png(100 + n));
    for (const [i, b] of bufs.entries()) await Media.create({ ownerId: OWNER, purpose: i === 4 ? 'id_card' : 'post', mime: 'image/png', size: b.length, sha256: sha(b), isPrivate: i === 4, bytes: b });
    await sequelize.close();
    const env = { ...S3_ENV(endpoint), MEDIA_STORAGE: '' };
    const fileHash = () => sha(fs.readFileSync(file));
    storage.reload(S3_ENV(endpoint), { factory: null });
    const s3 = storage.client();
    const countObjects = async () => { let n = 0; for (const b of bufs) void b; const db2 = await newDb(file); const rows = await db2.Media.findAll({ attributes: ['id', 'isPrivate'] }); for (const r of rows) if (await s3.headObject(r.isPrivate ? 'zpriv' : 'zpriv', storage.objectKey(r.id))) n++; await db2.sequelize.close(); return n; };

    const h0 = fileHash();
    let r = await runScript([`--sqlite=${file}`, `--state=${state}`], env);
    assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /DRY RUN/); assert.match(r.stdout, /"candidates":5/);
    assert.equal(fileHash(), h0, 'dry run did not touch the database'); assert.equal(await countObjects(), 0, 'dry run uploaded nothing');
    assert.equal(fs.existsSync(state), false, 'dry run wrote no state');

    r = await runScript([`--sqlite=${file}`, `--state=${state}`, '--apply', '--batch=2', '--limit=2'], env);
    assert.equal(r.status, 0, r.stdout + r.stderr); assert.equal(await countObjects(), 2);
    r = await runScript([`--sqlite=${file}`, `--state=${state}`, '--apply', '--batch=2'], env);
    assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /resuming/);
    assert.equal(await countObjects(), 5);
    let db = await newDb(file);
    assert.equal((await db.Media.findAll()).filter((x) => Buffer.from(x.bytes).length > 0).length, 5, 'bytes still in the DB without --purge-after-verify');
    await db.sequelize.close();

    r = await runScript([`--sqlite=${file}`, `--state=${state}`, '--apply', '--purge-after-verify', '--reset-state'], env);
    assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /"alreadyThere":5/); assert.match(r.stdout, /"purged":5/);
    db = await newDb(file);
    const rows = await db.Media.findAll({ order: [['createdAt', 'ASC']] });
    assert.ok(rows.every((x) => storage.isExternal(x)), 'every row now served from R2');
    // The app serves them from the bucket, byte-identical.
    storage.reload({ ...S3_ENV(endpoint), MEDIA_STORAGE: 'db' }, { factory: null });
    const { Media: M2 } = db; void M2;
    const app = mediaApp(); const s = await listen(app);
    try {
      for (const row of rows.filter((x) => !x.isPrivate)) {
        const got = await fetchRaw(s.address().port, `/api/campus/media/${row.id}`);
        assert.equal(got.status, 200); assert.equal(sha(got.body), row.sha256);
      }
    } finally { s.close(); }
    await db.sequelize.close();

    // Rollback to the database.
    r = await runScript([`--sqlite=${file}`, '--to-db', '--apply', `--state=${state}.todb`], env);
    assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /"restored":5/);
    db = await newDb(file);
    for (const row of await db.Media.findAll()) assert.equal(sha(Buffer.from(row.bytes)), row.sha256);
    await db.sequelize.close();
    assert.equal(await countObjects(), 5, 'objects kept without --purge-after-verify');
    storage.reload({}, { factory: null });
  });
});

test('migrate_media_to_r2: refuses --apply without R2 settings', async () => {
  const file = path.join(tmp, 'noenv.sqlite');
  fs.writeFileSync(file, '');
  const r = await runScript([`--sqlite=${file}`, '--apply'], {});
  assert.equal(r.status, 1); assert.match(r.stderr, /R2 is not configured/);
});
