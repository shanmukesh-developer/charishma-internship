// C7: pickup / return condition photos + odometer, required before the PIN steps (admin switch, default ON).
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers');

let owner; let renter; let stranger; let admin; let listing;
test.before(async () => {
  await H.setup();
  owner = await H.mkUser({ name: 'Owner Omkar' });
  renter = await H.mkUser({ name: 'Renter Rani' });
  stranger = await H.mkUser({ name: 'Stranger Sam' });
  admin = await H.mkUser({ role: 'admin' });
  await H.mkLicence(renter);
  listing = await H.mkListing(owner, { plateType: 'COMMERCIAL_RENTAL' });
});
test.after(() => H.teardown());

test('handover is refused until the owner records 2-6 pickup photos + odometer (no PIN attempt used)', async () => {
  const id = await H.confirmed(owner, renter, listing);
  await H.makeDue(id);
  const pins = await H.pinsOf(id);
  let r = await H.api('POST', `/api/rentals/bookings/${id}/handover`, owner.token, { pin: pins.pickupPin });
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.body.code, 'CONDITION_REQUIRED');
  assert.strictEqual(r.body.stage, 'PICKUP');
  assert.strictEqual(Number((await H.ctx.M('RentalBooking').findByPk(id)).pinAttempts) || 0, 0);

  // validation
  r = await H.condition(owner, id, 'PICKUP', { n: 1 });
  assert.strictEqual(r.status, 400, 'one photo is not enough');
  r = await H.condition(owner, id, 'PICKUP', { n: 7 });
  assert.strictEqual(r.status, 400, 'seven photos are too many');
  r = await H.condition(owner, id, 'PICKUP', { odometer: null });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.body.field, 'odometer');
  r = await H.api('POST', `/api/rentals/bookings/${id}/condition`, owner.token, { stage: 'MIDWAY', photos: await H.photos(owner, 2), odometer: 5 });
  assert.strictEqual(r.status, 400);
  r = await H.api('POST', `/api/rentals/bookings/${id}/condition`, owner.token, { stage: 'PICKUP', photos: await H.photos(renter, 2), odometer: 5 });
  assert.strictEqual(r.body.code, 'INVALID_MEDIA', "another student's photos are refused");
  r = await H.api('POST', `/api/rentals/bookings/${id}/condition`, owner.token, { stage: 'PICKUP', photos: await H.photos(owner, 2, 'rental_photo'), odometer: 5 });
  assert.strictEqual(r.body.code, 'INVALID_MEDIA', 'public listing photos are not condition photos');
  r = await H.condition(stranger, id, 'PICKUP');
  assert.strictEqual(r.status, 404, 'stranger cannot touch the booking');
  r = await H.condition(owner, id, 'RETURN');
  assert.strictEqual(r.status, 409, 'return photos only once the vehicle is out');

  r = await H.condition(owner, id, 'PICKUP', { n: 3, odometer: 12000, note: 'Small scratch on the left mirror' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.booking.pickupCondition.owner.photos.length, 3);
  assert.strictEqual(r.body.booking.pickupCondition.owner.odometer, 12000);
  // renter's own (optional) record, odometer optional
  r = await H.condition(renter, id, 'PICKUP', { n: 2, odometer: null, note: 'Tyre looks worn' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.booking.pickupCondition.renter.photos.length, 2);
  assert.strictEqual(r.body.booking.pickupCondition.renter.odometer, null);
  assert.strictEqual(r.body.booking.pickupCondition.owner.odometer, 12000, 'owner record kept');

  // both parties see both records as signed (private) links
  for (const u of [owner, renter]) {
    const v = await H.api('GET', `/api/rentals/bookings/${id}`, u.token);
    const pc = v.body.booking.pickupCondition;
    assert.ok(pc.owner.photos.every((p) => /sig=/.test(p)), 'signed owner photos');
    assert.ok(pc.renter.photos.every((p) => /sig=/.test(p)), 'signed renter photos');
    assert.strictEqual(v.body.booking.conditionPhotosRequired, true);
  }
  // stored as private media paths only
  const row = await H.ctx.M('RentalBooking').findByPk(id);
  const stored = H.r('modules/rentals/services/serialize').jsonOf(row.pickupCondition);
  assert.ok(stored.OWNER.photos.every((p) => /^\/api\/campus\/media\/[0-9a-f-]{36}$/.test(p)));

  r = await H.api('POST', `/api/rentals/bookings/${id}/handover`, owner.token, { pin: pins.pickupPin });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  r = await H.condition(owner, id, 'PICKUP');
  assert.strictEqual(r.status, 409, 'owner pickup record locks after handover');

  // return
  r = await H.api('POST', `/api/rentals/bookings/${id}/return`, owner.token, { pin: pins.returnPin });
  assert.strictEqual(r.body.code, 'CONDITION_REQUIRED');
  assert.strictEqual(r.body.stage, 'RETURN');
  r = await H.condition(owner, id, 'RETURN', { odometer: 11999 });
  assert.strictEqual(r.body.code, 'ODOMETER_BACKWARDS');
  r = await H.condition(owner, id, 'RETURN', { odometer: 12080 });
  assert.strictEqual(r.status, 200);
  r = await H.api('POST', `/api/rentals/bookings/${id}/return`, owner.token, { pin: pins.returnPin });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.booking.status, 'RETURNED');
  r = await H.condition(renter, id, 'RETURN', { n: 2, odometer: null });
  assert.strictEqual(r.status, 200, 'renter can still add return photos while RETURNED');

  // admin sees both stages
  const a = await H.api('GET', '/api/admin/rentals/bookings?status=RETURNED', admin.token);
  const ab = a.body.bookings.find((b) => b.id === id);
  assert.strictEqual(ab.pickupCondition.owner.odometer, 12000);
  assert.strictEqual(ab.returnCondition.owner.odometer, 12080);
  assert.ok(ab.returnCondition.renter.photos.length === 2 && ab.returnCondition.renter.photos.every((p) => /sig=/.test(p)));
});

test('admin switch off -> PIN steps work without photos; back on -> required again', async () => {
  await H.setSafety({ conditionPhotosRequired: false });
  const id = await H.confirmed(owner, renter, listing);
  await H.makeDue(id);
  const pins = await H.pinsOf(id);
  let r = await H.api('POST', `/api/rentals/bookings/${id}/handover`, owner.token, { pin: pins.pickupPin });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.booking.conditionPhotosRequired, false);
  r = await H.api('POST', `/api/rentals/bookings/${id}/return`, owner.token, { pin: pins.returnPin });
  assert.strictEqual(r.status, 200);
  await H.setSafety({ conditionPhotosRequired: true });
  const id2 = await H.confirmed(owner, renter, listing);
  await H.makeDue(id2);
  const p2 = await H.pinsOf(id2);
  r = await H.api('POST', `/api/rentals/bookings/${id2}/handover`, owner.token, { pin: p2.pickupPin });
  assert.strictEqual(r.body.code, 'CONDITION_REQUIRED');
});

test('admin settings API: read defaults, validate, audit', async () => {
  let r = await H.api('GET', '/api/admin/rentals/settings', admin.token);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.safety.conditionPhotosRequired, true);
  assert.strictEqual(r.body.safety.otherChargesCap, 5000);
  assert.strictEqual(r.body.safety.chargesResponseHours, 48);
  assert.match(r.body.defaultDisclaimer, /not an insurer/);
  r = await H.api('PUT', '/api/admin/rentals/settings', owner.token, { safety: { conditionPhotosRequired: false } });
  assert.strictEqual(r.status, 403);
  r = await H.api('PUT', '/api/admin/rentals/settings', admin.token, { safety: { otherChargesCap: -1 } });
  assert.strictEqual(r.status, 400);
  r = await H.api('PUT', '/api/admin/rentals/settings', admin.token, { safety: { chargesResponseHours: 2.5 } });
  assert.strictEqual(r.status, 400);
  r = await H.api('PUT', '/api/admin/rentals/settings', admin.token, { safety: { conditionPhotosRequired: 'no' } });
  assert.strictEqual(r.status, 400);
  r = await H.api('PUT', '/api/admin/rentals/settings', admin.token, {});
  assert.strictEqual(r.status, 400);
  r = await H.api('PUT', '/api/admin/rentals/settings', admin.token, { safety: { disclaimer: 'Custom <b>note</b>: drive safe.' } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.safety.disclaimer, 'Custom bnote/b: drive safe.');
  assert.strictEqual(r.body.enabled, true);
  const d = await H.api('GET', `/api/rentals/listings/${listing.id}`, renter.token);
  assert.strictEqual(d.body.safety.disclaimer, 'Custom bnote/b: drive safe.');
  r = await H.api('PUT', '/api/admin/rentals/settings', admin.token, { safety: { disclaimer: '' } });
  assert.match(r.body.safety.disclaimer, /^$/);
  const audits = await H.ctx.M('VerificationLog').count({ where: { action: 'RENTALS_SAFETY_SETTINGS_UPDATED' } });
  assert.ok(audits >= 2);
  // legacy body still toggles the feature
  r = await H.api('PUT', '/api/admin/rentals/settings', admin.token, { enabled: false });
  assert.strictEqual(r.body.enabled, false);
  r = await H.api('PUT', '/api/admin/rentals/settings', admin.token, { enabled: true });
  assert.strictEqual(r.body.enabled, true);
});
