// utils/productOptions (docs/PRODUCT_OPTIONS.md): admin input validation, stored-data reading and line pricing.
const { test } = require('node:test');
const assert = require('node:assert');
const po = require('../../utils/productOptions');

const CAKE = [
  { name: 'Weight', type: 'variant', choices: [{ label: '1 kg', price: 400 }, { label: '500 g', price: 220 }, { label: '250 g', price: 120 }] },
  { name: 'Flavour', type: 'single', required: true, choices: [{ label: 'Chocolate', price: 0 }, { label: 'Butterscotch', price: 20 }] },
  { name: 'Cake type', type: 'single', choices: [{ label: 'Eggless', price: 30 }] },
  { name: 'Add-ons', type: 'multi', max: 2, choices: [{ label: 'Candles', price: 10 }, { label: 'Knife', price: 0 }, { label: 'Card', price: 15 }] },
  { name: 'Message on cake', type: 'text', maxLength: 20 },
];

test('admin input: valid groups are kept in order and cleaned; the lowest weight is the "from" price', () => {
  const groups = po.normalizeOptions(CAKE);
  assert.deepStrictEqual(groups.map((g) => g.name), ['Weight', 'Flavour', 'Cake type', 'Add-ons', 'Message on cake']);
  assert.strictEqual(groups[0].required, true);
  assert.strictEqual(groups[2].required, false);
  assert.strictEqual(po.variantFromPrice(groups), 120);
  assert.strictEqual(po.normalizeOptions([]), null);
  assert.strictEqual(po.normalizeOptions(null), null);
});

test('admin input: mistakes are refused with a clear message', () => {
  const bad = (opts, re) => assert.throws(() => po.normalizeOptions(opts), (e) => e instanceof po.OptionsInputError && re.test(e.message));
  bad([{ name: '', type: 'single', choices: [{ label: 'A', price: 0 }] }], /needs a name/);
  bad([{ name: 'Size', type: 'nope', choices: [] }], /what kind/);
  bad([{ name: 'W', type: 'variant', choices: [{ label: '1 kg', price: 0 }] }], /full price/);
  bad([{ name: 'W', type: 'variant', choices: [{ label: '1 kg', price: 10 }] }, { name: 'S', type: 'variant', choices: [{ label: 'x', price: 5 }] }], /Only one weight/);
  bad([{ name: 'F', type: 'single', choices: [{ label: 'A', price: 1 }, { label: 'a', price: 2 }] }], /twice/);
  bad([{ name: 'F', type: 'single', choices: [{ label: 'A', price: -1 }] }], /price between/);
  bad([{ name: 'F', type: 'single', choices: [] }], /at least one/);
  bad([{ name: 'F', type: 'single', choices: [{ label: 'A' }] }, { name: 'f', type: 'single', choices: [{ label: 'B' }] }], /Two choice groups/);
  assert.throws(() => po.normalizeDetails([{ label: 'Brand', value: '' }]), /both a name and a value/);
  assert.deepStrictEqual(po.normalizeDetails([{ label: 'Brand', value: 'Amul' }, { label: 'Shelf life', value: '6 months' }]), [{ label: 'Brand', value: 'Amul' }, { label: 'Shelf life', value: '6 months' }]);
});

test('pricing: the chosen weight is the price, extras add on, picks come back in the admin order', () => {
  const groups = po.readOptions({ options: CAKE });
  const item = { name: 'Truffle cake', price: 120 };
  const r = po.priceWithOptions(item, groups, { 'add-ons': ['Card', 'Candles'], Flavour: 'butterscotch', Weight: '500 g', 'Message on cake': 'Happy bday Ravi' });
  assert.strictEqual(r.basePrice, 220);
  assert.strictEqual(r.addOnPrice, 45);
  assert.strictEqual(r.unitPrice, 265);
  assert.deepStrictEqual(Object.keys(r.customizations), ['Weight', 'Flavour', 'Add-ons', 'Message on cake']);
  assert.strictEqual(r.customizations.Flavour, 'Butterscotch');
  assert.deepStrictEqual(r.customizations['Add-ons'], ['Card', 'Candles']);
  assert.strictEqual(po.priceWithOptions(item, groups, { Weight: '1 kg', Flavour: 'Chocolate' }).unitPrice, 400);
});

test('pricing: a missing or unknown pick is refused (never priced from the phone)', () => {
  const groups = po.readOptions({ options: CAKE });
  const item = { name: 'Truffle cake', price: 120 };
  const bad = (picks, re) => assert.throws(() => po.priceWithOptions(item, groups, picks), (e) => e.code === 'OPTION_INVALID' && re.test(e.message));
  bad({ Flavour: 'Chocolate' }, /choose a "Weight"/);
  bad({ Weight: '2 kg', Flavour: 'Chocolate' }, /not available/);
  bad({ Weight: '1 kg' }, /Flavour/);
  bad({ Weight: ['1 kg', '500 g'], Flavour: 'Chocolate' }, /only one/);
  bad({ Weight: '1 kg', Flavour: 'Chocolate', 'Add-ons': ['Candles', 'Knife', 'Card'] }, /at most 2/);
  bad({ Weight: '1 kg', Flavour: 'Chocolate', 'Message on cake': 'x'.repeat(21) }, /at most 20/);
});

test('stored data that does not validate counts as "no options" (the product sells at its plain price)', () => {
  assert.deepStrictEqual(po.readOptions({ options: [{ name: 'x', type: 'bad' }] }), []);
  assert.deepStrictEqual(po.readOptions('not json'), []);
  assert.deepStrictEqual(po.readOptions({}), []);
});
