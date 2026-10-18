// C8 RECEIPT_SETTINGS: admin card validation + audit + conflict, generic config write refused, and the
// optional "hide stores without FSSAI" switch (default off) on listings and new orders.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers');

let admin; let cust;
test.before(async () => {
  await H.setup();
  admin = await H.mkUser({ role: 'admin' });
  cust = await H.mkUser();
});
test.after(H.teardown);

test('defaults: inclusive, no GSTIN, hide switch off; non-admins refused', async () => {
  await H.resetSettings();
  const res = await H.api('GET', '/api/admin/receipt-settings', admin.token);
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body.settings, { platformGstin: '', taxDisplayMode: 'inclusive', gstRatePercent: null, footerNote: '', hideStoresWithoutFssai: false });
  assert.strictEqual(res.body.breakdownAllowed, false);
  assert.strictEqual((await H.api('GET', '/api/admin/receipt-settings', cust.token)).status, 403);
  assert.strictEqual((await H.api('PUT', '/api/admin/receipt-settings', cust.token, { footerNote: 'x' })).status, 403);
});

test('validation, audit, no-op and conflict', async () => {
  await H.resetSettings();
  for (const body of [{ platformGstin: 'BAD' }, { gstRatePercent: 0 }, { gstRatePercent: 40 }, { gstRatePercent: 5.555 }, { footerNote: '<script>' }, { hideStoresWithoutFssai: 'yes' }, { taxDisplayMode: 'exclusive' }, { surprise: 1 }]) {
    const res = await H.api('PUT', '/api/admin/receipt-settings', admin.token, body);
    assert.strictEqual(res.status, 400, JSON.stringify(body));
  }
  const ok = await H.api('PUT', '/api/admin/receipt-settings', admin.token, { platformGstin: '37abcde1234f1z5', gstRatePercent: '5' });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
  assert.strictEqual(ok.body.settings.platformGstin, '37ABCDE1234F1Z5');
  assert.strictEqual(ok.body.settings.gstRatePercent, 5);
  assert.strictEqual(ok.body.effectiveTaxDisplayMode, 'inclusive', 'setting a GSTIN alone does not switch the mode');
  const logs = await H.auditRows('RECEIPT_SETTINGS_UPDATED');
  assert.strictEqual(logs.length, 1);
  assert.deepStrictEqual(JSON.parse(logs[0].details).changes.platformGstin, ['', '37ABCDE1234F1Z5']);
  const same = await H.api('PUT', '/api/admin/receipt-settings', admin.token, { gstRatePercent: 5 });
  assert.strictEqual(same.body.changed, false);
  assert.strictEqual((await H.auditRows('RECEIPT_SETTINGS_UPDATED')).length, 1);
  const stale = await H.api('PUT', '/api/admin/receipt-settings', admin.token, { footerNote: 'x', ifUpdatedAt: '2001-01-01T00:00:00.000Z' });
  assert.strictEqual(stale.status, 409);
  assert.strictEqual(stale.body.code, 'CONFIG_CONFLICT');
  // Breakdown on, then clearing the rate is refused while breakdown is on.
  assert.strictEqual((await H.api('PUT', '/api/admin/receipt-settings', admin.token, { taxDisplayMode: 'breakdown' })).status, 200);
  assert.strictEqual((await H.api('PUT', '/api/admin/receipt-settings', admin.token, { gstRatePercent: null })).status, 400);
  // The generic config writer cannot bypass validation.
  const gen = await H.api('POST', '/api/admin/config', admin.token, { key: 'RECEIPT_SETTINGS', value: { taxDisplayMode: 'breakdown' } });
  assert.strictEqual(gen.status, 400);
  await H.resetSettings();
});

test('unit: a junk stored value parses to safe defaults; breakdown without GSTIN falls back to inclusive', () => {
  const rs = H.r('utils/receiptSettings');
  assert.deepStrictEqual(rs.parse('not json'), rs.defaults());
  const p = rs.parse({ taxDisplayMode: 'breakdown', gstRatePercent: 5 });
  assert.strictEqual(p.taxDisplayMode, 'inclusive');
  assert.strictEqual(rs.effectiveMode({ taxDisplayMode: 'breakdown', platformGstin: '', gstRatePercent: 5 }), 'inclusive');
});

test('hide stores without FSSAI: default off lists them; on hides them from listings and refuses new orders', async () => {
  await H.resetSettings();
  const { store: bare, item: bareItem } = await H.mkStore();
  const { store: lic, item: licItem } = await H.mkStore({ extra: { fssaiLicenseNumber: H.fakeFssai() } });
  const { store: groc } = await H.mkStore({ vendorType: 'GROCERY' });
  H.r('controllers/adminController').clearRestaurantsCache();
  const ids = async () => {
    const a = await H.api('GET', '/api/restaurants');
    const b = await H.api('GET', '/api/users/restaurants');
    const c = await H.api('GET', '/api/catalogue/stores?type=grocery');
    return { home: a.body.map((s) => s.id), list: b.body.map((s) => s.id), catalogue: c.body.map((s) => s.id) };
  };
  let seen = await ids();
  assert.ok(seen.home.includes(bare.id) && seen.home.includes(lic.id));
  assert.ok(seen.list.includes(bare.id));
  assert.ok(seen.catalogue.includes(groc.id));
  assert.strictEqual((await H.api('POST', '/api/orders/quote', cust.token, { items: [{ menuItemId: bareItem.id, quantity: 1 }] })).status, 200);

  const on = await H.api('PUT', '/api/admin/receipt-settings', admin.token, { hideStoresWithoutFssai: true });
  assert.strictEqual(on.status, 200);
  seen = await ids();
  assert.ok(!seen.home.includes(bare.id), 'hidden from home');
  assert.ok(seen.home.includes(lic.id), 'licensed store still listed');
  assert.ok(!seen.list.includes(bare.id));
  assert.ok(!seen.catalogue.includes(groc.id));
  const q = await H.api('POST', '/api/orders/quote', cust.token, { items: [{ menuItemId: bareItem.id, quantity: 1 }] });
  assert.strictEqual(q.status, 400);
  assert.strictEqual(q.body.code, 'ITEMS_UNAVAILABLE');
  const ok = await H.api('POST', '/api/orders/quote', cust.token, { items: [{ menuItemId: licItem.id, quantity: 1 }] });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
  assert.strictEqual(ok.body.store.fssaiLicenseNumber, lic.fssaiLicenseNumber);

  await H.api('PUT', '/api/admin/receipt-settings', admin.token, { hideStoresWithoutFssai: false });
  seen = await ids();
  assert.ok(seen.home.includes(bare.id), 'switching off lists it again');
  await H.resetSettings();
});
