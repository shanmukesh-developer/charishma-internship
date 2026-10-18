// C7 (security P2): extra charges are capped, explained, and only count once the renter / borrower
// accepts them, the answer window passes, or an admin upholds / reduces them on a dispute.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers');

let owner; let renter; let admin; let L1000; let L10000; let L0;
test.before(async () => {
  await H.setup();
  owner = await H.mkUser({ name: 'Lender Lalitha' });
  renter = await H.mkUser({ name: 'Borrower Bhanu' });
  admin = await H.mkUser({ role: 'admin' });
  await H.mkLicence(renter);
  L1000 = await H.mkListing(owner, { plateType: 'PRIVATE', deposit: 1000 });
  L10000 = await H.mkListing(owner, { plateType: 'PRIVATE', deposit: 10000 });
  L0 = await H.mkListing(owner, { plateType: 'COMMERCIAL_RENTAL', deposit: 0 });
});
test.after(() => H.teardown());

const complete = (id, body, who = owner) => H.api('POST', `/api/rentals/bookings/${id}/complete`, who.token, body);
const respond = (id, body, who = renter) => H.api('POST', `/api/rentals/bookings/${id}/charges`, who.token, body);
const row = (id) => H.ctx.M('RentalBooking').findByPk(id);

test('cap = min(setting ₹5,000, 2 x deposit); no deposit -> setting; a note is required', async () => {
  const otherCap = H.r('modules/rentals/services/safety').otherChargesCapFor;
  assert.strictEqual(otherCap({ otherChargesCap: 5000 }, 1000), 2000);
  assert.strictEqual(otherCap({ otherChargesCap: 5000 }, 10000), 5000);
  assert.strictEqual(otherCap({ otherChargesCap: 5000 }, 0), 5000);

  const a = await H.toReturned(owner, renter, L1000);
  let r = await complete(a, { otherCharges: 2500, note: 'Broken mirror' });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.body.code, 'CHARGES_OVER_CAP');
  assert.strictEqual(r.body.cap, 2000);
  assert.match(r.body.message, /2 × the deposit/);
  r = await complete(a, { otherCharges: 100 });
  assert.strictEqual(r.body.code, 'NOTE_REQUIRED');
  r = await complete(a, { otherCharges: 50000, note: 'Whole new bike please' });
  assert.strictEqual(r.body.code, 'CHARGES_OVER_CAP', 'the old ₹50,000 hole is closed');

  const b = await H.toReturned(owner, renter, L10000);
  r = await complete(b, { otherCharges: 6000, note: 'Body panel' });
  assert.strictEqual(r.body.cap, 5000);
  await H.setSafety({ otherChargesCap: 3000 });
  r = await complete(b, { otherCharges: 3500, note: 'Body panel' });
  assert.strictEqual(r.body.cap, 3000);
  await H.setSafety({ otherChargesCap: 5000 });
  const v = await H.api('GET', `/api/rentals/bookings/${b}`, owner.token);
  assert.strictEqual(v.body.booking.otherChargesCap, 5000, 'owner app shows the cap');

  const c = await H.toReturned(owner, renter, L0);
  r = await complete(c, { otherCharges: 5001, note: 'Too much' });
  assert.strictEqual(r.body.cap, 5000);
  r = await complete(c, {});
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.booking.charges.status, 'NONE');
  assert.strictEqual(r.body.booking.finalAmount, r.body.booking.rentAmount);
});

test('extra km cannot exceed what the odometer readings show', async () => {
  const id = await H.toReturned(owner, renter, L10000, { pickupOdo: 1000, returnOdo: 1150 });
  const b = await row(id);
  const allowance = Number(b.kmAllowance) || 0;
  const maxExtra = Math.max(0, 150 - allowance);
  let r = await complete(id, { extraKm: maxExtra + 1, note: 'Extra km driven' });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.body.code, 'EXTRA_KM_TOO_HIGH');
  assert.strictEqual(r.body.maxExtraKm, maxExtra);
  r = await complete(id, { extraKm: maxExtra, note: 'Extra km driven' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.booking.charges.claimed, maxExtra * 5);
});

test('claim -> PENDING (not counted) -> renter ACCEPTS -> counted in finalAmount; both told', async () => {
  const id = await H.toReturned(owner, renter, L1000);
  const ev = await H.photos(owner, 2);
  const r = await complete(id, { extraKm: 10, otherCharges: 200, note: 'Fuel top-up and cleaning', photos: ev });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const bk = r.body.booking;
  assert.strictEqual(bk.status, 'COMPLETED');
  assert.strictEqual(bk.charges.status, 'PENDING');
  assert.strictEqual(bk.charges.claimed, 250);
  assert.strictEqual(bk.extraCharges, 0);
  assert.strictEqual(bk.finalAmount, bk.rentAmount, 'pending charges are not in the final amount');
  assert.strictEqual(bk.charges.photos.length, 2);
  const hrs = (new Date(bk.charges.respondBy).getTime() - Date.now()) / 3600000;
  assert.ok(hrs > 47.9 && hrs <= 48, `48 h window (${hrs})`);
  await H.settle();
  const p = H.ctx.pushes.find((x) => x.data && x.data.bookingId === id && x.title === 'Extra charges to review');
  assert.ok(p && p.recipients.includes(String(renter.id)));
  assert.match(p.body, /lender added ₹250/);
  const rv = await H.api('GET', `/api/rentals/bookings/${id}`, renter.token);
  assert.strictEqual(rv.body.booking.canRespondToCharges, true);
  const ov = await H.api('GET', `/api/rentals/bookings/${id}`, owner.token);
  assert.strictEqual(ov.body.booking.canRespondToCharges, false);

  let x = await respond(id, { action: 'ACCEPT' }, owner);
  assert.strictEqual(x.status, 403, 'the lender cannot answer their own claim');
  x = await respond(id, { action: 'MAYBE' });
  assert.strictEqual(x.status, 400);
  x = await respond(id, { action: 'ACCEPT' });
  assert.strictEqual(x.status, 200);
  assert.strictEqual(x.body.booking.charges.status, 'ACCEPTED');
  assert.strictEqual(x.body.booking.extraCharges, 250);
  assert.strictEqual(x.body.booking.finalAmount, bk.rentAmount + 250);
  x = await respond(id, { action: 'DISPUTE', note: 'Changed my mind about it' });
  assert.strictEqual(x.status, 409);
  assert.strictEqual(x.body.code, 'CHARGES_CLOSED');
  await H.settle();
  assert.ok(H.ctx.pushes.some((q) => q.data && q.data.bookingId === id && /accepted/.test(q.title) && q.recipients.includes(String(owner.id))));
});

test('dispute -> admin Disputes tab (both sides + photos) -> resolve (reduce / void / uphold), audited', async () => {
  const mk = async () => {
    const id = await H.toReturned(owner, renter, L1000);
    const r = await complete(id, { otherCharges: 600, note: 'Seat cover torn', photos: await H.photos(owner, 1) });
    assert.strictEqual(r.status, 200);
    return { id, rent: r.body.booking.rentAmount };
  };
  const a = await mk();
  let x = await respond(a.id, { action: 'DISPUTE', note: 'short' });
  assert.strictEqual(x.body.code, 'NOTE_REQUIRED');
  x = await respond(a.id, { action: 'DISPUTE', note: 'The seat cover was already torn: see my pickup photos', photos: await H.photos(renter, 2) });
  assert.strictEqual(x.status, 200, JSON.stringify(x.body));
  assert.strictEqual(x.body.booking.charges.status, 'DISPUTED');
  assert.strictEqual(x.body.booking.finalAmount, a.rent, 'disputed charges do not count');
  await H.settle();
  assert.ok(H.ctx.pushes.some((q) => q.data && q.data.bookingId === a.id && q.title === 'Extra charges disputed' && q.recipients.includes(String(owner.id))));
  assert.ok(H.ctx.pushes.some((q) => q.data && q.data.bookingId === a.id && q.title === 'Dispute received' && q.recipients.includes(String(renter.id))));
  await new Promise((res) => setTimeout(res, 600)); // admin room events are debounced (400 ms)
  assert.ok(H.ctx.emitted.some((e) => e.ev === 'admin:changed' && JSON.stringify(e.p).includes('rental_dispute')), 'admin room told');

  let s = await H.api('GET', '/api/admin/rentals/summary', admin.token);
  assert.strictEqual(s.body.openDisputes, 1);
  let d = await H.api('GET', '/api/admin/rentals/disputes', renter.token);
  assert.strictEqual(d.status, 403);
  d = await H.api('GET', '/api/admin/rentals/disputes', admin.token);
  assert.strictEqual(d.status, 200);
  const row1 = d.body.disputes.find((q) => q.id === a.id);
  assert.ok(row1);
  assert.strictEqual(row1.charges.note, 'Seat cover torn');
  assert.match(row1.charges.disputeNote, /already torn/);
  assert.strictEqual(row1.charges.photos.length, 1);
  assert.strictEqual(row1.charges.disputePhotos.length, 2);
  assert.ok(row1.charges.disputePhotos.every((p) => /sig=/.test(p)));
  assert.ok(row1.pickupCondition && row1.returnCondition, 'condition evidence alongside');
  assert.strictEqual(row1.rentalMode, 'BORROW');

  let res = await H.api('POST', `/api/admin/rentals/disputes/${a.id}/resolve`, admin.token, { outcome: 'REDUCE', amount: 250 });
  assert.strictEqual(res.body.code, 'REASON_REQUIRED');
  res = await H.api('POST', `/api/admin/rentals/disputes/${a.id}/resolve`, admin.token, { outcome: 'REDUCE', amount: 600, reason: 'Photos show partial wear' });
  assert.strictEqual(res.status, 400, 'reduce must be below the claim');
  res = await H.api('POST', `/api/admin/rentals/disputes/${a.id}/resolve`, admin.token, { outcome: 'HALVE', reason: 'Photos show partial wear' });
  assert.strictEqual(res.status, 400);
  res = await H.api('POST', `/api/admin/rentals/disputes/${a.id}/resolve`, renter.token, { outcome: 'VOID', reason: 'I say so' });
  assert.strictEqual(res.status, 403);
  res = await H.api('POST', `/api/admin/rentals/disputes/${a.id}/resolve`, admin.token, { outcome: 'REDUCE', amount: 250, reason: 'Photos show partial wear' });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.booking.charges.status, 'REDUCED');
  assert.strictEqual(res.body.booking.extraCharges, 250);
  assert.strictEqual(res.body.booking.finalAmount, a.rent + 250);
  assert.strictEqual(res.body.booking.charges.resolution.reason, 'Photos show partial wear');
  res = await H.api('POST', `/api/admin/rentals/disputes/${a.id}/resolve`, admin.token, { outcome: 'VOID', reason: 'Second try' });
  assert.strictEqual(res.status, 409, 'resolved once only');
  const audit = await H.ctx.M('VerificationLog').findOne({ where: { targetId: a.id, action: 'RENTAL_CHARGES_DISPUTE_RESOLVED' } });
  assert.ok(audit);
  assert.match(audit.details, /"outcome":"REDUCE"/);
  await H.settle();
  const both = H.ctx.pushes.filter((q) => q.data && q.data.bookingId === a.id && q.title === 'Extra charges dispute resolved');
  assert.ok(both.length && both[0].recipients.includes(String(owner.id)) && both[0].recipients.includes(String(renter.id)));
  assert.match(both[0].body, /reduced the charges to ₹250/);
  const rv = await H.api('GET', `/api/rentals/bookings/${a.id}`, renter.token);
  assert.strictEqual(rv.body.booking.charges.resolution.outcome, 'REDUCE');

  const b = await mk();
  await respond(b.id, { action: 'DISPUTE', note: 'Not my fault at all, it was like that' });
  res = await H.api('POST', `/api/admin/rentals/disputes/${b.id}/resolve`, admin.token, { outcome: 'VOID', reason: 'No evidence of new damage' });
  assert.strictEqual(res.body.booking.charges.status, 'VOIDED');
  assert.strictEqual(res.body.booking.finalAmount, b.rent);
  const c = await mk();
  await respond(c.id, { action: 'DISPUTE', note: 'Not my fault at all, it was like that' });
  res = await H.api('POST', `/api/admin/rentals/disputes/${c.id}/resolve`, admin.token, { outcome: 'UPHOLD', reason: 'Return photos show the tear' });
  assert.strictEqual(res.body.booking.charges.status, 'UPHELD');
  assert.strictEqual(res.body.booking.finalAmount, c.rent + 600);
  d = await H.api('GET', '/api/admin/rentals/disputes?status=RESOLVED', admin.token);
  assert.ok([a.id, b.id, c.id].every((id) => d.body.disputes.some((q) => q.id === id)));
  s = await H.api('GET', '/api/admin/rentals/summary', admin.token);
  assert.strictEqual(s.body.openDisputes, 0);
});

test('no answer within the window -> auto-accepted by the lifecycle job (and a late answer is refused)', async () => {
  const id = await H.toReturned(owner, renter, L1000);
  const r = await complete(id, { otherCharges: 300, note: 'Late return fee' });
  await H.ctx.M('RentalBooking').update({ chargesRespondBy: new Date(Date.now() - 60000) }, { where: { id } });
  const out = await H.r('modules/rentals/jobs').runRentalJobs();
  assert.ok(out.chargesAutoAccepted >= 1, JSON.stringify(out));
  const b = await row(id);
  assert.strictEqual(b.chargesStatus, 'AUTO_ACCEPTED');
  assert.strictEqual(Number(b.extraCharges), 300);
  assert.strictEqual(Number(b.finalAmount), r.body.booking.rentAmount + 300);
  const again = await H.r('modules/rentals/jobs').runRentalJobs();
  assert.strictEqual(again.chargesAutoAccepted, 0, 'once only');

  const id2 = await H.toReturned(owner, renter, L1000);
  await complete(id2, { otherCharges: 100, note: 'Fuel top-up' });
  await H.ctx.M('RentalBooking').update({ chargesRespondBy: new Date(Date.now() - 1000) }, { where: { id: id2 } });
  const late = await respond(id2, { action: 'DISPUTE', note: 'I filled the tank myself' });
  assert.strictEqual(late.status, 409);
  assert.strictEqual(late.body.code, 'CHARGES_CLOSED');
  assert.strictEqual((await row(id2)).chargesStatus, 'AUTO_ACCEPTED');
});

test('returned trip never closed by the lender auto-completes with no charges', async () => {
  const id = await H.toReturned(owner, renter, L1000);
  await H.ctx.M('RentalBooking').update({ returnedAt: new Date(Date.now() - 25 * 3600000) }, { where: { id } });
  await H.r('modules/rentals/jobs').runRentalJobs();
  const b = await row(id);
  assert.strictEqual(b.status, 'COMPLETED');
  assert.strictEqual(b.chargesStatus, 'NONE');
  assert.strictEqual(Number(b.finalAmount), Number(b.rentAmount));
});
