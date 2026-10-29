// Admin product editor rules (29 Oct 2026 data-entry audit) through the real admin routes:
//  - a product needs a price above ₹0 (service stores may keep ₹0: priced after a quote);
//  - a product sold in the admin's own weights takes its price from them (a bare price edit is refused);
//  - specs.autoWeights false (automatic weights removed) is stored, and null clears it;
//  - an emptied delivery zone goes back to the default zone;
//  - a stall without a login phone signs in with its WhatsApp number, so that number cannot answer for another store.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const T = require('./helpers');

const { H } = T;
let admin;
before(async () => { await T.setup(); admin = await H.mkUser({ role: 'admin' }); });
after(T.teardown);

const save = (id, body) => H.api('POST', `/api/admin/menu-items/${id}`, admin.token, body);
const specsOf = async (id) => {
  const row = await H.ctx.M('MenuItem').findByPk(id);
  return typeof row.specs === 'string' ? JSON.parse(row.specs) : (row.specs || {});
};

test('a ₹0 product is refused, except in a service store', async () => {
  const { store } = await T.mkStore({ store: { vendorType: 'GROCERY' } });
  let r = await save('new', { restaurantId: store.id, name: 'Free sugar', price: 0 });
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.match(r.body.message, /above ₹0/);
  const repairs = await T.mkStore({ store: { vendorType: 'REPAIRS' } });
  r = await save('new', { restaurantId: repairs.store.id, name: 'Laptop check-up', price: 0 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  // bulk create follows the same rule
  r = await H.api('POST', '/api/admin/menu-items/bulk', admin.token, { restaurantId: store.id, items: [{ name: 'Rice 1 kg', price: 60 }, { name: 'Salt', price: 0 }] });
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.equal(r.body.errors[0].index, 1);
});

test("a product in its own weights takes its price from them: a bare price edit is refused", async () => {
  const options = [{ name: 'Weight', type: 'variant', choices: [{ label: '250 g', price: 120 }, { label: '1 kg', price: 450 }] }];
  const { store, item } = await T.mkStore({ store: { vendorType: 'GROCERY' }, price: 120, item: { specs: { options } } });
  void store;
  let r = await save(item.id, { price: 99 });
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.match(r.body.message, /sold in weights/);
  r = await save(item.id, { price: 120, description: 'Same price as the lowest weight is fine' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  // changing the weights sets the price (lowest weight) in the same save
  r = await save(item.id, { price: 1, specs: { options: [{ name: 'Weight', type: 'variant', choices: [{ label: '250 g', price: 130 }, { label: '1 kg', price: 480, isDefault: true }] }] } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(Number(r.body.price), 130);
  const specs = await specsOf(item.id);
  assert.deepEqual(specs.options[0].choices.map((c) => [c.label, !!c.isDefault]), [['250 g', false], ['1 kg', true]]);
});

test('automatic weights can be switched off (one pack only) and back on', async () => {
  const { item } = await T.mkStore({ store: { vendorType: 'GROCERY' }, price: 50, item: { specs: { weight: '1 kg' } } });
  let r = await save(item.id, { specs: { options: null, autoWeights: false } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await specsOf(item.id)).autoWeights, false);
  const u = await H.mkUser();
  r = await H.api('POST', '/api/orders/quote', u.token, { items: [{ menuItemId: item.id, quantity: 1 }], paymentMethod: 'COD', deliveryAddress: 'Block A, Room 101, SRM AP', campus: 'srmap' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((r.body.lines || r.body.items)[0].unitPrice, 50);
  r = await save(item.id, { specs: { autoWeights: null } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await specsOf(item.id)).autoWeights, undefined);
  // anything but false is never stored
  r = await save(item.id, { specs: { autoWeights: 'yes please' } });
  assert.equal((await specsOf(item.id)).autoWeights, undefined);
});

test('an emptied delivery zone goes back to the default zone', async () => {
  const { store } = await T.mkStore({ store: { zone: 'North_Block' } });
  const r = await H.api('POST', `/api/admin/restaurants/${store.id}`, admin.token, { zone: null });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await H.ctx.M('Restaurant').findByPk(store.id)).zone, 'Amaravathi_Central');
});

test("a stall's WhatsApp sign-in number cannot also sign in to another store", async () => {
  const wa = '9876501234';
  const a = await T.mkStore({ store: { vendorType: 'LOCAL_VENDOR', whatsappNumber: `91${wa}`, phone: null } });
  void a;
  // another phone-less stall with the same WhatsApp number
  let r = await H.api('POST', '/api/admin/restaurants', admin.token, { name: `Twin Stall ${Date.now()}`, location: 'Gate 3', vendorType: 'LOCAL_VENDOR', whatsappNumber: wa });
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.match(r.body.message, /^This WhatsApp number already signs in/);
  // a store whose login phone is that number
  r = await H.api('POST', '/api/admin/restaurants', admin.token, { name: `Phone Shop ${Date.now()}`, location: 'Gate 4', vendorType: 'GROCERY', phone: wa });
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.match(r.body.message, /^This phone number already signs in/);
  // with its own login phone the second stall is fine (it no longer signs in with the WhatsApp number)
  r = await H.api('POST', '/api/admin/restaurants', admin.token, { name: `Own Phone Stall ${Date.now()}`, location: 'Gate 5', vendorType: 'LOCAL_VENDOR', whatsappNumber: wa, phone: '9876505678' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
});
