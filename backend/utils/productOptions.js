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
      choices.push({ label, price });
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
    const labels = (Array.isArray(v) ? v : (v === undefined || v === null || v === '' ? [] : [v])).filter((x) => typeof x === 'string');
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
};
