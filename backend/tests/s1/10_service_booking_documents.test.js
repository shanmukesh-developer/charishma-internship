// Service bookings, owner answers of 20 Oct: tailoring is priced per piece (like laundry), and print
// bookings can carry a PDF (utils/serviceDocuments): validated, stored privately as 'service_doc',
// downloadable only through GET /api/services/:id/document by the student, the assigned partner or an
// admin, never through the photo route and never attachable as a photo.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers');

test.before(() => H.setup());
test.after(() => H.teardown());

const specsOf = (row) => (typeof row.specifications === 'string' ? JSON.parse(row.specifications) : row.specifications || {});

const mkServiceStore = async (vendorType, items) => {
  const store = await H.mkStore();
  await store.update({ vendorType });
  const rows = {};
  for (const [name, price] of items) {
    rows[name] = await H.ctx.M.MenuItem.create({ restaurantId: store.id, name, price, isAvailable: true, specs: { bookingOnly: true } });
  }
  return rows;
};

const book = (user, body) => H.api('POST', '/api/services/book', user.token, {
  pickupSlot: 'Tomorrow, 10 AM',
  hostelBlock: 'Ganga',
  roomNumber: '412',
  contactPhone: '9876543210',
  paymentMethod: 'COD',
  ...body,
});

const PDF_BODY = '%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n';
const pdfDataUrl = (body = PDF_BODY) => `data:application/pdf;base64,${Buffer.from(body, 'latin1').toString('base64')}`;
const get = (url, token) => fetch(H.ctx.base + url, { headers: token ? { authorization: `Bearer ${token}` } : {} });

test('tailoring is priced per piece (quantity x card price, capped at 50), like laundry', async () => {
  const items = await mkServiceStore('TAILORING', [['Jeans & Trouser Length Alteration', 60], ['Doorstep Measurement & Pickup', 40]]);
  const u = await H.mkUser();
  const price = async (name, quantity) => {
    const r = await book(u, {
      serviceType: 'TAILORING',
      title: name,
      specifications: { catalogueItemId: items[name].id, category: 'tailoring', quantity, unit: 'pcs' },
    });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    return r.body.booking;
  };
  const three = await price('Jeans & Trouser Length Alteration', 3);
  assert.strictEqual(three.quotedAmount, 180);
  assert.strictEqual(specsOf(await H.ctx.M.ServiceBooking.findByPk(three.id)).quantity, 3);
  assert.strictEqual((await price('Jeans & Trouser Length Alteration', undefined)).quotedAmount, 60, 'no quantity = one piece');
  assert.strictEqual((await price('Jeans & Trouser Length Alteration', 999)).quotedAmount, 3000, 'capped at 50 pieces');
  assert.strictEqual((await price('Doorstep Measurement & Pickup', 1)).quotedAmount, 40);
});

test('print booking with a PDF: stored privately, downloadable only by the student, the partner and admins', async () => {
  const items = await mkServiceStore('PRINT', [['Document Printout (Black & White)', 2]]);
  const itemId = items['Document Printout (Black & White)'].id;
  const u = await H.mkUser();
  const other = await H.mkUser();
  const partner = await H.mkUser();
  const admin = await H.mkUser({ role: 'admin' });
  const spoofId = '00000000-0000-4000-8000-000000000000';
  const r = await book(u, {
    serviceType: 'PRINTOUT',
    title: 'Document Printout (Black & White)',
    attachmentDocument: { dataUrl: pdfDataUrl(), name: '../Thesis <final>.pdf' },
    specifications: {
      catalogueItemId: itemId, category: 'print', pageCount: '3', copies: '1', printColor: 'bw', bindingType: 'none',
      document: { mediaId: spoofId, name: 'spoofed.pdf' }, documentName: 'spoofed.pdf',
    },
  });
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  assert.strictEqual(r.body.booking.quotedAmount, 6);
  const row = await H.ctx.M.ServiceBooking.findByPk(r.body.booking.id);
  const spec = specsOf(row);
  assert.ok(spec.document && spec.document.mediaId !== spoofId, 'the client cannot point the booking at another media row');
  assert.strictEqual(spec.document.name, 'Thesis final.pdf');
  assert.strictEqual(spec.documentName, 'Thesis final.pdf');
  const media = await H.ctx.M.CampusMedia.findByPk(spec.document.mediaId);
  assert.strictEqual(media.purpose, 'service_doc');
  assert.strictEqual(media.mime, 'application/pdf');
  assert.strictEqual(media.isPrivate, true);
  assert.strictEqual(String(media.ownerId), String(u.id));

  const dl = await get(`/api/services/${row.id}/document`, u.token);
  assert.strictEqual(dl.status, 200);
  assert.strictEqual(dl.headers.get('content-type'), 'application/pdf');
  assert.strictEqual(dl.headers.get('content-disposition'), 'attachment; filename="Thesis final.pdf"');
  assert.strictEqual(dl.headers.get('x-content-type-options'), 'nosniff');
  assert.match(dl.headers.get('cache-control') || '', /no-store/);
  assert.strictEqual(Buffer.from(await dl.arrayBuffer()).toString('latin1'), PDF_BODY);

  assert.strictEqual((await get(`/api/services/${row.id}/document`, other.token)).status, 404, 'another student');
  assert.strictEqual((await get(`/api/services/${row.id}/document`, null)).status, 401, 'no session');
  assert.strictEqual((await get(`/api/services/${row.id}/document`, partner.token)).status, 404, 'a partner not assigned yet');
  await row.update({ assignedPartnerId: partner.id });
  assert.strictEqual((await get(`/api/services/${row.id}/document`, partner.token)).status, 200, 'the assigned partner');
  assert.strictEqual((await get(`/api/services/${row.id}/document`, admin.token)).status, 200, 'admin');

  // Never through the photo route, never attachable as a photo
  assert.strictEqual((await get(`/api/campus/media/${media.id}`, u.token)).status, 404);
  assert.strictEqual((await get(`/api/campus/media/${media.id}`, admin.token)).status, 404);
  assert.strictEqual(await H.r('utils/mediaAccess').mayAttach(`/api/campus/media/${media.id}`, u.id), false);

  // A booking without a file answers 404
  const plain = await book(u, { serviceType: 'PRINTOUT', title: 'Document Printout (Black & White)', specifications: { catalogueItemId: itemId, category: 'print' } });
  assert.strictEqual(plain.status, 201, JSON.stringify(plain.body));
  assert.strictEqual((await get(`/api/services/${plain.body.booking.id}/document`, u.token)).status, 404);
});

test('PDF upload validation: not a PDF, wrong type, bad base64, wrong service, too large', async () => {
  const prints = await mkServiceStore('PRINT', [['Document Printout (Black & White)', 2]]);
  const repairs = await mkServiceStore('REPAIRS', [['Doorstep Tech Diagnosis & Pickup', 99]]);
  const u = await H.mkUser();
  const printBooking = (attachmentDocument) => book(u, {
    serviceType: 'PRINTOUT',
    title: 'Document Printout (Black & White)',
    attachmentDocument,
    specifications: { catalogueItemId: prints['Document Printout (Black & White)'].id, category: 'print' },
  });
  const before = await H.ctx.M.ServiceBooking.count();

  const notPdf = await printBooking({ dataUrl: `data:application/pdf;base64,${Buffer.from('<html><script>alert(1)</script></html>').toString('base64')}`, name: 'x.pdf' });
  assert.strictEqual(notPdf.status, 400);
  assert.strictEqual(notPdf.body.code, 'BAD_DOCUMENT');
  const htmlType = await printBooking({ dataUrl: `data:text/html;base64,${Buffer.from('%PDF-1.4').toString('base64')}`, name: 'x.pdf' });
  assert.strictEqual(htmlType.status, 400);
  const badB64 = await printBooking({ dataUrl: 'data:application/pdf;base64,%%%not-base64%%%', name: 'x.pdf' });
  assert.strictEqual(badB64.status, 400);
  const asString = await printBooking(pdfDataUrl());
  assert.strictEqual(asString.status, 400, 'must be an object { dataUrl, name }');
  const wrongService = await book(u, {
    serviceType: 'GENERAL',
    title: 'Doorstep Tech Diagnosis & Pickup',
    attachmentDocument: { dataUrl: pdfDataUrl(), name: 'x.pdf' },
    specifications: { catalogueItemId: repairs['Doorstep Tech Diagnosis & Pickup'].id, category: 'repairs' },
  });
  assert.strictEqual(wrongService.status, 400);
  assert.match(wrongService.body.message, /print bookings only/);
  assert.strictEqual(await H.ctx.M.ServiceBooking.count(), before, 'no booking is created when the file is refused');

  // Size cap, checked directly (the test app's JSON body limit is 1 MB)
  const docs = H.r('utils/serviceDocuments');
  const big = await docs.storeServiceDocument({ dataUrl: pdfDataUrl(`%PDF-1.4\n${'x'.repeat(docs.MAX_PDF_BYTES)}`), name: 'big.pdf' }, { ownerId: u.id });
  assert.strictEqual(big.ok, false);
  assert.strictEqual(big.status, 413);
  assert.strictEqual(docs.cleanPdfName('C:\\Users\\me\\notes'), 'notes.pdf');
  assert.strictEqual(docs.cleanPdfName(''), 'Document.pdf');
  assert.strictEqual(docs.cleanPdfName('a"b.PDF'), 'ab.pdf');
});
