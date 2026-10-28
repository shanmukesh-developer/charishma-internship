// Product options (docs/PRODUCT_OPTIONS.md) through the real quote + order API: the server prices a line from the
// admin's choices (the chosen weight's own price + extras), refuses missing / unknown picks, and stores the picks.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const T = require('./helpers');

const { H } = T;
before(async () => { await T.setup(); });
after(T.teardown);

const OPTIONS = [
  { name: 'Weight', type: 'variant', required: true, choices: [{ label: '1 kg', price: 400 }, { label: '500 g', price: 220 }, { label: '250 g', price: 120 }] },
  { name: 'Flavour', type: 'single', required: true, choices: [{ label: 'Chocolate', price: 0 }, { label: 'Butterscotch', price: 20 }] },
  { name: 'Add-ons', type: 'multi', choices: [{ label: 'Candles', price: 10 }] },
];
const body = (itemId, customizations, quantity = 1) => ({ items: [{ menuItemId: itemId, quantity, customizations }], paymentMethod: 'COD', deliveryAddress: 'Block A, Room 101, SRM AP', campus: 'srmap' });

test('the chosen weight sets the price, extras add on, and two weights are two lines', async () => {
  const { item } = await T.mkStore({ price: 120, item: { specs: { options: OPTIONS } } });
  const u = await H.mkUser();
  const q = await H.api('POST', '/api/orders/quote', u.token, {
    ...body(item.id, { Weight: '500 g', Flavour: 'Butterscotch', 'Add-ons': ['Candles'] }, 2),
    items: [
      { menuItemId: item.id, quantity: 2, customizations: { Weight: '500 g', Flavour: 'Butterscotch', 'Add-ons': ['Candles'] } },
      { menuItemId: item.id, quantity: 1, customizations: { Weight: '1 kg', Flavour: 'Chocolate' } },
    ],
  });
  assert.equal(q.status, 200, JSON.stringify(q.body));
  const lines = q.body.lines || q.body.items;
  assert.ok(Array.isArray(lines), JSON.stringify(q.body));
  const half = lines.find((l) => l.customizations && l.customizations.Weight === '500 g');
  const kilo = lines.find((l) => l.customizations && l.customizations.Weight === '1 kg');
  assert.equal(half.unitPrice, 250); // 220 + 20 butterscotch + 10 candles
  assert.equal(half.lineTotal, 500);
  assert.equal(kilo.unitPrice, 400);
  assert.deepEqual(Object.keys(half.customizations), ['Weight', 'Flavour', 'Add-ons']);
});

test('a missing or unknown pick is refused with a clear message', async () => {
  const { item } = await T.mkStore({ price: 120, item: { specs: { options: OPTIONS } } });
  const u = await H.mkUser();
  let r = await H.api('POST', '/api/orders/quote', u.token, body(item.id, { Flavour: 'Chocolate' }));
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'OPTION_INVALID');
  assert.match(r.body.message, /Weight/);
  r = await H.api('POST', '/api/orders/quote', u.token, body(item.id, { Weight: '2 kg', Flavour: 'Chocolate' }));
  assert.equal(r.status, 400);
  assert.match(r.body.message, /not available/);
});

test('a placed order stores the server price and the picks', async () => {
  const { item } = await T.mkStore({ price: 120, item: { specs: { options: OPTIONS } } });
  const u = await H.mkUser();
  const r = await H.api('POST', '/api/orders', u.token, body(item.id, { Weight: '250 g', Flavour: 'Chocolate' }));
  assert.ok([200, 201].includes(r.status), JSON.stringify(r.body));
  const order = await H.ctx.M('Order').findByPk(r.body.id || r.body._id || (r.body.order && r.body.order.id));
  const items = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;
  assert.equal(items[0].unitPrice, 120);
  assert.equal(items[0].customizations.Weight, '250 g');
});
