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

test('automatic weights: grocery / bakery packs of 250 g+ get 250 g / 500 g / 1 kg from their price per gram', () => {
  const amla = po.autoWeightOptions({ name: 'Amla', price: 140, originalPrice: 170, specs: { weight: '1000g' } }, 'GROCERY');
  assert.deepStrictEqual(amla[0].choices.map((c) => [c.label, c.price, c.mrp, !!c.isDefault]), [['250 g', 35, 43, false], ['500 g', 70, 85, false], ['1 kg', 140, 170, true]]);
  assert.strictEqual(po.autoWeightOptions({ name: 'Lays 52g', price: 20, specs: { weight: '52 g' } }, 'GROCERY').length, 0, 'small packets keep one size');
  assert.strictEqual(po.autoWeightOptions({ name: 'Biryani', price: 200, specs: { weight: '1 kg' } }, 'RESTAURANT').length, 0, 'restaurants never');
  assert.strictEqual(po.autoWeightOptions({ name: 'Mango pickle 500 gms', price: 120, specs: {} }, 'BAKERY')[0].choices.length, 3, 'pack size read from the name');
  // the admin's own choices always win
  const own = po.effectiveOptions({ name: 'Amla', price: 140, specs: { weight: '1000g', options: [{ name: 'Size', type: 'variant', choices: [{ label: 'Jar', price: 99 }] }] } }, 'GROCERY');
  assert.deepStrictEqual(own.map((g) => g.name), ['Size']);
});

test('weight MRPs: kept when above the price, refused when below, dropped when equal', () => {
  const g = po.normalizeOptions([{ name: 'Weight', type: 'variant', choices: [{ label: '250 g', price: 45, mrp: 60 }, { label: '500 g', price: 90, mrp: 90 }, { label: '1 kg', price: 170 }] }]);
  assert.deepStrictEqual(g[0].choices, [{ label: '250 g', price: 45, mrp: 60 }, { label: '500 g', price: 90 }, { label: '1 kg', price: 170 }]);
  assert.throws(() => po.normalizeOptions([{ name: 'Weight', type: 'variant', choices: [{ label: '1 kg', price: 170, mrp: 100 }] }]), /cannot be lower/);
});
