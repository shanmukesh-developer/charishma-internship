// Photo links that are sure to break (31 Oct 2026: a product photo pasted from Google Flow stopped showing when
// its signed link expired): temporary / signed links and Google Images previews are refused for new photos with a
// clear message, while a link already on the row passes unchanged (editing a price never fails over an old photo).
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers');

test.before(() => H.setup());
test.after(() => H.teardown());

const FLOW = 'https://flow-content.google/image/d5c46c00-6d02-4088-9a1e-8d7d158767ce?Expires=1793277743&Signature=abc&Key-Pair-Id=K1';
const S3 = 'https://bucket.s3.amazonaws.com/pickle.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=3600&X-Amz-Signature=ff';
const GCS = 'https://storage.googleapis.com/b/pickle.jpg?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Expires=900&X-Goog-Signature=aa';
const AZURE = 'https://acct.blob.core.windows.net/c/pickle.jpg?sv=2022-11-02&se=2026-11-01T00%3A00%3A00Z&sr=b&sp=r&sig=xyz';
const FB = 'https://scontent.fhyd1-1.fna.fbcdn.net/v/t39/pickle.jpg?_nc_cat=1&oh=00_AbC&oe=67A1B2C3';
const PREVIEW = 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcR123&s';
const PLAIN = 'https://example-farm.in/images/tomato-pickle.jpg';
const FIREBASE = 'https://firebasestorage.googleapis.com/v0/b/app.appspot.com/o/pickle.jpg?alt=media&token=1b2c';

test('imageLinkProblem: temporary links and Google previews are named; plain and permanent links pass', () => {
  const { imageLinkProblem } = require('../../utils/imageStore');
  for (const u of [FLOW, S3, GCS, AZURE, FB]) assert.strictEqual((imageLinkProblem(u) || {}).code, 'IMAGE_LINK_TEMPORARY', u);
  assert.strictEqual((imageLinkProblem(PREVIEW) || {}).code, 'IMAGE_LINK_PREVIEW');
  for (const u of [PLAIN, FIREBASE, '/api/campus/media/0b9d6f0e-1c1a-4c55-9a51-5d8f1f0a2b3c', 'not a url', '']) assert.strictEqual(imageLinkProblem(u), null, u);
});

test('storeImageRef: refuses a new temporary link, keeps the same link when it is already on the row', async () => {
  const { storeImageRef } = require('../../utils/imageStore');
  const fresh = await storeImageRef(FLOW, { purpose: 'menu' });
  assert.strictEqual(fresh.ok, false);
  assert.strictEqual(fresh.code, 'IMAGE_LINK_TEMPORARY');
  assert.match(fresh.message, /upload it instead/);
  const kept = await storeImageRef(FLOW, { purpose: 'menu', keep: FLOW });
  assert.deepStrictEqual(kept, { ok: true, value: FLOW });
  const keptInList = await require('../../utils/imageStore').storeImageList([PLAIN, FLOW], { purpose: 'pg', keep: [FLOW] });
  assert.deepStrictEqual(keptInList, { ok: true, value: [PLAIN, FLOW] });
  const other = await storeImageRef(S3, { purpose: 'menu', keep: FLOW });
  assert.strictEqual(other.code, 'IMAGE_LINK_TEMPORARY');
  assert.deepStrictEqual(await storeImageRef(PLAIN, { purpose: 'menu' }), { ok: true, value: PLAIN });
});

test('admin product save: a pasted temporary link is refused with the reason; an old one never blocks a price edit', async () => {
  const admin = await H.mkUser({ role: 'admin' });
  const store = await H.mkStore();
  const created = await H.api('POST', '/api/admin/menu-items/new', admin.token, { restaurantId: store.id, name: 'Amla Pickle', price: 199, category: 'Pickles', imageUrl: FLOW });
  assert.strictEqual(created.status, 400, JSON.stringify(created.body));
  assert.match(created.body.message, /^Photo: That photo link is temporary/);
  const preview = await H.api('POST', '/api/admin/menu-items/new', admin.token, { restaurantId: store.id, name: 'Kaaram Podi', price: 149, category: 'Podi', imageUrl: PREVIEW });
  assert.strictEqual(preview.status, 400);
  assert.match(preview.body.message, /Google Images preview/);

  // A row saved before this rule (old data) keeps its link through an ordinary edit.
  const old = await H.ctx.M.MenuItem.create({ restaurantId: store.id, name: 'Old Amla Pickle', price: 199, category: 'Pickles', imageUrl: FLOW, isAvailable: true });
  const edit = await H.api('POST', `/api/admin/menu-items/${old.id}`, admin.token, { name: 'Old Amla Pickle', price: 219, category: 'Pickles', imageUrl: FLOW });
  assert.strictEqual(edit.status, 200, JSON.stringify(edit.body));
  await old.reload();
  assert.strictEqual(Number(old.price), 219);
  assert.strictEqual(old.imageUrl, FLOW);
  // ...but swapping it for another temporary link is refused.
  const swap = await H.api('POST', `/api/admin/menu-items/${old.id}`, admin.token, { imageUrl: S3 });
  assert.strictEqual(swap.status, 400);

  // Bulk import names the row.
  const bulk = await H.api('POST', '/api/admin/menu-items/bulk', admin.token, { restaurantId: store.id, items: [{ name: 'Tomato Pickle', price: 179, category: 'Pickles', imageUrl: PLAIN }, { name: 'Gongura Pickle', price: 189, category: 'Pickles', imageUrl: FB }] });
  assert.strictEqual(bulk.status, 400);
  assert.ok((bulk.body.errors || []).some((e) => /temporary/.test(e.message)), JSON.stringify(bulk.body));
});
