// Stationery / print stalls (owner, 29 Oct 2026: "for stationery ... uploads of documents"): a booking can carry
// up to 5 PDFs the student uploaded first (private 'service_doc' rows, POST /api/services/documents), and
// per-page lines up to 200. Other stalls refuse files. The student, the stall and admins get short-lived signed
// links; a link without a valid signature, or for another booking, is a plain 404.
const test = require('node:test');
const assert = require('node:assert');
const T = require('./helpers');

const V = '/api/campus-booking/vendor';

test.before(async () => { await T.setup(); });
test.after(async () => { await T.teardown(); });

const pdfFor = async (user, name = 'Notes.pdf') => {
  const r = await T.H.r('utils/serviceDocuments').storeServiceDocumentBuffer(Buffer.from(`%PDF-1.4\n% zcs test ${Date.now()} ${Math.random()}\n%%EOF`), { ownerId: user.id, name });
  assert.ok(r.ok, JSON.stringify(r));
  return { id: r.value.mediaId, name };
};
const stationeryStall = (opts = {}) => T.mkStall({ prices: [2, 30], ...opts, store: { tags: ['stationery', 'xerox'], ...(opts.store || {}) } });
const bookWith = (user, stall, body) => T.cb('POST', '/api/campus-booking/bookings', user.token, { stallId: stall.store.id, ...body });

test('a stationery stall takes PDFs and per-page lines; student, stall and admin get working signed links', async () => {
  const s = await stationeryStall();
  const u = await T.mkUser();
  const doc = await pdfFor(u, 'DBMS Unit 3.pdf');
  const r = await bookWith(u, s, { items: [{ menuItemId: s.items[0].id, quantity: 60 }, { menuItemId: s.items[1].id, quantity: 1 }], note: '2 copies, double sided', documents: [doc] });
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  const b = r.body.booking;
  assert.strictEqual(b.amount, 150); // 60 pages x ₹2 + binding ₹30
  assert.strictEqual(b.documents.length, 1);
  assert.strictEqual(b.documents[0].name, 'DBMS Unit 3.pdf');
  assert.match(b.documents[0].url, /\/api\/campus-booking\/documents\/[0-9a-f-]{36}\/[0-9a-f-]{36}\?exp=\d+&sig=[0-9a-f]{32}$/);

  const get = (url) => T.cb('GET', url.replace(/^https?:\/\/[^/]+/, ''));
  const file = await get(b.documents[0].url);
  assert.strictEqual(file.status, 200);
  // the stall's detail view and the admin's carry their own signed links
  const vendorView = (await T.cb('GET', `${V}/bookings/${b.id}`, s.store.token)).body.booking;
  assert.strictEqual((await get(vendorView.documents[0].url)).status, 200);
  const admin = await T.mkUser({ role: 'admin' });
  const adminView = (await T.cb('GET', `/api/admin/campus-booking/bookings/${b.id}`, admin.token)).body.booking;
  assert.strictEqual((await get(adminView.documents[0].url)).status, 200);

  // tampered signature, another booking id, or no signature: 404
  const bad = b.documents[0].url.replace(/sig=[0-9a-f]{4}/, 'sig=0000');
  assert.strictEqual((await get(bad)).status, 404);
  assert.strictEqual((await get(`/api/campus-booking/documents/${b.id}/${b.documents[0].id}`)).status, 404);
  const other = (await bookWith(u, s, { items: [{ menuItemId: s.items[0].id, quantity: 1 }] })).body.booking;
  assert.strictEqual((await get(b.documents[0].url.replace(b.id, other.id))).status, 404);
});

test('files are refused at other stalls, from someone else, or more than 5', async () => {
  const food = await T.mkStall();
  const u = await T.mkUser();
  const doc = await pdfFor(u);
  let r = await bookWith(u, food, { items: [{ menuItemId: food.items[0].id, quantity: 1 }], documents: [doc] });
  assert.deepStrictEqual([r.status, r.body.code], [400, 'DOCUMENTS_NOT_TAKEN']);

  const s = await stationeryStall();
  const other = await T.mkUser();
  r = await bookWith(u, s, { items: [{ menuItemId: s.items[0].id, quantity: 1 }], documents: [await pdfFor(other)] });
  assert.deepStrictEqual([r.status, r.body.code], [400, 'BAD_DOCUMENT']);

  const six = [];
  for (let i = 0; i < 6; i++) six.push(await pdfFor(u, `Part ${i}.pdf`));
  r = await bookWith(u, s, { items: [{ menuItemId: s.items[0].id, quantity: 1 }], documents: six });
  assert.deepStrictEqual([r.status, r.body.code], [400, 'TOO_MANY_DOCUMENTS']);
});

test('per-line caps: 200 pages at a stationery stall, 10 at a food stall', async () => {
  const s = await stationeryStall();
  const u = await T.mkUser();
  let r = await bookWith(u, s, { items: [{ menuItemId: s.items[0].id, quantity: 201 }] });
  assert.deepStrictEqual([r.status, r.body.code], [400, 'INVALID_QUANTITY']);
  const food = await T.mkStall();
  r = await bookWith(u, food, { items: [{ menuItemId: food.items[0].id, quantity: 11 }] });
  assert.deepStrictEqual([r.status, r.body.code], [400, 'INVALID_QUANTITY']);
  assert.match(r.body.message, /1 to 10/);
});
