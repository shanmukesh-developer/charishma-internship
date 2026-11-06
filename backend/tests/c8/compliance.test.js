// C8 store compliance: field validation (FSSAI 14 digits, GSTIN / PAN / UPI / IFSC formats, full bank account
// number never stored), owner vs admin rights, audited admin edits, FSSAI verification, private fields never
// in public reads, FSSAI status badges.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers');

let admin; let other;
test.before(async () => {
  await H.setup();
  admin = await H.mkUser({ role: 'admin' });
  other = await H.mkUser();
});
test.after(H.teardown);

const comp = () => H.r('utils/storeCompliance');

test('unit: FSSAI number must be exactly 14 digits; spaces / dashes are tolerated', () => {
  const { normalizeField, ComplianceInputError } = comp();
  assert.strictEqual(normalizeField('fssaiLicenseNumber', '1000 0000 0000 01'), '10000000000001');
  assert.strictEqual(normalizeField('fssaiLicenseNumber', '10000-000000001'), '10000000000001');
  for (const bad of ['1234567890123', '123456789012345', '1000000000000A', 'abcdefghijklmn', '12345678901234.5']) {
    assert.throws(() => normalizeField('fssaiLicenseNumber', bad), ComplianceInputError, bad);
  }
  assert.strictEqual(normalizeField('fssaiLicenseNumber', ''), null);
  assert.strictEqual(normalizeField('fssaiLicenseNumber', null), null);
});

test('unit: GSTIN / PAN / UPI / IFSC / licence type / expiry formats', () => {
  const { normalizeField, ComplianceInputError } = comp();
  assert.strictEqual(normalizeField('gstin', '37abcde1234f1z5'), '37ABCDE1234F1Z5');
  for (const bad of ['37ABCDE1234F1Z', '37ABCDE1234F1X5', 'AAABCDE1234F1Z5', '37ABCDE1234F0Z5', '37ABCDE1234F1Z5X']) {
    assert.throws(() => normalizeField('gstin', bad), ComplianceInputError, bad);
  }
  assert.strictEqual(normalizeField('pan', 'abcde1234f'), 'ABCDE1234F');
  assert.throws(() => normalizeField('pan', 'ABCD1234F'), ComplianceInputError);
  assert.strictEqual(normalizeField('payoutUpiId', 'Kitchen.Owner@okaxis'), 'kitchen.owner@okaxis');
  assert.throws(() => normalizeField('payoutUpiId', 'no-at-sign'), ComplianceInputError);
  assert.strictEqual(normalizeField('bankIfsc', 'sbin0001234'), 'SBIN0001234');
  assert.throws(() => normalizeField('bankIfsc', 'SBIN1001234'), ComplianceInputError);
  assert.strictEqual(normalizeField('fssaiLicenseType', 'state'), 'STATE');
  assert.throws(() => normalizeField('fssaiLicenseType', 'NATIONAL'), ComplianceInputError);
  assert.strictEqual(normalizeField('fssaiExpiry', '2030-02-28'), '2030-02-28');
  assert.throws(() => normalizeField('fssaiExpiry', '2030-02-30'), ComplianceInputError);
  assert.throws(() => normalizeField('legalName', '<b>x</b>'), ComplianceInputError);
});

test('unit: a full bank account number (typed twice) is stored encrypted + last 4 digits; PAN "" means unchanged', () => {
  // Owner decision 6 Nov 2026: stores are paid by bank transfer too, so the full number is kept ENCRYPTED
  // (utils/payoutSecrets). It was previously reduced to its last 4 digits.
  const { validateCompliance } = comp();
  const { patch } = validateCompliance({ bankAccountNumber: '1234 5678 9012 3456', bankAccountNumberConfirm: '1234567890123456' }, {}, { actor: 'admin' });
  assert.strictEqual(patch.bankAccountLast4, '3456');
  assert.ok(!('bankAccountNumber' in patch));
  assert.ok(/^pd1:/.test(patch.bankAccountNumberEnc) && !patch.bankAccountNumberEnc.includes('1234567890123456'));
  assert.strictEqual(H.r('utils/payoutSecrets').decryptAccount(patch.bankAccountNumberEnc), '1234567890123456');
  const { patch: p2 } = validateCompliance({ pan: '' }, { pan: 'ABCDE1234F' }, { actor: 'admin' });
  assert.deepStrictEqual(p2, {});
  const { patch: p3 } = validateCompliance({ pan: null }, { pan: 'ABCDE1234F' }, { actor: 'admin' });
  assert.deepStrictEqual(p3, { pan: null });
});

test('owner submits FSSAI number / type / expiry + GSTIN; status PENDING; public store read shows the number only', async () => {
  const { store } = await H.mkStore();
  const num = H.fakeFssai();
  const res = await H.api('PUT', `/api/restaurants/${store.id}/compliance`, store.token, { fssaiLicenseNumber: num, fssaiLicenseType: 'basic', fssaiExpiry: '2031-03-31', legalName: 'C8 Foods Pvt Ltd', gstin: '37ABCDE1234F1Z5' });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.compliance.fssaiLicenseNumber, num);
  assert.strictEqual(res.body.compliance.fssaiLicenseType, 'BASIC');
  assert.strictEqual(res.body.compliance.fssaiStatus, 'PENDING');
  assert.ok(res.body.compliance.fssaiSubmittedAt);
  const logs = await H.auditRows('STORE_COMPLIANCE_SUBMITTED', store.id);
  assert.strictEqual(logs.length, 1);
  assert.strictEqual(logs[0].adminId, `store:${store.id}`);

  const get = await H.api('GET', `/api/restaurants/${store.id}/compliance`, store.token);
  assert.strictEqual(get.status, 200);
  assert.strictEqual(get.body.compliance.gstin, '37ABCDE1234F1Z5');

  const pub = await H.api('GET', `/api/users/restaurants/${store.id}`);
  assert.strictEqual(pub.status, 200);
  assert.strictEqual(pub.body.fssaiLicenseNumber, num);
});

test('owner input errors: 400 with the field; PAN / payout fields are admin-only (403); unknown keys 400', async () => {
  const { store } = await H.mkStore();
  let res = await H.api('PUT', `/api/restaurants/${store.id}/compliance`, store.token, { fssaiLicenseNumber: '12345' });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.code, 'INVALID_COMPLIANCE');
  assert.strictEqual(res.body.field, 'fssaiLicenseNumber');
  res = await H.api('PUT', `/api/restaurants/${store.id}/compliance`, store.token, { gstin: 'NOTAGSTIN' });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.field, 'gstin');
  res = await H.api('PUT', `/api/restaurants/${store.id}/compliance`, store.token, { fssaiExpiry: '2031-01-01' });
  assert.strictEqual(res.status, 400, 'expiry without a number');
  for (const body of [{ pan: 'ABCDE1234F' }, { payoutUpiId: 'thief@okaxis' }, { bankAccountNumber: '123456789012' }, { bankIfsc: 'SBIN0001234' }]) {
    res = await H.api('PUT', `/api/restaurants/${store.id}/compliance`, store.token, body);
    assert.strictEqual(res.status, 403, JSON.stringify(body));
    assert.strictEqual(res.body.code, 'ADMIN_ONLY_FIELD');
  }
  res = await H.api('PUT', `/api/restaurants/${store.id}/compliance`, store.token, { isActive: false });
  assert.strictEqual(res.status, 400);
  const row = await H.ctx.M('Restaurant').findByPk(store.id);
  assert.strictEqual(row.pan, null);
  assert.strictEqual(row.payoutUpiId, null);
  assert.strictEqual(row.isActive, true);
});

test('another store and a customer cannot read or write a store\'s compliance', async () => {
  const { store } = await H.mkStore();
  const { store: store2 } = await H.mkStore();
  assert.strictEqual((await H.api('GET', `/api/restaurants/${store.id}/compliance`, store2.token)).status, 403);
  assert.strictEqual((await H.api('PUT', `/api/restaurants/${store.id}/compliance`, store2.token, { legalName: 'Hijack' })).status, 403);
  assert.strictEqual((await H.api('GET', `/api/restaurants/${store.id}/compliance`, other.token)).status, 403);
  assert.strictEqual((await H.api('PUT', `/api/admin/restaurants/${store.id}/compliance`, store.token, { legalName: 'x' })).status, 403);
});

test('admin edit: every field, validated, audited with PAN / UPI masked; PAN never returned in full', async () => {
  const { store } = await H.mkStore();
  const num = H.fakeFssai();
  const res = await H.api('PUT', `/api/admin/restaurants/${store.id}/compliance`, admin.token, {
    legalName: 'C8 Admin Foods LLP', fssaiLicenseNumber: num, fssaiLicenseType: 'STATE', fssaiExpiry: '2030-12-31', gstin: '37ABCDE1234F1Z5',
    pan: 'PQRST6789K', payoutUpiId: 'c8kitchen@okaxis', bankAccountHolder: 'C8 Admin Foods', bankAccountNumber: '000123456789', bankAccountNumberConfirm: '000123456789', bankIfsc: 'SBIN0001234',
  });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.compliance.panMasked, 'XXXXXX789K');
  assert.strictEqual(res.body.compliance.bankAccountLast4, '6789');
  assert.ok(!JSON.stringify(res.body).includes('PQRST6789K'), 'full PAN never in a response: ' + JSON.stringify(res.body));
  assert.ok(!JSON.stringify(res.body).includes('000123456789'), 'full account number never in a response');
  const row = await H.ctx.M('Restaurant').findByPk(store.id, { raw: true });
  assert.strictEqual(row.pan, 'PQRST6789K');
  assert.strictEqual(row.bankAccountLast4, '6789');
  assert.ok(!Object.values(row).some((v) => String(v).includes('000123456789')), 'full account number never stored in clear');
  assert.ok(/^pd1:/.test(row.bankAccountNumberEnc), 'stored encrypted');

  const logs = await H.auditRows('STORE_COMPLIANCE_UPDATED', store.id);
  assert.strictEqual(logs.length, 1);
  assert.strictEqual(logs[0].adminId, String(admin.id));
  const d = JSON.parse(logs[0].details);
  assert.deepStrictEqual(d.changes.fssaiLicenseNumber, [null, num]);
  assert.deepStrictEqual(d.changes.pan, [null, 'XXXXXX789K']);
  assert.ok(!logs[0].details.includes('PQRST6789K'));
  assert.ok(!logs[0].details.includes('c8kitchen@okaxis'));

  // Admin list: PAN masked, compliance badge data present.
  const list = await H.api('GET', '/api/admin/restaurants', admin.token);
  const mine = list.body.find((s) => s.id === store.id);
  assert.strictEqual(mine.pan, undefined);
  assert.strictEqual(mine.panMasked, 'XXXXXX789K');
  assert.strictEqual(mine.compliance.fssaiStatus, 'PENDING');

  // Invalid admin input -> 400 with the field, nothing written, no audit row.
  const bad = await H.api('PUT', `/api/admin/restaurants/${store.id}/compliance`, admin.token, { bankIfsc: 'XX' });
  assert.strictEqual(bad.status, 400);
  assert.strictEqual(bad.body.field, 'bankIfsc');
  assert.strictEqual((await H.auditRows('STORE_COMPLIANCE_UPDATED', store.id)).length, 1);
  // No-op write -> no audit row.
  const same = await H.api('PUT', `/api/admin/restaurants/${store.id}/compliance`, admin.token, { legalName: 'C8 Admin Foods LLP', pan: '' });
  assert.strictEqual(same.body.changed, false);
  assert.strictEqual((await H.auditRows('STORE_COMPLIANCE_UPDATED', store.id)).length, 1);
});

test('admin store form (POST /api/admin/restaurants/:id) validates + audits compliance keys too; create too', async () => {
  const { store } = await H.mkStore();
  const bad = await H.api('POST', `/api/admin/restaurants/${store.id}`, admin.token, { fssaiLicenseNumber: '999' });
  assert.strictEqual(bad.status, 400);
  assert.strictEqual(bad.body.field, 'fssaiLicenseNumber');
  const num = H.fakeFssai();
  const ok = await H.api('POST', `/api/admin/restaurants/${store.id}`, admin.token, { fssaiLicenseNumber: num, deliveryTime: 25 });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
  assert.strictEqual(ok.body.fssaiLicenseNumber, num);
  assert.strictEqual((await H.auditRows('STORE_COMPLIANCE_UPDATED', store.id)).length, 1);

  const created = await H.api('POST', '/api/admin/restaurants', admin.token, { name: `C8 New Stall ${Date.now()}`, location: 'Gate 2', vendorType: 'RESTAURANT', fssaiLicenseNumber: H.fakeFssai(), gstin: '37abcde1234f1z5' });
  assert.strictEqual(created.status, 201, JSON.stringify(created.body));
  assert.strictEqual(created.body.gstin, '37ABCDE1234F1Z5');
  assert.strictEqual((await H.auditRows('STORE_COMPLIANCE_UPDATED', created.body.id)).length, 1);

  // A duplicate store never copies licence / tax / payout details.
  await H.api('PUT', `/api/admin/restaurants/${store.id}/compliance`, admin.token, { payoutUpiId: 'orig@okaxis' });
  const dup = await H.api('POST', `/api/admin/restaurants/${store.id}/duplicate`, admin.token, { name: `C8 Copy ${Date.now()}` });
  assert.strictEqual(dup.status, 201, JSON.stringify(dup.body));
  const copy = await H.ctx.M('Restaurant').findByPk(dup.body.id, { raw: true });
  assert.strictEqual(copy.fssaiLicenseNumber, null);
  assert.strictEqual(copy.payoutUpiId, null);
});

test('FSSAI verification: missing / expired refused; verify + revoke audited; a licence change clears it', async () => {
  const { store } = await H.mkStore();
  let res = await H.api('POST', `/api/admin/restaurants/${store.id}/fssai-verification`, admin.token, { verified: true });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.code, 'FSSAI_MISSING');
  await H.api('PUT', `/api/admin/restaurants/${store.id}/compliance`, admin.token, { fssaiLicenseNumber: H.fakeFssai(), fssaiExpiry: '2021-01-01' });
  res = await H.api('POST', `/api/admin/restaurants/${store.id}/fssai-verification`, admin.token, { verified: true });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.code, 'FSSAI_EXPIRED');
  await H.api('PUT', `/api/admin/restaurants/${store.id}/compliance`, admin.token, { fssaiExpiry: '2032-06-30' });
  res = await H.api('POST', `/api/admin/restaurants/${store.id}/fssai-verification`, admin.token, { verified: true });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.compliance.fssaiStatus, 'VERIFIED');
  assert.strictEqual(res.body.compliance.fssaiVerifiedBy, String(admin.id));
  assert.strictEqual((await H.auditRows('FSSAI_VERIFIED', store.id)).length, 1);
  // Not by a store.
  assert.strictEqual((await H.api('POST', `/api/admin/restaurants/${store.id}/fssai-verification`, store.token, { verified: true })).status, 403);
  // Owner changes the expiry -> back to PENDING.
  res = await H.api('PUT', `/api/restaurants/${store.id}/compliance`, store.token, { fssaiExpiry: '2033-06-30' });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.compliance.fssaiStatus, 'PENDING');
  assert.strictEqual(res.body.compliance.fssaiVerifiedAt, null);
  await H.api('POST', `/api/admin/restaurants/${store.id}/fssai-verification`, admin.token, { verified: true });
  res = await H.api('POST', `/api/admin/restaurants/${store.id}/fssai-verification`, admin.token, { verified: false });
  assert.strictEqual(res.body.compliance.fssaiStatus, 'PENDING');
  assert.strictEqual((await H.auditRows('FSSAI_VERIFICATION_REVOKED', store.id)).length, 1);
});

test('unit: FSSAI status MISSING / EXPIRED / PENDING / VERIFIED + expiring soon', () => {
  const { fssaiStatus } = comp();
  const now = new Date('2026-10-18T06:00:00Z');
  assert.strictEqual(fssaiStatus({}, now).status, 'MISSING');
  assert.strictEqual(fssaiStatus({ fssaiLicenseNumber: '10000000000001', fssaiExpiry: '2026-10-17' }, now).status, 'EXPIRED');
  assert.strictEqual(fssaiStatus({ fssaiLicenseNumber: '10000000000001', fssaiExpiry: '2026-10-18' }, now).status, 'PENDING');
  assert.strictEqual(fssaiStatus({ fssaiLicenseNumber: '10000000000001', fssaiExpiry: '2026-11-01' }, now).expiringSoon, true);
  assert.strictEqual(fssaiStatus({ fssaiLicenseNumber: '10000000000001', fssaiExpiry: '2027-11-01', fssaiVerifiedAt: now }, now).status, 'VERIFIED');
  assert.strictEqual(fssaiStatus({ fssaiLicenseNumber: '10000000000001', fssaiExpiry: '2027-11-01' }, now).expiringSoon, false);
});

test('private fields never appear in public store reads (list, single store, catalogue, local vendors)', async () => {
  const { store } = await H.mkStore({ vendorType: 'GROCERY' });
  await H.api('PUT', `/api/admin/restaurants/${store.id}/compliance`, admin.token, { pan: 'ZZZZZ9999Z', payoutUpiId: 'secretpayout@okaxis', bankAccountHolder: 'Secret Holder', bankAccountLast4: '4321', bankIfsc: 'HDFC0001234', fssaiLicenseNumber: H.fakeFssai() });
  await H.api('POST', `/api/admin/restaurants/${store.id}/fssai-verification`, admin.token, { verified: true });
  H.r('controllers/adminController').clearRestaurantsCache();
  const reads = [
    await H.api('GET', '/api/restaurants?includeStores=true'),
    await H.api('GET', `/api/users/restaurants/${store.id}`),
    await H.api('GET', '/api/catalogue/stores?type=grocery'),
    await H.api('GET', '/api/users/restaurants?includeStores=true'),
  ];
  for (const r of reads) {
    assert.strictEqual(r.status, 200);
    const s = JSON.stringify(r.body);
    for (const secret of ['ZZZZZ9999Z', 'secretpayout', 'Secret Holder', 'HDFC0001234', String(admin.id)]) assert.ok(!s.includes(secret), `public read leaked ${secret}`);
  }
  const cat = reads[2].body.find((s) => s.id === store.id);
  assert.ok(cat && /^\d{14}$/.test(cat.fssaiLicenseNumber));
});
