// Splash ads (models/SplashAd): validation of admin writes and the public read shape for GET /api/ads/splash.
// An ad promotes one real store (Restaurant row) in one of 8 interactive styles. Up to 8 run at once, one per
// style; the customer app picks among them at random (shuffle bag).
const { isLocalVendorStore } = require('./vendorTypes');
const { getStoreOpenState } = require('./storeHours');
const { stripStoreSecrets, stripItemSecrets } = require('./publicFields');
const imageStore = require('./imageStore');

// Style key -> admin label + one line describing the interaction (admin page shows the same list).
const STYLES = Object.freeze({
  tear: { label: 'Tear the paper', description: 'Rip a poster ad in two.' },
  scratch: { label: 'Scratch card', description: 'Rub to reveal.' },
  envelope: { label: 'Secret envelope', description: 'Break the seal, the card rises.' },
  gift: { label: 'Gift box', description: 'Pull the ribbon, the product rises.' },
  glass: { label: 'Wipe the glass', description: 'Wipe the fog off.' },
  coupon: { label: 'Pull the coupon', description: 'Tear the stub.' },
  portal: { label: 'Portal', description: 'Swipe a glowing ring open.' },
  peel: { label: 'Peel the sticker', description: 'Peel a corner.' },
});
const STYLE_KEYS = Object.keys(STYLES);
const MAX_LIVE = STYLE_KEYS.length; // one active ad per style
const MAX_PRODUCTS = 2;
const DEFAULT_COLOR_A = '#7d2c12';
const DEFAULT_COLOR_B = '#120805';
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HTTPS_URL_RE = /^https:\/\/[^\s"'<>]{3,2040}$/i;
const MAX_IMAGE_URL = 2048;

class SplashAdInputError extends Error {
  constructor(message, field) {
    super(message);
    this.code = 'INVALID_SPLASH_AD';
    this.field = field || null;
    this.status = 400;
  }
}
const fail = (message, field) => { throw new SplashAdInputError(message, field); };

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const plain = (row) => (row && typeof row.get === 'function' ? row.get({ plain: true }) : (row || {}));

// One-line text (control characters removed, whitespace collapsed, trimmed); `lines` > 1 keeps that many lines.
const text = (v, max, label, field, { required = false, lines = 1 } = {}) => {
  if (v !== undefined && v !== null && typeof v !== 'string' && typeof v !== 'number') fail(`${label} must be text.`, field);
  let s = v === undefined || v === null ? '' : String(v);
  // eslint-disable-next-line no-control-regex
  const parts = s.replace(/\r\n?/g, '\n').split('\n').map((p) => p.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (parts.length > lines) fail(lines === 1 ? `${label} must be one line.` : `${label} can have at most ${lines} lines.`, field);
  s = parts.join('\n');
  if (required && !s) fail(`Write the ${label.toLowerCase()} (up to ${max} characters).`, field);
  if (s.length > max) fail(`${label} must be at most ${max} characters.`, field);
  return s;
};

const color = (v, fallback, label, field) => {
  if (v === undefined || v === null || v === '') return fallback;
  if (typeof v !== 'string' || !COLOR_RE.test(v.trim())) fail(`${label} must be a colour like #7d2c12.`, field);
  return v.trim().toLowerCase();
};

const dateOrNull = (v, label, field) => {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' && typeof v !== 'number' && !(v instanceof Date)) fail(`${label} is not a valid date.`, field);
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime()) || d.getUTCFullYear() < 2020 || d.getUTCFullYear() > 2100) fail(`${label} is not a valid date.`, field);
  return d;
};

// https URL, or this backend's own media path / URL (/api/campus/media/<uuid>, as uploads return it).
const imageRef = (v) => {
  if (typeof v !== 'string' || !v.trim()) fail('Add the ad image (an uploaded photo or an https link).', 'imageUrl');
  const s = v.trim();
  if (s.length > MAX_IMAGE_URL) fail('The image link is too long.', 'imageUrl');
  if (imageStore.mediaIdOf(s.split('?')[0]) || HTTPS_URL_RE.test(s)) return s;
  fail('The image must be an uploaded photo or an https:// link.', 'imageUrl');
  return null;
};

/**
 * Cleans an admin write. `current` = the stored row on an update (fields not sent keep their value).
 * Returns the column values (imageUrl still to be stored through utils/imageStore by the route).
 */
const validateSplashAd = (body, { current = null, now = new Date() } = {}) => {
  const b = isObj(body) ? body : {};
  const cur = current ? plain(current) : {};
  const pick = (k) => (b[k] !== undefined ? b[k] : cur[k]);

  const restaurantId = String(pick('restaurantId') || '');
  if (!UUID_RE.test(restaurantId)) fail('Choose the store this ad promotes.', 'restaurantId');
  const style = String(pick('style') || '').trim().toLowerCase();
  if (!STYLES[style]) fail(`style must be one of ${STYLE_KEYS.join(', ')}.`, 'style');
  const offerText = text(pick('offerText'), 24, 'Offer', 'offerText', { required: true });
  const headline = text(pick('headline'), 60, 'Headline', 'headline', { required: true, lines: 2 });
  const subline = text(pick('subline'), 90, 'Subline', 'subline');
  const bannerText = text(pick('bannerText'), 40, 'Banner text', 'bannerText');
  const imageUrl = imageRef(pick('imageUrl'));
  const colorA = color(pick('colorA'), DEFAULT_COLOR_A, 'Colour A', 'colorA');
  const colorB = color(pick('colorB'), DEFAULT_COLOR_B, 'Colour B', 'colorB');

  const startsAt = dateOrNull(pick('startsAt'), 'Start', 'startsAt');
  const endsAt = dateOrNull(pick('endsAt'), 'End', 'endsAt');
  if (startsAt && endsAt && endsAt <= startsAt) fail('The end must be after the start.', 'endsAt');

  const rawPriority = pick('priority');
  const priority = rawPriority === undefined || rawPriority === null || rawPriority === '' ? 0 : Number(rawPriority);
  if (!Number.isInteger(priority) || priority < 0 || priority > 999) fail('Priority must be a whole number from 0 to 999.', 'priority');

  const active = pick('isActive');
  if (active !== undefined && active !== null && typeof active !== 'boolean') fail('isActive must be true or false.', 'isActive');
  // A past end is refused when it is set now, and when an ad that ended is switched on again (it would hold
  // its style while showing nowhere).
  const switchingOn = active === true && cur.isActive !== true;
  if (endsAt && endsAt <= now && (!current || b.endsAt !== undefined || switchingOn)) fail('The end is already past.', 'endsAt');

  return {
    restaurantId, style, offerText, headline, subline: subline || null, bannerText: bannerText || null, imageUrl,
    colorA, colorB, startsAt, endsAt, priority, isActive: active === true,
  };
};

/** live | scheduled | ended | off (admin list; the public read also needs the store to be listed). */
const adState = (row, now = Date.now()) => {
  const a = plain(row);
  if (!a.isActive) return 'off';
  if (a.startsAt && new Date(a.startsAt).getTime() > now) return 'scheduled';
  if (a.endsAt && new Date(a.endsAt).getTime() <= now) return 'ended';
  return 'live';
};

// "Biryani · North Indian" from the store's tags (the Restaurant model has no cuisine column).
const cuisineOf = (tags) => {
  const list = (Array.isArray(tags) ? tags : []).map((t) => String(t).trim()).filter(Boolean);
  return list.length ? list.slice(0, 2).join(' · ') : null;
};
const safeImage = (v) => (typeof v === 'string' && v && !imageStore.isDataUrl(v) && v.length <= MAX_IMAGE_URL ? v : null);

const readSpecs = (item) => {
  let specs = item.specs;
  if (typeof specs === 'string') { try { specs = JSON.parse(specs); } catch { specs = null; } }
  return isObj(specs) ? specs : {};
};
/** In stock now (same rule as the catalogue), not an add-on (specs.extraFor) and not Elite-only. */
const showableItem = (item, now = Date.now()) => {
  const inStock = !!item.isAvailable || !!(item.outOfStockUntil && new Date(item.outOfStockUntil).getTime() <= now);
  const specs = readSpecs(item);
  return inStock && !item.isEliteOnly && !(Array.isArray(specs.extraFor) && specs.extraFor.length);
};

const publicStore = (row) => {
  const s = stripStoreSecrets(row && typeof row.toJSON === 'function' ? row.toJSON() : { ...(row || {}) });
  const open = getStoreOpenState(row);
  return {
    id: s.id,
    name: s.name,
    imageUrl: safeImage(s.imageUrl),
    cuisine: cuisineOf(s.tags),
    rating: Number(s.rating) > 0 ? Number(s.rating) : null,
    isOpen: !!open.isOpen,
    opensAt: open.opensAt || null,
    isLocalVendor: isLocalVendorStore(s),
    vendorType: s.vendorType || null,
  };
};

const publicProduct = (row) => {
  const i = stripItemSecrets(row && typeof row.toJSON === 'function' ? row.toJSON() : { ...(row || {}) });
  const price = Number(i.price);
  const mrp = Number(i.originalPrice) || Number(readSpecs(i).originalPrice);
  return { id: i.id, name: i.name, price, originalPrice: mrp > price ? mrp : null, imageUrl: safeImage(i.imageUrl) };
};

/** Up to 2 products: menu order, items with a photo first. `items` are already showable and menu-sorted. */
const pickProducts = (items) => {
  const withPhoto = items.filter((i) => safeImage(i.imageUrl));
  const without = items.filter((i) => !safeImage(i.imageUrl));
  return [...withPhoto, ...without].slice(0, MAX_PRODUCTS).map(publicProduct);
};

const publicAd = (row, store, items) => {
  const a = plain(row);
  return {
    id: a.id,
    style: a.style,
    offerText: a.offerText,
    headline: a.headline,
    subline: a.subline || null,
    bannerText: a.bannerText || null,
    imageUrl: a.imageUrl,
    colorA: a.colorA || DEFAULT_COLOR_A,
    colorB: a.colorB || DEFAULT_COLOR_B,
    store: publicStore(store),
    products: pickProducts(items || []),
  };
};

module.exports = {
  STYLES, STYLE_KEYS, MAX_LIVE, MAX_PRODUCTS, DEFAULT_COLOR_A, DEFAULT_COLOR_B,
  SplashAdInputError, validateSplashAd, adState, showableItem, publicStore, publicProduct, publicAd, cuisineOf,
};
