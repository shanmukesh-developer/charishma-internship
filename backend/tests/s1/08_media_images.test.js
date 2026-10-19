// Partner-app photos: public media answers repeat requests from memory (no DB read), private media is
// never cached, and the opt-in Wikimedia copy job rewrites store / menu photo links to our media rows.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers');

test.before(() => H.setup());
test.after(() => H.teardown());

const jpeg = (tag) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]), Buffer.from(`zenvy-${tag}-${Math.random()}`)]);
const mc = () => require('../../modules/campus/controllers/mediaController');

test('GET /api/campus/media/:id serves public photos from memory after the first read; 304 keeps cache headers', async () => {
  mc().mediaHotCache.clear();
  const { saveImageBytes } = require('../../utils/imageStore');
  const saved = await saveImageBytes(jpeg('pub'), { purpose: 'menu' });
  const url = `/api/campus/media/${saved.id}`;
  const first = await fetch(H.ctx.base + url);
  assert.strictEqual(first.status, 200);
  assert.match(first.headers.get('cache-control'), /public, max-age=31536000, immutable/);
  const etag = first.headers.get('etag');
  assert.strictEqual(mc().mediaHotCache.stats().entries, 1);

  // Second read must not touch the database.
  const Media = H.ctx.M.CampusMedia;
  const orig = Media.findByPk;
  let dbReads = 0;
  Media.findByPk = async (...a) => { dbReads++; return orig.apply(Media, a); };
  try {
    const again = await fetch(H.ctx.base + url);
    assert.strictEqual(again.status, 200);
    assert.strictEqual(Buffer.from(await again.arrayBuffer()).length, saved.size);
    const notModified = await fetch(H.ctx.base + url, { headers: { 'If-None-Match': etag } });
    assert.strictEqual(notModified.status, 304);
    assert.match(notModified.headers.get('cache-control') || '', /immutable/);
    assert.strictEqual(dbReads, 0, 'served from memory');
  } finally { Media.findByPk = orig; }

  // Upper-case id is the same photo.
  assert.strictEqual((await fetch(H.ctx.base + url.toUpperCase().replace('/API/CAMPUS/MEDIA/', '/api/campus/media/'))).status, 200);
});

test('private media is never kept in memory and still needs a signature', async () => {
  mc().mediaHotCache.clear();
  const { saveImageBytes } = require('../../utils/imageStore');
  const saved = await saveImageBytes(jpeg('priv'), { purpose: 'bill' });
  const url = `/api/campus/media/${saved.id}`;
  assert.strictEqual((await fetch(H.ctx.base + url)).status, 404);
  const signed = require('../../utils/mediaAccess').signedUrlForId(null, saved.id);
  const r = await fetch(H.ctx.base + signed.slice(signed.indexOf('/api/')));
  assert.strictEqual(r.status, 200);
  assert.match(r.headers.get('cache-control'), /^private/);
  assert.strictEqual(mc().mediaHotCache.stats().entries, 0);
  // A 304 for a private photo still checks access.
  const etag = r.headers.get('etag');
  assert.strictEqual((await fetch(H.ctx.base + url, { headers: { 'If-None-Match': etag } })).status, 404);
});

test('Wikimedia copy job: dry run counts only; apply stores once per store and rewrites matching rows', async () => {
  const job = require('../../scripts/rehost_wikimedia_images');
  assert.strictEqual(job.thumb500('https://upload.wikimedia.org/wikipedia/commons/thumb/3/38/A_b.jpg/960px-A_b.jpg'), 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/38/A_b.jpg/500px-A_b.jpg');
  assert.strictEqual(job.thumb500('https://upload.wikimedia.org/wikipedia/commons/a/ab/Foo.JPG'), 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Foo.JPG/500px-Foo.JPG');
  assert.strictEqual(job.thumb500('https://upload.wikimedia.org/wikipedia/commons/thumb/3/38/A.jpg/250px-A.jpg'), null);

  const store = await H.mkStore();
  const wiki = 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/38/Dish.jpg/960px-Dish.jpg';
  const gone = 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/11/Gone.jpg/960px-Gone.jpg';
  await H.ctx.M.Restaurant.update({ imageUrl: wiki }, { where: { id: store.id } });
  const a = await H.ctx.M.MenuItem.create({ restaurantId: store.id, name: 'A', price: 10, imageUrl: wiki });
  const b = await H.ctx.M.MenuItem.create({ restaurantId: store.id, name: 'B', price: 10, imageUrl: wiki });
  const c = await H.ctx.M.MenuItem.create({ restaurantId: store.id, name: 'C', price: 10, imageUrl: gone });
  const keep = await H.ctx.M.MenuItem.create({ restaurantId: store.id, name: 'D', price: 10, imageUrl: 'https://images.unsplash.com/photo-1?w=600' });

  const calls = [];
  const bytes = jpeg('wiki');
  const fetchImpl = async (u, opts) => {
    calls.push({ u, ua: opts.headers['User-Agent'] });
    if (u.includes('Gone')) return new Response('nope', { status: 404 });
    return new Response(bytes, { status: 200, headers: { 'content-type': 'image/jpeg' } });
  };
  const dry = await job.runWikimediaRehost({ apply: false, sequelize: H.ctx.sequelize, fetchImpl, gapMs: 0 });
  assert.strictEqual(dry.urls, 2);
  assert.strictEqual(calls.length, 0, 'dry run fetches nothing');

  const r = await H.silent(() => job.runWikimediaRehost({ apply: true, sequelize: H.ctx.sequelize, fetchImpl, gapMs: 0, base: 'https://api.test' }));
  assert.strictEqual(r.copied, 1);
  assert.strictEqual(r.failed, 1);
  assert.ok(calls[0].u.includes('/500px-Dish.jpg'), 'asks for the 500 px copy first');
  assert.match(calls[0].ua, /^ZenvyMediaCopy\/1\.0 \(/);
  const reread = async (M, id) => (await H.ctx.M[M].findByPk(id)).imageUrl;
  const newUrl = await reread('MenuItem', a.id);
  assert.match(newUrl, /^https:\/\/api\.test\/api\/campus\/media\/[0-9a-f-]{36}$/);
  assert.strictEqual(await reread('MenuItem', b.id), newUrl, 'same store + purpose -> one media row');
  assert.match(await reread('Restaurant', store.id), /^https:\/\/api\.test\/api\/campus\/media\//);
  assert.strictEqual(await reread('MenuItem', c.id), gone, 'failed fetch leaves the row alone');
  assert.strictEqual(await reread('MenuItem', keep.id), 'https://images.unsplash.com/photo-1?w=600');
  const id = newUrl.split('/').pop();
  const row = await H.ctx.M.CampusMedia.findByPk(id);
  assert.strictEqual(row.isPrivate, false);
});
