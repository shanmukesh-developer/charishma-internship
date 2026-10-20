// Friction fixes of 20 Oct for services:
//  • a partner / admin quote or final price sends "Quote ready for <service>: ₹X. Tap to approve." (push +
//    in-app list) that opens the booking (data.type SERVICE_QUOTE + bookingId); no push when nothing changed;
//  • print PDFs can be uploaded first (POST /api/services/documents, multipart 'document'), then booked
//    with { documentId }; only the uploader's own service_doc resolves; the inline form still works.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers');

const pushes = [];
test.before(async () => {
  await H.setup();
  const pushMod = require.cache[require.resolve(require('path').join(H.B, 'utils/push.js'))].exports;
  pushMod.sendPushToTokens = async (tokens, title, body, data, opts = {}) => {
    pushes.push({ title, body, data, recipients: (opts.recipients || []).map(String) });
    return { successCount: 0, failureCount: 0, staleTokens: [] };
  };
});
test.after(() => H.teardown());

const specsOf = (row) => (typeof row.specifications === 'string' ? JSON.parse(row.specifications) : row.specifications || {});
const mkServiceStore = async (vendorType, items) => {
  const store = await H.mkStore();
  await store.update({ vendorType });
  const rows = {};
  for (const [name, price] of items) rows[name] = await H.ctx.M.MenuItem.create({ restaurantId: store.id, name, price, isAvailable: true, specs: { bookingOnly: true } });
  return rows;
};
const book = (user, body) => H.api('POST', '/api/services/book', user.token, {
  pickupSlot: 'Tomorrow, 10 AM', hostelBlock: 'Ganga', roomNumber: '412', contactPhone: '9876543210', paymentMethod: 'COD', ...body,
});
const settle = () => new Promise((r) => setTimeout(r, 50));
const PDF_BODY = '%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n';
const uploadPdf = async (token, bytes, name = 'Notes.pdf', field = 'document') => {
  const fd = new FormData();
  fd.append(field, new Blob([bytes], { type: 'application/pdf' }), name);
  const res = await fetch(`${H.ctx.base}/api/services/documents`, { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: fd });
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
};

test('quote set by the admin: one push "Quote ready … Tap to approve." for the student, deep link data', async () => {
  const items = await mkServiceStore('REPAIRS', [['Laptop Screen Repair', 0]]);
  const u = await H.mkUser();
  const admin = await H.mkUser({ role: 'admin' });
  const r = await book(u, { serviceType: 'GENERAL', title: 'Laptop Screen Repair', specifications: { catalogueItemId: items['Laptop Screen Repair'].id, category: 'repairs' } });
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  const id = r.body.booking.id;
  pushes.length = 0;

  let p = await H.api('PATCH', `/api/services/${id}/status`, admin.token, { status: 'DIAGNOSED_QUOTED', quotedAmount: 1450 });
  assert.strictEqual(p.status, 200, JSON.stringify(p.body));
  await settle();
  assert.strictEqual(pushes.length, 1, JSON.stringify(pushes));
  assert.strictEqual(pushes[0].body, 'Quote ready for Laptop Screen Repair: ₹1,450. Tap to approve.');
  assert.strictEqual(pushes[0].title, 'Quote ready');
  assert.deepStrictEqual(pushes[0].recipients, [String(u.id)]);
  assert.strictEqual(pushes[0].data.type, 'SERVICE_QUOTE');
  assert.strictEqual(pushes[0].data.bookingId, String(id));

  // Same amount again (e.g. a note update): no second push.
  p = await H.api('PATCH', `/api/services/${id}/status`, admin.token, { quotedAmount: 1450, note: 'Spare part ordered' });
  assert.strictEqual(p.status, 200);
  await settle();
  assert.strictEqual(pushes.length, 1);

  // Student approves; a lower final price later is a plain "Final price" notice (no approval needed).
  const c = await H.api('POST', `/api/services/${id}/confirm-quote`, u.token, { acceptQuote: true, quotedAmount: 1450 });
  assert.strictEqual(c.status, 200, JSON.stringify(c.body));
  p = await H.api('PATCH', `/api/services/${id}/status`, admin.token, { finalAmount: 1300 });
  assert.strictEqual(p.status, 200, JSON.stringify(p.body));
  await settle();
  assert.strictEqual(pushes.length, 2);
  assert.strictEqual(pushes[1].body, 'Final price for Laptop Screen Repair: ₹1,300.');
  assert.strictEqual(pushes[1].data.awaitingApproval, '0');
});

test('PDF upload first: multipart → id → booking with documentId; download works', async () => {
  const items = await mkServiceStore('PRINT', [['Document Printout (Black & White)', 2]]);
  const u = await H.mkUser();
  const up = await uploadPdf(u.token, Buffer.from(PDF_BODY, 'latin1'), '../My Thesis<1>.pdf');
  assert.strictEqual(up.status, 201, JSON.stringify(up.body));
  assert.ok(up.body.document && up.body.document.id);
  assert.strictEqual(up.body.document.name, 'My Thesis1.pdf');
  const media = await H.ctx.M.CampusMedia.findByPk(up.body.document.id);
  assert.strictEqual(media.purpose, 'service_doc');
  assert.strictEqual(media.isPrivate, true);
  assert.strictEqual(String(media.ownerId), String(u.id));

  const r = await book(u, {
    serviceType: 'PRINTOUT', title: 'Document Printout (Black & White)',
    documentId: up.body.document.id, documentName: 'My Thesis.pdf',
    specifications: { catalogueItemId: items['Document Printout (Black & White)'].id, category: 'print', pageCount: '3', copies: '1' },
  });
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  const row = await H.ctx.M.ServiceBooking.findByPk(r.body.booking.id);
  const spec = specsOf(row);
  assert.strictEqual(spec.document.mediaId, up.body.document.id);
  assert.strictEqual(spec.documentName, 'My Thesis.pdf');
  const dl = await fetch(`${H.ctx.base}/api/services/${row.id}/document`, { headers: { authorization: `Bearer ${u.token}` } });
  assert.strictEqual(dl.status, 200);
  assert.strictEqual(Buffer.from(await dl.arrayBuffer()).toString('latin1'), PDF_BODY);
});

test('PDF upload rules: not a PDF, too large, wrong field, no session, someone else\'s id, non-print booking', async () => {
  const items = await mkServiceStore('PRINT', [['Document Printout (Colour)', 5]]);
  const repairs = await mkServiceStore('REPAIRS', [['Doorstep Tech Diagnosis & Pickup', 99]]);
  const u = await H.mkUser();
  const other = await H.mkUser();
  assert.strictEqual((await uploadPdf(u.token, Buffer.from('<html></html>'))).body.code, 'BAD_DOCUMENT');
  const big = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(5 * 1024 * 1024 + 10, 0x20)]);
  const tooBig = await uploadPdf(u.token, big);
  assert.strictEqual(tooBig.status, 413);
  assert.strictEqual(tooBig.body.code, 'FILE_TOO_LARGE');
  assert.strictEqual((await uploadPdf(u.token, Buffer.from(PDF_BODY), 'x.pdf', 'image')).body.code, 'BAD_FIELD');
  assert.strictEqual((await uploadPdf(null, Buffer.from(PDF_BODY))).status, 401);
  const json = await H.api('POST', '/api/services/documents', u.token, { dataUrl: 'data:application/pdf;base64,JVBERi0=' });
  assert.strictEqual(json.status, 400);

  const theirs = await uploadPdf(other.token, Buffer.from(PDF_BODY, 'latin1'));
  assert.strictEqual(theirs.status, 201);
  const stolen = await book(u, {
    serviceType: 'PRINTOUT', title: 'Document Printout (Colour)', documentId: theirs.body.document.id,
    specifications: { catalogueItemId: items['Document Printout (Colour)'].id, category: 'print' },
  });
  assert.strictEqual(stolen.status, 400);
  assert.strictEqual(stolen.body.code, 'BAD_DOCUMENT');

  const mine = await uploadPdf(u.token, Buffer.from(PDF_BODY, 'latin1'));
  const wrongService = await book(u, {
    serviceType: 'GENERAL', title: 'Doorstep Tech Diagnosis & Pickup', documentId: mine.body.document.id,
    specifications: { catalogueItemId: repairs['Doorstep Tech Diagnosis & Pickup'].id, category: 'repairs' },
  });
  assert.strictEqual(wrongService.status, 400);
});
