// Store payment details (owner decision, 6 Nov 2026): UPI ID + bank account (holder, number typed twice, IFSC, bank
// name, branch). Validated; the account number is stored encrypted and shown only masked (••••1234) except the
// audited admin reveal; audit rows mask old / new values; never in public / customer payloads; the Revenue report,
// settle preview and pending statements carry the masked details; Mark paid is refused for a store ZenWe must pay
// when it has neither a UPI ID nor a bank account.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('../c6/helpers');

const { api } = H;
const DAY = 24 * 60 * 60 * 1000;
const FULL = '501234567890123';
let admin;
before(async () => {
  await H.setup();
  admin = await H.mkUser({ role: 'admin' });
});
after(H.teardown);

const put = (id, body, token = admin.token) => api('PUT', `/api/admin/restaurants/${id}/compliance`, token, body);
const audits = (action, targetId) => H.ctx.M('VerificationLog').findAll({ where: { action, targetId: String(targetId) }, raw: true });

test('validation: IFSC, 9-18 digits, typed twice and matching, UPI like name@bank, bank name / branch', async () => {
  const comp = H.r('utils/storeCompliance');
  const bad = [
    [{ bankIfsc: 'SBIN1001234' }, 'bankIfsc'],
    [{ bankIfsc: 'SBI0001234' }, 'bankIfsc'],
    [{ bankAccountNumber: '12345678', bankAccountNumberConfirm: '12345678' }, 'bankAccountNumber'], // 8 digits
    [{ bankAccountNumber: '1234567890123456789', bankAccountNumberConfirm: '1234567890123456789' }, 'bankAccountNumber'], // 19
    [{ bankAccountNumber: FULL }, 'bankAccountNumberConfirm'], // not typed twice
    [{ bankAccountNumber: FULL, bankAccountNumberConfirm: '501234567890124' }, 'bankAccountNumberConfirm'], // mismatch
    [{ payoutUpiId: 'not-an-upi' }, 'payoutUpiId'],
    [{ bankName: 'X' }, 'bankName'],
  ];
  for (const [body, field] of bad) {
    assert.throws(() => comp.validateCompliance(body, {}, { actor: 'admin' }), (e) => e instanceof comp.ComplianceInputError && e.field === field, JSON.stringify(body));
  }
  const { patch } = comp.validateCompliance({ bankAccountNumber: '50 1234 5678 90123', bankAccountNumberConfirm: FULL, bankIfsc: 'hdfc0001234', bankName: 'HDFC  Bank', bankBranch: 'Mangalagiri', payoutUpiId: 'Store@OKAXIS' }, {}, { actor: 'admin' });
  assert.equal(patch.bankAccountLast4, '0123');
  assert.equal(patch.bankIfsc, 'HDFC0001234');
  assert.equal(patch.bankName, 'HDFC Bank');
  assert.equal(patch.payoutUpiId, 'store@okaxis');
  // A store login can never set payment details.
  const { store } = await H.mkStore();
  const r = await api('PUT', `/api/restaurants/${store.id}/compliance`, store.token, { bankAccountNumber: FULL, bankAccountNumberConfirm: FULL });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'ADMIN_ONLY_FIELD');
  // Over HTTP: a mismatch is a 400 naming the confirm field.
  const m = await put(store.id, { bankAccountNumber: FULL, bankAccountNumberConfirm: '999999999' });
  assert.equal(m.status, 400);
  assert.equal(m.body.field, 'bankAccountNumberConfirm');
});

test('saved encrypted, read masked, audited masked; reveal is admin-only and audited; same number again is a no-op', async () => {
  const { store } = await H.mkStore();
  const r = await put(store.id, { payoutUpiId: 'kitchen@okhdfc', bankAccountHolder: 'Kitchen Foods', bankAccountNumber: FULL, bankAccountNumberConfirm: FULL, bankIfsc: 'HDFC0001234', bankName: 'HDFC Bank', bankBranch: 'Guntur' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.compliance.bankAccountMasked, '••••0123');
  assert.equal(r.body.compliance.bankName, 'HDFC Bank');
  assert.ok(!JSON.stringify(r.body).includes(FULL));
  const row = await H.ctx.M('Restaurant').findByPk(store.id, { raw: true });
  assert.ok(/^pd1:/.test(row.bankAccountNumberEnc));
  assert.ok(!Object.values(row).some((v) => String(v).includes(FULL)), 'never stored in clear');

  const logs = await audits('STORE_COMPLIANCE_UPDATED', store.id);
  assert.equal(logs.length, 1);
  const text = logs[0].details;
  assert.ok(!text.includes(FULL) && !text.includes('pd1:'), text);
  const d = JSON.parse(text);
  assert.deepEqual(d.changes.bankAccountNumber, [null, '••••0123']);
  assert.deepEqual(d.changes.bankAccountLast4, [null, '••••0123']);
  assert.deepEqual(d.changes.payoutUpiId, [null, 'ki*****@okhdfc']);

  // Change the number: old and new both masked.
  const NEW = '987654321098';
  await put(store.id, { bankAccountNumber: NEW, bankAccountNumberConfirm: NEW });
  const d2 = JSON.parse((await audits('STORE_COMPLIANCE_UPDATED', store.id))[1].details);
  assert.deepEqual(d2.changes.bankAccountNumber, ['••••0123', '••••1098']);
  // Same number again: nothing changes, no audit row.
  const same = await put(store.id, { bankAccountNumber: NEW, bankAccountNumberConfirm: NEW });
  assert.equal(same.body.changed, false);
  assert.equal((await audits('STORE_COMPLIANCE_UPDATED', store.id)).length, 2);

  // Admin store read (Stores page) never carries the encrypted value.
  const list = await api('GET', `/api/admin/restaurants/${store.id}`, admin.token);
  if (list.status === 200) assert.ok(!JSON.stringify(list.body).includes('pd1:') && !JSON.stringify(list.body).includes(NEW));

  // Masked payment details; reveal only for admins, audited.
  const masked = await api('GET', `/api/admin/revenue/stores/${store.id}/payment-details`, admin.token);
  assert.equal(masked.status, 200);
  assert.equal(masked.body.bankAccountMasked, '••••1098');
  assert.equal(masked.body.bankAccountNumber, undefined);
  assert.equal(masked.body.canPay, true);
  assert.equal((await audits('STORE_BANK_DETAILS_REVEALED', store.id)).length, 0);
  const shown = await api('GET', `/api/admin/revenue/stores/${store.id}/payment-details?reveal=1`, admin.token);
  assert.equal(shown.body.bankAccountNumber, NEW);
  const rev = await audits('STORE_BANK_DETAILS_REVEALED', store.id);
  assert.equal(rev.length, 1);
  assert.ok(!rev[0].details.includes(NEW));
  const u = await H.mkUser();
  assert.equal((await api('GET', `/api/admin/revenue/stores/${store.id}/payment-details?reveal=1`, u.token)).status, 403);

  // Remove the account on file: the encrypted number goes too.
  await put(store.id, { bankAccountLast4: null });
  const after = await H.ctx.M('Restaurant').findByPk(store.id, { raw: true });
  assert.equal(after.bankAccountNumberEnc, null);
  assert.equal(after.bankAccountLast4, null);
});

test('never in public / customer payloads', async () => {
  const { store } = await H.mkStore({ vendorType: 'GROCERY' });
  await put(store.id, { payoutUpiId: 'secretpay@okaxis', bankAccountHolder: 'Secret Holder Name', bankAccountNumber: FULL, bankAccountNumberConfirm: FULL, bankIfsc: 'ICIC0004321', bankName: 'Secret Bank Ltd', bankBranch: 'Hidden Branch' });
  H.r('controllers/adminController').clearRestaurantsCache();
  const u = await H.mkUser();
  const reads = [
    await api('GET', '/api/restaurants?includeStores=true'),
    await api('GET', `/api/users/restaurants/${store.id}`),
    await api('GET', '/api/catalogue/stores?type=grocery'),
    await api('GET', '/api/users/restaurants?includeStores=true', u.token),
  ];
  for (const r of reads) {
    if (r.status === 404) continue; // route not mounted in this harness
    assert.equal(r.status, 200);
    const s = JSON.stringify(r.body);
    for (const secret of [FULL, '0123', 'pd1:', 'secretpay', 'Secret Holder', 'ICIC0004321', 'Secret Bank', 'Hidden Branch', 'bankAccountNumberEnc']) {
      if (secret === '0123') continue; // too short to search for safely in arbitrary payloads
      assert.ok(!s.includes(secret), `public read leaked ${secret}`);
    }
  }
  const pub = H.r('utils/publicFields');
  for (const f of ['bankAccountNumberEnc', 'bankName', 'bankBranch', 'payoutUpiId', 'bankAccountHolder', 'bankAccountLast4', 'bankIfsc']) assert.ok(pub.STORE_SECRET_FIELDS.includes(f), f);
});

test('report / preview / pending carry masked details; Mark paid refused with no UPI and no bank', async () => {
  const usr = await H.mkUser();
  const old = new Date(Date.now() - 3 * DAY);
  const { snapshotFields } = H.r('utils/commission');
  const mk = (store, total) => H.ctx.M('Order').create({
    userId: usr.id, restaurantId: store.id, items: [], totalPrice: total, deliveryFee: 19, platformFee: 4, finalPrice: total + 23,
    priceBreakdown: { subtotal: total, deliveryFee: 19, platformFee: 4, packagingFee: 0, taxes: 0, discounts: [], totalDiscount: 0, finalPrice: total + 23 },
    paymentMethod: 'COD', paymentStatus: 'Completed', status: 'Delivered', deliveredAt: old, fulfilment: 'ZENVY', ...snapshotFields(store, total),
  });
  const { store: Bank } = await H.mkStore({ rate: 10 });
  const { store: None } = await H.mkStore({ rate: 10 });
  await Bank.update({ settlementCycle: '3days' });
  await None.update({ settlementCycle: '3days' });
  await put(Bank.id, { bankAccountHolder: 'Bank Only', bankAccountNumber: FULL, bankAccountNumberConfirm: FULL, bankIfsc: 'SBIN0009999', bankName: 'SBI' });
  await mk(Bank, 300);
  await mk(None, 400);
  // Every-3-days cutoff = end of the last complete block: put the orders 40 days back so they are before it.
  await H.ctx.M('Order').update({ deliveredAt: new Date(Date.now() - 40 * DAY) }, { where: { restaurantId: [Bank.id, None.id] } });

  const ymd = new Date(Date.now() - 40 * DAY + 330 * 60000).toISOString().slice(0, 10);
  const rep = await api('GET', `/api/admin/revenue?period=day&date=${ymd}`, admin.token);
  const rowB = rep.body.stores.find((s) => s.storeId === Bank.id);
  const rowN = rep.body.stores.find((s) => s.storeId === None.id);
  assert.equal(rowB.payment.bankAccountMasked, '••••0123');
  assert.equal(rowB.payment.hasBank, true);
  assert.equal(rowB.payment.canPay, true);
  assert.equal(rowN.payment.canPay, false);
  assert.ok(!JSON.stringify(rep.body).includes(FULL) && !JSON.stringify(rep.body).includes('pd1:'));

  const p = await api('GET', '/api/admin/revenue/settle/preview?cycle=3days', admin.token);
  assert.equal(p.body.stores.find((s) => s.storeId === Bank.id).payment.bankName, 'SBI');
  assert.equal(p.body.stores.find((s) => s.storeId === None.id).payment.canPay, false);
  const expected = p.body.stores.filter((s) => [Bank.id, None.id].includes(s.storeId)).map((s) => ({ storeId: s.storeId, orderCount: s.orderCount, netPaise: s.netPaise }));
  const made = await api('POST', '/api/admin/revenue/settle', admin.token, { cycle: '3days', cutoff: p.body.cutoff, expected });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const p2 = await api('GET', '/api/admin/revenue/settle/preview?cycle=3days', admin.token);
  const stB = p2.body.pendingStatements.find((x) => x.partnerId === Bank.id);
  const stN = p2.body.pendingStatements.find((x) => x.partnerId === None.id);
  assert.equal(stB.payment.bankAccountMasked, '••••0123');
  assert.equal(stN.payment.canPay, false);
  assert.ok(!JSON.stringify(p2.body).includes(FULL));

  const mp = await api('POST', '/api/admin/revenue/settle/mark-paid', admin.token, { items: [{ payoutId: stN.id, utr: 'UTR123456', method: 'upi' }, { payoutId: stB.id, utr: 'NEFT998877', method: 'bank' }] });
  assert.equal(mp.status, 200, JSON.stringify(mp.body));
  assert.equal(mp.body.failed.length, 1);
  assert.equal(mp.body.failed[0].code, 'NO_PAYMENT_DETAILS');
  assert.equal(mp.body.paid.length, 1);
  assert.equal(mp.body.paid[0].method, 'bank');
  assert.equal((await H.ctx.M('Payout').findByPk(stN.id)).status, 'PENDING');
});
