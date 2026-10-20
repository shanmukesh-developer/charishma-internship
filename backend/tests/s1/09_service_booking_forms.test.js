// Per-service booking forms (customer-mobile modules/services/serviceForms.ts): POST /api/services/book
// keeps the form's answers as a bounded specifications.details list + formId, still accepts the old
// payload without them, and prices a print item that is not a rate row (A3) at its own page price.
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

test('repair booking stores bounded details + formId and the readable description', async () => {
  const items = await mkServiceStore('REPAIRS', [['Doorstep Tech Diagnosis & Pickup', 99]]);
  const u = await H.mkUser();
  const details = [
    { key: 'device', label: 'Device', value: 'Phone' },
    { key: 'brandModel', label: 'Brand and model', value: 'Redmi <b>Note</b> 12' },
    { key: 'problems', label: 'Problem', value: 'Battery, Charging' },
    { key: 'bad key!', label: 'Count', value: 3 },
    { key: '', label: 'No key', value: 'dropped' },
    { key: 'nested', label: 'Nested', value: { deep: 'x' } },
    'not an object',
    ...Array.from({ length: 40 }, (_, i) => ({ key: `extra${i}`, label: 'Extra', value: 'y'.repeat(900) })),
  ];
  const r = await book(u, {
    serviceType: 'PHONE_REPAIR',
    title: 'Doorstep Tech Diagnosis & Pickup',
    description: 'Device: Phone\nBrand and model: Redmi Note 12\nProblem: Battery, Charging',
    specifications: { formId: 'repairs.diagnosis<script>', details, catalogueItemId: items['Doorstep Tech Diagnosis & Pickup'].id, category: 'repairs' },
  });
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  assert.strictEqual(r.body.booking.quotedAmount, 99);
  const row = await H.ctx.M.ServiceBooking.findByPk(r.body.booking.id);
  assert.strictEqual(row.serviceType, 'PHONE_REPAIR');
  assert.ok(row.description.includes('Brand and model: Redmi Note 12'));
  const spec = specsOf(row);
  assert.strictEqual(spec.formId, 'repairs.diagnosisscript');
  assert.ok(Array.isArray(spec.details));
  assert.ok(spec.details.length <= 25, `at most 25 rows, got ${spec.details.length}`);
  assert.deepStrictEqual(spec.details[0], { key: 'device', label: 'Device', value: 'Phone' });
  assert.strictEqual(spec.details[1].value, 'Redmi bNote/b 12', 'angle brackets stripped');
  assert.deepStrictEqual(spec.details[2], { key: 'problems', label: 'Problem', value: 'Battery, Charging' });
  assert.deepStrictEqual(spec.details[3], { key: 'badkey', label: 'Count', value: '3' }, 'key cleaned, number kept as text');
  assert.ok(!spec.details.some((d) => d.label === 'No key' || d.label === 'Nested'), 'rows without a key or with an object value are dropped');
  assert.ok(spec.details.every((d) => d.value.length <= 500));
});

test('old payload without details still books; empty or invalid details are not stored', async () => {
  const items = await mkServiceStore('TAILORING', [['Jeans & Trouser Length Alteration', 60]]);
  const u = await H.mkUser();
  const old = await book(u, {
    serviceType: 'TAILORING',
    title: 'Jeans & Trouser Length Alteration',
    description: '[Notes: shorten 2 in] - Bottom shortening',
    specifications: { catalogueItemId: items['Jeans & Trouser Length Alteration'].id, category: 'tailoring', notes: 'shorten 2 in' },
  });
  assert.strictEqual(old.status, 201, JSON.stringify(old.body));
  const oldSpec = specsOf(await H.ctx.M.ServiceBooking.findByPk(old.body.booking.id));
  assert.strictEqual(oldSpec.details, undefined);
  assert.strictEqual(oldSpec.formId, undefined);
  assert.strictEqual(old.body.booking.quotedAmount, 60);

  const junk = await book(u, {
    serviceType: 'TAILORING',
    title: 'Jeans & Trouser Length Alteration',
    specifications: { catalogueItemId: items['Jeans & Trouser Length Alteration'].id, category: 'tailoring', details: 'not a list', formId: '<>' },
  });
  assert.strictEqual(junk.status, 201, JSON.stringify(junk.body));
  const junkSpec = specsOf(await H.ctx.M.ServiceBooking.findByPk(junk.body.booking.id));
  assert.strictEqual(junkSpec.details, undefined);
  assert.strictEqual(junkSpec.formId, undefined);
});

test('print: A3 item is priced at its own page rate; rate rows keep the B&W / colour + binding formula', async () => {
  const items = await mkServiceStore('PRINT', [
    ['Document Printout (Black & White)', 2],
    ['High-Res Color Printout', 8],
    ['Spiral Project Binding', 35],
    ['Hardbound Golden Embossed Thesis', 250],
    ['Engineering Drawing A3 Prints', 15],
  ]);
  const u = await H.mkUser();
  const price = async (name, spec) => {
    const r = await book(u, {
      serviceType: 'PRINTOUT',
      title: name,
      specifications: { catalogueItemId: items[name].id, category: 'print', ...spec },
    });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    return r.body.booking.quotedAmount;
  };
  assert.strictEqual(await price('Engineering Drawing A3 Prints', { pageCount: '10', copies: '2', printColor: 'bw', bindingType: 'none' }), 300);
  assert.strictEqual(await price('Engineering Drawing A3 Prints', { pageCount: '4', copies: '1', printColor: 'color', bindingType: 'spiral' }), 95);
  assert.strictEqual(await price('Document Printout (Black & White)', { pageCount: '10', copies: '2', printColor: 'bw', bindingType: 'none' }), 40);
  assert.strictEqual(await price('High-Res Color Printout', { pageCount: '5', copies: '1', printColor: 'color', bindingType: 'none' }), 40);
  assert.strictEqual(await price('Spiral Project Binding', { pageCount: '30', copies: '1', printColor: 'bw', bindingType: 'spiral' }), 95);
  assert.strictEqual(await price('Hardbound Golden Embossed Thesis', { pageCount: '60', copies: '1', printColor: 'bw', bindingType: 'hardbound' }), 370);
});
