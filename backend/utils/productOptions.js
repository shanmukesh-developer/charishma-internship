// Product options (weights / sizes, flavours, types, add-ons, a typed message) and ordered product details,
// stored in MenuItem.specs.options / specs.details. Contract: docs/PRODUCT_OPTIONS.md.
//  - normalizeOptions / normalizeDetails: validate what the admin saves (throws OptionsInputError, message for the admin).
//  - readOptions: the stored groups, cleaned (never throws; bad stored data counts as "no options").
//  - priceWithOptions: price one basket line of a product that has options, from the customer's picks.

const VARIANT = 'variant';
const SINGLE = 'single';
const MULTI = 'multi';
const TEXT = 'text';
const TYPES = [VARIANT, SINGLE, MULTI, TEXT];
const MAX_GROUPS = 8;
const MAX_CHOICES = 20;
const MAX_DETAILS = 20;
const MAX_PRICE = 100000;

class OptionsInputError extends Error {
  constructor(message) { super(message); this.name = 'OptionsInputError'; this.status = 400; }
}

const text = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const rupees = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
};
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

/** Admin input -> clean groups (or null to remove options). Throws OptionsInputError with a message for the admin. */
const normalizeOptions = (raw) => {
  if (raw == null || (Array.isArray(raw) && raw.length === 0)) return null;
  if (!Array.isArray(raw)) throw new OptionsInputError('Choices must be a list of groups.');
  if (raw.length > MAX_GROUPS) throw new OptionsInputError(`At most ${MAX_GROUPS} choice groups per product.`);
  const out = [];
  for (const g of raw) {
    if (!g || typeof g !== 'object') throw new OptionsInputError('Every choice group needs a name and a type.');
    const name = text(g.name, 30);
    if (!name) throw new OptionsInputError('Every choice group needs a name.');
    if (out.some((x) => same(x.name, name))) throw new OptionsInputError(`Two choice groups are called "${name}".`);
    const type = String(g.type || '').toLowerCase();
    if (!TYPES.includes(type)) throw new OptionsInputError(`"${name}": choose what kind of choice it is.`);
    if (type === VARIANT && out.some((x) => x.type === VARIANT)) throw new OptionsInputError('Only one weight / size group per product.');
    if (type === TEXT) {
      const maxLength = Math.min(100, Math.max(1, parseInt(g.maxLength, 10) || 40));
      out.push({ name, type, required: !!g.required, maxLength });
      continue;
    }
    const list = Array.isArray(g.choices) ? g.choices : [];
    if (!list.length) throw new OptionsInputError(`"${name}" needs at least one choice.`);
    if (list.length > MAX_CHOICES) throw new OptionsInputError(`"${name}" can have at most ${MAX_CHOICES} choices.`);
    const choices = [];
    for (const c of list) {
      const label = text(c && c.label, 30);
      if (!label) throw new OptionsInputError(`Every choice in "${name}" needs a name.`);
      if (choices.some((x) => same(x.label, label))) throw new OptionsInputError(`"${name}" has "${label}" twice.`);
      const price = rupees(c && c.price != null && c.price !== '' ? c.price : 0);
      if (!Number.isFinite(price) || price < 0 || price > MAX_PRICE) throw new OptionsInputError(`"${name}" - "${label}": enter a price between 0 and ${MAX_PRICE}.`);
      if (type === VARIANT && price <= 0) throw new OptionsInputError(`"${name}" - "${label}": every weight / size needs its full price.`);
      // Weight / size only: an optional MRP for that weight (shown struck through with its % off).
      let mrp = null;
      if (type === VARIANT && c && c.mrp != null && c.mrp !== '') {
        mrp = rupees(c.mrp);
        if (!Number.isFinite(mrp) || mrp <= 0 || mrp > MAX_PRICE) throw new OptionsInputError(`"${name}" - "${label}": enter an MRP between 1 and ${MAX_PRICE}, or leave it empty.`);
        if (mrp < price) throw new OptionsInputError(`"${name}" - "${label}": the MRP (${mrp}) cannot be lower than the price (${price}).`);
      }
      choices.push(mrp && mrp > price ? { label, price, mrp } : { label, price });
    }
    const group = { name, type, choices };
    if (type === VARIANT) group.required = true;
    if (type === SINGLE) group.required = !!g.required;
    if (type === MULTI) {
      const max = parseInt(g.max, 10);
      if (Number.isFinite(max) && max >= 1) group.max = Math.min(max, choices.length);
    }
    out.push(group);
  }
  return out;
};

/** Admin input -> ordered detail rows (or null to remove them). */
const normalizeDetails = (raw) => {
  if (raw == null || (Array.isArray(raw) && raw.length === 0)) return null;
  if (!Array.isArray(raw)) throw new OptionsInputError('Product details must be a list of rows.');
  if (raw.length > MAX_DETAILS) throw new OptionsInputError(`At most ${MAX_DETAILS} product detail rows.`);
  const out = [];
  for (const r of raw) {
    const label = text(r && r.label, 30);
    const value = text(r && r.value, 200);
    if (!label && !value) continue;
    if (!label || !value) throw new OptionsInputError('Every product detail row needs both a name and a value.');
    out.push({ label, value });
  }
  return out.length ? out : null;
};

/** The lowest variant price, or null when the product has no weight / size group. */
const variantFromPrice = (groups) => {
  const v = (groups || []).find((g) => g.type === VARIANT);
  return v && v.choices.length ? Math.min(...v.choices.map((c) => c.price)) : null;
};

/** Stored groups (cleaned). Bad stored data -> [] (the product then sells at its plain price). */
const readOptions = (specs) => {
  let s = specs;
  if (typeof s === 'string') { try { s = JSON.parse(s); } catch { s = null; } }
  if (!s || typeof s !== 'object' || !Array.isArray(s.options) || !s.options.length) return [];
  try { return normalizeOptions(s.options) || []; } catch { return []; }
};

// ── Automatic weights (owner, 29 Oct 2026: "if admin not specified the weights ... 250, 500, 1000 ... randomly,
// later admin correct it") ─────────────────────────────────────────────────────────────────────────────────────
// A grocery / bakery product sold by weight (pack size in g / kg, at least 250 g) that has NO admin-set choices gets
// a Weight group of 250 g / 500 g / 1 kg (plus its own pack size), priced from its own price per gram, whole rupees.
// Its own pack keeps exactly its current price and is the default pick. The admin's own choices always replace it.
const AUTO_WEIGHT_TYPES = ['GROCERY', 'BAKERY'];
const AUTO_SIZES = [250, 500, 1000];

/** "1000g" / "1 kg" / "500 gms" / "1.5kg" -> grams, or null. */
const packGrams = (text) => {
  const t = String(text || '').toLowerCase().trim();
  const m = t.match(/(\d+(?:\.\d+)?)\s*(kgs?|kilograms?|kilos?|g|gms?|grams?)(?![a-z])/);
  if (m) {
    const n = Number(m[1]) * (m[2].startsWith('k') ? 1000 : 1);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  }
  // A pack size typed as a bare number ("1000", as stores enter it) is grams.
  const bare = t.match(/^(\d{2,5})$/);
  if (bare) {
    const n = Number(bare[1]);
    return n >= 50 && n <= 10000 ? n : null;
  }
  return null;
};

/** "1000" -> "1 kg", "250" -> "250 g"; any other text unchanged (a bare number is grams, see packGrams). */
const packLabel = (text) => {
  const t = String(text || '').trim();
  if (!/^\d{2,5}$/.test(t)) return t || null;
  const g = packGrams(t);
  return g ? (g >= 1000 ? `${Number((g / 1000).toFixed(2))} kg` : `${g} g`) : t;
};

/**
 * What a list shows for a product sold in weights: the DEFAULT weight's own price, MRP and size (the one the
 * product page pre-selects: the pack marked default, else the first listed). Without this a list paired the
 * lowest weight's price (the product price) with the 1 kg pack's MRP and size: "1000g ₹45 ~~₹185~~ 76% off".
 * Returns null when the product has no weight / size group.
 */
const listingFromOptions = (groups) => {
  const v = (groups || []).find((g) => g.type === VARIANT && Array.isArray(g.choices) && g.choices.length);
  if (!v) return null;
  const d = v.choices.find((c) => c.isDefault) || v.choices[0];
  const mrp = Number(d.mrp) > Number(d.price) ? Number(d.mrp) : null;
  return { price: Number(d.price), originalPrice: mrp, weight: d.label, discountPercent: mrp ? Math.round((1 - Number(d.price) / mrp) * 100) : null };
};
const weightLabel = (g) => (g >= 1000 ? `${Number((g / 1000).toFixed(2))} kg` : `${g} g`);

/** The automatic Weight group for `item` (MenuItem row or plain object) of a store of `vendorType`, or []. */
const autoWeightOptions = (item, vendorType) => {
  if (!item || !AUTO_WEIGHT_TYPES.includes(String(vendorType || '').toUpperCase())) return [];
  let specs = item.specs;
  if (typeof specs === 'string') { try { specs = JSON.parse(specs); } catch { specs = {}; } }
  specs = specs && typeof specs === 'object' ? specs : {};
  const grams = packGrams(specs.weight) || packGrams(item.name);
  const price = Number(item.price);
  if (!grams || grams < 250 || !Number.isFinite(price) || price <= 0) return [];
  const sizes = [...new Set([...AUTO_SIZES, grams])].filter((g) => g >= grams / 4 && g <= grams * 2).sort((a, b) => a - b);
  if (sizes.length < 2) return [];
  const mrpRaw = Number(item.originalPrice) || Number(specs.originalPrice);
  const mrp = Number.isFinite(mrpRaw) && mrpRaw > price ? mrpRaw : null;
  const choices = sizes.map((g) => {
    const own = g === grams;
    const c = { label: weightLabel(g), price: own ? Math.round(price * 100) / 100 : Math.max(1, Math.round((price / grams) * g)) };
    if (mrp) c.mrp = own ? mrp : Math.max(c.price, Math.round((mrp / grams) * g));
    if (own) c.isDefault = true;
    return c;
  });
  return [{ name: 'Weight', type: VARIANT, required: true, auto: true, choices }];
};

/** The choices a product is sold with: the admin's own, else the automatic weights (see above), else []. */
const effectiveOptions = (item, vendorType) => {
  const own = readOptions(item && item.specs);
  return own.length ? own : autoWeightOptions(item, vendorType);
};

/**
 * Price one unit of `dbItem` (which has options) from the customer's picks `{ [groupName]: label | label[] | text }`.
 * Returns { basePrice, addOnPrice, unitPrice, customizations } (customizations cleaned, in the admin's group order).
 * Throws { code: 'OPTION_INVALID', message } for a wrong / missing pick.
 */
const priceWithOptions = (dbItem, groups, picks) => {
  const given = picks && typeof picks === 'object' && !Array.isArray(picks) ? picks : {};
  const fail = (message) => { const e = new Error(message); e.code = 'OPTION_INVALID'; throw e; };
  const itemName = text(dbItem && dbItem.name, 60) || 'This item';
  const pickFor = (name) => {
    const key = Object.keys(given).find((k) => same(k, name));
    return key === undefined ? undefined : given[key];
  };
  let basePrice = rupees(dbItem && dbItem.price) || 0;
  let extra = 0;
  const cleaned = {};
  for (const g of groups) {
    const v = pickFor(g.name);
    if (g.type === TEXT) {
      const t = text(typeof v === 'string' ? v : '', 1000);
      if (!t) { if (g.required) fail(`${itemName}: please fill "${g.name}".`); continue; }
      if (t.length > g.maxLength) fail(`${itemName}: "${g.name}" can be at most ${g.maxLength} characters.`);
      cleaned[g.name] = t;
      continue;
    }
    let labels = (Array.isArray(v) ? v : (v === undefined || v === null || v === '' ? [] : [v])).filter((x) => typeof x === 'string');
    // Automatic weights and no pick (an app from before weights existed): the product's own pack, its own price.
    if (!labels.length && g.auto) { const d = g.choices.find((c) => c.isDefault); if (d) labels = [d.label]; }
    if (!labels.length) { if (g.required) fail(`${itemName}: please choose ${g.type === VARIANT ? 'a' : 'an option for'} "${g.name}".`); continue; }
    if (g.type !== MULTI && labels.length > 1) fail(`${itemName}: choose only one "${g.name}".`);
    if (g.type === MULTI && g.max && labels.length > g.max) fail(`${itemName}: choose at most ${g.max} for "${g.name}".`);
    const chosen = [];
    for (const l of labels) {
      const c = g.choices.find((x) => same(x.label, l));
      if (!c) fail(`${itemName}: "${text(l, 30)}" is not available for "${g.name}" any more. Please choose again.`);
      if (!chosen.includes(c)) chosen.push(c);
    }
    if (g.type === VARIANT) basePrice = chosen[0].price;
    else extra += chosen.reduce((sum, c) => sum + c.price, 0);
    cleaned[g.name] = g.type === MULTI ? chosen.map((c) => c.label) : chosen[0].label;
  }
  const addOnPrice = Math.round(extra * 100) / 100;
  return { basePrice, addOnPrice, unitPrice: Math.round((basePrice + addOnPrice) * 100) / 100, customizations: Object.keys(cleaned).length ? cleaned : null };
};

module.exports = {
  VARIANT, SINGLE, MULTI, TEXT, OptionsInputError,
  normalizeOptions, normalizeDetails, readOptions, priceWithOptions, variantFromPrice,
  autoWeightOptions, effectiveOptions, packGrams, packLabel, listingFromOptions,
};
