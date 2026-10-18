// C7: Rent / Borrow wording derived from the plate type, and per-booking terms acceptance.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers');

let owner; let renter; let stranger; let borrowL; let rentL;
test.before(async () => {
  await H.setup();
  owner = await H.mkUser({ name: 'Lender Lakshmi' });
  renter = await H.mkUser({ name: 'Borrower Bala' });
  stranger = await H.mkUser({ name: 'Other Student' });
  await H.mkLicence(renter);
  borrowL = await H.mkListing(owner, { plateType: 'PRIVATE' });
  rentL = await H.mkListing(owner, { plateType: 'COMMERCIAL_RENTAL' });
});
test.after(() => H.teardown());

test('rentalMode(): commercial plate -> RENT, private / unknown -> BORROW; words per mode', () => {
  const E = H.r('modules/rentals/enums');
  assert.strictEqual(E.rentalMode('COMMERCIAL_RENTAL'), 'RENT');
  assert.strictEqual(E.rentalMode('PRIVATE'), 'BORROW');
  assert.strictEqual(E.rentalMode(null), 'BORROW');
  assert.strictEqual(E.rentalMode('commercial_rental'), 'RENT');
  assert.deepStrictEqual([E.wordsFor('RENT').giver, E.wordsFor('RENT').taker], ['owner', 'renter']);
  assert.deepStrictEqual([E.wordsFor('BORROW').giver, E.wordsFor('BORROW').taker, E.wordsFor('BORROW').verb], ['lender', 'borrower', 'Borrow']);
  assert.strictEqual(E.wordsFor(undefined).verb, 'Borrow');
});

test('listings expose rentalMode (badge) but never the plate type itself', async () => {
  const br = await H.api('GET', '/api/rentals/listings', renter.token);
  assert.strictEqual(br.status, 200);
  const b = br.body.listings.find((l) => l.id === borrowL.id);
  const r = br.body.listings.find((l) => l.id === rentL.id);
  assert.strictEqual(b.rentalMode, 'BORROW');
  assert.strictEqual(r.rentalMode, 'RENT');
  assert.ok(!('plateType' in b) && !('registrationNumber' in b));
  const mine = await H.api('GET', '/api/rentals/my/listings', owner.token);
  assert.ok(mine.body.listings.every((l) => ['RENT', 'BORROW'].includes(l.rentalMode)));
});

test('listing detail carries mode-specific terms + the insurance disclaimer', async () => {
  const d = await H.api('GET', `/api/rentals/listings/${borrowL.id}`, renter.token);
  assert.strictEqual(d.status, 200);
  const s = d.body.safety;
  assert.strictEqual(s.rentalMode, 'BORROW');
  assert.strictEqual(s.termsVersion, H.r('modules/rentals/enums').TERMS_VERSION);
  const t = s.terms.join(' ');
  assert.match(t, /lender's personal/);
  assert.match(t, /damage, fuel, traffic fines \(challans\)/);
  assert.match(t, /No commercial use/);
  assert.match(t, /valid driving licence/);
  assert.match(s.disclaimer, /not an insurer/);
  assert.strictEqual(s.conditionPhotosRequired, true);
  const d2 = await H.api('GET', `/api/rentals/listings/${rentL.id}`, renter.token);
  const t2 = d2.body.safety.terms.join(' ');
  assert.strictEqual(d2.body.safety.rentalMode, 'RENT');
  assert.match(t2, /commercial/);
  assert.match(t2, /rental permit, valid insurance/);
  assert.doesNotMatch(t2, /lender/);
});

test('booking needs acceptTerms; stores termsAcceptedAt + version + mode snapshot; wording in pushes', async () => {
  H.resetLimits();
  const w = H.nextWindow();
  let res = await H.api('POST', '/api/rentals/bookings', renter.token, { listingId: borrowL.id, ...w, acceptTerms: false });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.code, 'TERMS_REQUIRED');
  res = await H.api('POST', '/api/rentals/bookings', renter.token, { listingId: borrowL.id, ...w, acceptTerms: 'yes' });
  assert.strictEqual(res.body.code, 'TERMS_REQUIRED');
  res = await H.api('POST', '/api/rentals/bookings', renter.token, { listingId: borrowL.id, ...w, acceptTerms: true });
  assert.strictEqual(res.status, 201, JSON.stringify(res.body));
  const bk = res.body.booking;
  assert.strictEqual(bk.rentalMode, 'BORROW');
  assert.strictEqual(bk.termsPending, false);
  assert.ok(bk.termsAcceptedAt);
  assert.strictEqual(bk.termsVersion, H.r('modules/rentals/enums').TERMS_VERSION);
  const row = await H.ctx.M('RentalBooking').findByPk(bk.id);
  assert.strictEqual(row.rentalMode, 'BORROW');
  await H.settle();
  const p = H.ctx.pushes.find((x) => x.data && x.data.bookingId === bk.id && x.data.type === 'RENTAL_REQUEST');
  assert.ok(p, 'owner pushed');
  assert.match(p.title, /New borrow request/);
  assert.match(p.body, /wants to borrow/);

  const r2 = await H.requestBooking(renter, rentL);
  assert.strictEqual(r2.status, 201);
  assert.strictEqual(r2.body.booking.rentalMode, 'RENT');
  await H.settle();
  const p2 = H.ctx.pushes.find((x) => x.data && x.data.bookingId === r2.body.booking.id && x.data.type === 'RENTAL_REQUEST');
  assert.match(p2.title, /New rental request/);
  assert.match(p2.body, /wants to rent/);
  // Declining a Borrow request uses the lender wording.
  const dec = await H.api('POST', `/api/rentals/bookings/${bk.id}/decline`, owner.token, { reason: 'Need it' });
  assert.strictEqual(dec.status, 200);
  await H.settle();
  const p3 = H.ctx.pushes.find((x) => x.data && x.data.bookingId === bk.id && x.data.type === 'RENTAL_DECLINED');
  assert.match(p3.title, /Borrow request declined/);
  assert.match(p3.body, /lender could not lend/);
});

test('older app (no acceptTerms field) -> booking kept with termsPending; handover waits until accepted', async () => {
  H.resetLimits();
  const w = H.nextWindow();
  const res = await H.api('POST', '/api/rentals/bookings', renter.token, { listingId: borrowL.id, ...w });
  assert.strictEqual(res.status, 201);
  const id = res.body.booking.id;
  assert.strictEqual(res.body.booking.termsPending, true);
  assert.strictEqual(res.body.booking.termsAcceptedAt, null);
  const acc = await H.api('POST', `/api/rentals/bookings/${id}/accept`, owner.token);
  assert.strictEqual(acc.status, 200);
  await H.settle();
  const p = H.ctx.pushes.find((x) => x.data && x.data.bookingId === id && x.data.type === 'RENTAL_ACCEPTED');
  assert.match(p.title, /Borrowing confirmed/);
  assert.match(p.body, /accept the terms before pickup/);
  await H.makeDue(id);
  assert.strictEqual((await H.condition(owner, id, 'PICKUP')).status, 200);
  const pins = await H.pinsOf(id);
  let h = await H.api('POST', `/api/rentals/bookings/${id}/handover`, owner.token, { pin: pins.pickupPin });
  assert.strictEqual(h.status, 409);
  assert.strictEqual(h.body.code, 'TERMS_PENDING');
  assert.match(h.body.message, /borrower has not accepted/);
  const row = await H.ctx.M('RentalBooking').findByPk(id);
  assert.strictEqual(Number(row.pinAttempts) || 0, 0, 'gate does not use a PIN attempt');
  // Only the borrower can accept, and only with acceptTerms: true.
  let t = await H.api('POST', `/api/rentals/bookings/${id}/terms`, owner.token, { acceptTerms: true });
  assert.strictEqual(t.status, 403);
  t = await H.api('POST', `/api/rentals/bookings/${id}/terms`, stranger.token, { acceptTerms: true });
  assert.strictEqual(t.status, 404);
  t = await H.api('POST', `/api/rentals/bookings/${id}/terms`, renter.token, {});
  assert.strictEqual(t.body.code, 'TERMS_REQUIRED');
  t = await H.api('POST', `/api/rentals/bookings/${id}/terms`, renter.token, { acceptTerms: true });
  assert.strictEqual(t.status, 200);
  assert.strictEqual(t.body.booking.termsPending, false);
  assert.ok(t.body.booking.termsAcceptedAt);
  t = await H.api('POST', `/api/rentals/bookings/${id}/terms`, renter.token, { acceptTerms: true });
  assert.strictEqual(t.status, 200, 'idempotent');
  h = await H.api('POST', `/api/rentals/bookings/${id}/handover`, owner.token, { pin: pins.pickupPin });
  assert.strictEqual(h.status, 200, JSON.stringify(h.body));
  assert.strictEqual(h.body.booking.status, 'ACTIVE');
});

test('admin bookings show the mode; /legal/terms describes Rent vs Borrow + the new safeguards', async () => {
  const admin = await H.mkUser({ role: 'admin' });
  const a = await H.api('GET', '/api/admin/rentals/bookings', admin.token);
  assert.strictEqual(a.status, 200);
  assert.ok(a.body.bookings.length >= 3);
  assert.ok(a.body.bookings.every((b) => ['RENT', 'BORROW'].includes(b.rentalMode)));
  const facts = await H.r('utils/legalFacts').gather();
  assert.strictEqual(facts.rentals.otherChargesCap, 5000);
  assert.strictEqual(facts.rentals.chargesResponseHours, 48);
  const { renderers } = H.r('routes/legalRoutes');
  const terms = renderers.TERMS(facts);
  for (const s of ['commercial rental number plate', 'private number plate', 'borrowed', '<b>lender</b>', '<b>borrower</b>', '<b>renter</b>',
    'accept that booking', 'challans', 'rental permit and insurance', 'odometer', '₹5,000 per trip', 'within 48 hours', 'uphold, reduce or cancel', 'expiry date', 'does not provide any insurance']) {
    assert.ok(terms.includes(s), `terms: ${s}`);
  }
  const refunds = renderers.REFUNDS(facts);
  assert.ok(refunds.includes('accepts them in the app, or does not answer within 48 hours'));
  assert.ok(refunds.includes('never holds this money'));
  const privacy = renderers.PRIVACY(facts);
  assert.ok(privacy.includes('Pickup and return condition photos, odometer readings'));
  assert.ok(privacy.includes('when you accepted the booking terms'));
  // Admin settings flow into the pages.
  await H.setSafety({ otherChargesCap: 3000, chargesResponseHours: 24 });
  const t2 = renderers.TERMS(await H.r('utils/legalFacts').gather());
  assert.ok(t2.includes('₹3,000 per trip') && t2.includes('within 24 hours'));
  await H.setSafety({ otherChargesCap: 5000, chargesResponseHours: 48 });
});
