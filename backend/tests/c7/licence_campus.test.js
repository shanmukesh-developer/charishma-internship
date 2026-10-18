// C7: licence number unique across accounts + expiry required / enforced; listing detail + quote are
// campus-scoped (security P2).
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers');

let owner; let renter; let other; let farOwner; let farStudent; let listing; let farListing;
test.before(async () => {
  await H.setup();
  owner = await H.mkUser({ name: 'Owner Uma' });
  renter = await H.mkUser({ name: 'Renter Raju' });
  other = await H.mkUser({ name: 'Other Ojas' });
  farOwner = await H.mkUser({ name: 'Far Owner', campus: H.ctx.campus2 });
  farStudent = await H.mkUser({ name: 'Far Student', campus: H.ctx.campus2 });
  listing = await H.mkListing(owner);
  farListing = await H.mkListing(farOwner, { campus: H.ctx.campus2 });
});
test.after(() => H.teardown());

const putLicence = async (u, body) => H.api('PUT', '/api/rentals/licence', u.token, { classes: ['MCWG'], frontImage: await H.media(u, 'rental_licence'), ...body });
const ymd = (days) => new Date(Date.now() + 330 * 60000 + days * 86400000).toISOString().slice(0, 10);

test('licence expiry date is required and must be in the future', async () => {
  let r = await putLicence(renter, { licenceNumber: 'AP07 2019 0012345' });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.body.field, 'expiresOn');
  r = await putLicence(renter, { licenceNumber: 'AP0720190012345', expiresOn: ymd(-1) });
  assert.strictEqual(r.body.code, 'LICENCE_EXPIRED');
  r = await putLicence(renter, { licenceNumber: 'AP0720190012345', expiresOn: 'soon' });
  assert.strictEqual(r.status, 400);
  r = await putLicence(renter, { licenceNumber: 'AP07 2019 0012345', expiresOn: '2034-05-31' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.licence.expiresOn, '2034-05-31');
});

test('one licence number per account (normalised), re-saving your own is fine', async () => {
  let r = await putLicence(other, { licenceNumber: 'ap07-2019-0012345', expiresOn: '2033-01-01' });
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.body.code, 'LICENCE_IN_USE');
  r = await putLicence(renter, { licenceNumber: 'AP0720190012345', expiresOn: '2034-06-30' });
  assert.strictEqual(r.status, 200, 'same account may update');
  r = await putLicence(other, { licenceNumber: 'AP0720190099999', expiresOn: '2033-01-01' });
  assert.strictEqual(r.status, 200);
  // and the other account cannot switch to the taken number later either
  r = await putLicence(other, { licenceNumber: 'AP 07 2019 0012345', expiresOn: '2033-01-01' });
  assert.strictEqual(r.body.code, 'LICENCE_IN_USE');
  // the database index is the race guard
  await assert.rejects(H.ctx.M('RentalLicence').create({ userId: owner.id, licenceNumber: 'AP0720190012345', classes: ['MCWG'], status: 'PENDING' }));
});

test('expired / legacy-without-expiry licences block new bookings with a clear message', async () => {
  const lic = await H.ctx.M('RentalLicence').findOne({ where: { userId: renter.id } });
  await lic.update({ status: 'VERIFIED', verifiedClasses: ['MCWG'], expiresOn: ymd(-2) });
  let r = await H.requestBooking(renter, listing);
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.body.code, 'LICENCE_EXPIRED');
  assert.match(r.body.message, /expired on \d{4}-\d{2}-\d{2}.*renewed licence/);
  await lic.update({ expiresOn: ymd(1) });
  r = await H.api('POST', '/api/rentals/bookings', renter.token, { listingId: listing.id, startAt: H.istAt(5, 10), endAt: H.istAt(5, 14), acceptTerms: true });
  assert.strictEqual(r.body.code, 'LICENCE_EXPIRED');
  assert.match(r.body.message, /before this trip ends/);
  await lic.update({ expiresOn: null });
  r = await H.requestBooking(renter, listing);
  assert.strictEqual(r.status, 428);
  assert.strictEqual(r.body.code, 'LICENCE_EXPIRY_REQUIRED');
  await lic.update({ expiresOn: '2034-06-30' });
  r = await H.requestBooking(renter, listing);
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
});

test('listing detail + quote are limited to the viewer campus (404, no probing)', async () => {
  const q = `?startAt=${encodeURIComponent(H.istAt(6, 10))}&endAt=${encodeURIComponent(H.istAt(6, 14))}`;
  let r = await H.api('GET', `/api/rentals/listings/${farListing.id}`, renter.token);
  assert.strictEqual(r.status, 404);
  r = await H.api('GET', `/api/rentals/listings/${farListing.id}/quote${q}`, renter.token);
  assert.strictEqual(r.status, 404);
  r = await H.api('GET', `/api/rentals/listings/${farListing.id}`, farStudent.token);
  assert.strictEqual(r.status, 200, 'same campus sees it');
  r = await H.api('GET', `/api/rentals/listings/${farListing.id}/quote${q}`, farStudent.token);
  assert.strictEqual(r.status, 200);
  r = await H.api('GET', `/api/rentals/listings/${farListing.id}`, farOwner.token);
  assert.strictEqual(r.status, 200, 'owner always sees own listing');
  r = await H.api('GET', `/api/rentals/listings/${listing.id}`, farStudent.token);
  assert.strictEqual(r.status, 404, 'and the other way round');
  r = await H.api('GET', '/api/rentals/listings', renter.token);
  assert.ok(!r.body.listings.some((l) => l.id === farListing.id), 'browse was already scoped');
  r = await H.api('POST', '/api/rentals/bookings', renter.token, { listingId: farListing.id, startAt: H.istAt(7, 10), endAt: H.istAt(7, 14), acceptTerms: true });
  assert.strictEqual(r.body.code, 'CAMPUS_MISMATCH');
});
