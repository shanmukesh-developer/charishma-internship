// Splash ads: GET /api/ads/splash ({ ads: [] } shape, window / store listing / priority rules, up to 2 products,
// private store fields stripped, cache dropped on admin and store writes) and the admin routes (validation,
// one ACTIVE ad per style -> 409, inactive duplicates allowed, admin only, audit rows).
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers');

let admin; let student; let store; let store2;
test.before(async () => {
  await H.setup();
  admin = await H.mkUser({ role: 'admin' });
  student = await H.mkUser();
  store = await H.mkStore({ name: 'Paradise Biryani' });
  store2 = await H.mkStore({ name: 'Chai Point' });
});
test.after(H.teardown);
test.beforeEach(H.dropAds);

const create = async (body) => {
  const res = await H.api('POST', '/api/admin/splash-ads', admin.token, body);
  assert.strictEqual(res.status, 201, JSON.stringify(res.body));
  return res.body;
};
const splash = async () => {
  const res = await H.api('GET', '/api/ads/splash');
  assert.strictEqual(res.status, 200);
  assert.ok(Array.isArray(res.body.ads), 'ads is a list');
  assert.ok(!('ad' in res.body), 'no single-ad shape');
  return res.body.ads;
};
const direct = (extra) => H.ctx.M('SplashAd').create({
  restaurantId: store.id, style: 'scratch', offerText: 'FREE', headline: 'Direct row', imageUrl: 'https://images.unsplash.com/x', isActive: true, ...extra,
});

test('no ad: { ads: [] }', async () => {
  const res = await H.api('GET', '/api/ads/splash');
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body, { ads: [] });
});

test('live ad: public shape, store fields, private fields stripped, at most 2 available products', async () => {
  const s = await H.mkStore({ name: 'Product Kitchen', vendorType: 'LOCAL_VENDOR' });
  await H.mkItem(s.id, { name: 'No Photo Dish', price: 90 });
  await H.mkItem(s.id, { name: 'Photo Dish', price: 120, originalPrice: 160, imageUrl: 'https://images.unsplash.com/dish-1' });
  await H.mkItem(s.id, { name: 'Sold Out', price: 100, isAvailable: false, imageUrl: 'https://images.unsplash.com/dish-2' });
  await H.mkItem(s.id, { name: 'Back In Stock', price: 80, isAvailable: false, outOfStockUntil: new Date(Date.now() - 60000), imageUrl: 'https://images.unsplash.com/dish-3' });
  await H.mkItem(s.id, { name: 'Elite Only', price: 300, isEliteOnly: true, imageUrl: 'https://images.unsplash.com/dish-4' });
  await H.mkItem(s.id, { name: 'Extra Raita', price: 20, specs: { extraFor: ['x'] }, imageUrl: 'https://images.unsplash.com/dish-5' });
  const made = await create(H.adBody(s, { style: 'gift' }));
  assert.strictEqual(made.colorA, '#7d2c12', 'colour stored lower-case');
  assert.strictEqual(made.headline, 'Biryani that\nbreaks the rules');

  const ads = await splash();
  assert.strictEqual(ads.length, 1);
  const ad = ads[0];
  assert.deepStrictEqual(Object.keys(ad).sort(), ['bannerText', 'colorA', 'colorB', 'headline', 'id', 'imageUrl', 'offerText', 'products', 'store', 'style', 'subline'].sort());
  assert.strictEqual(ad.id, made.id);
  assert.strictEqual(ad.style, 'gift');
  assert.strictEqual(ad.offerText, '20% OFF');
  assert.strictEqual(ad.bannerText, 'Sponsored by the kitchen');
  assert.deepStrictEqual(Object.keys(ad.store).sort(), ['cuisine', 'id', 'imageUrl', 'isLocalVendor', 'isOpen', 'name', 'opensAt', 'rating', 'vendorType'].sort());
  assert.strictEqual(ad.store.id, s.id);
  assert.strictEqual(ad.store.name, 'Product Kitchen');
  assert.strictEqual(ad.store.cuisine, 'Biryani · North Indian');
  assert.strictEqual(ad.store.rating, 4.4);
  assert.strictEqual(ad.store.isLocalVendor, true);
  assert.strictEqual(ad.store.vendorType, 'LOCAL_VENDOR');
  assert.strictEqual(typeof ad.store.isOpen, 'boolean');
  const raw = JSON.stringify(ad);
  for (const secret of ['secret@upi', 'ABCDE1234F', 'payout@upi', 'password', 'phone', 'commission', '9000000000']) assert.ok(!raw.includes(secret), `no ${secret}`);

  assert.strictEqual(ad.products.length, 2);
  for (const p of ad.products) assert.deepStrictEqual(Object.keys(p).sort(), ['id', 'imageUrl', 'name', 'originalPrice', 'price']);
  const names = ad.products.map((p) => p.name);
  assert.ok(!names.includes('Sold Out') && !names.includes('Elite Only') && !names.includes('Extra Raita'), names.join());
  assert.ok(!names.includes('No Photo Dish'), 'items with a photo come first');
  const photo = ad.products.find((p) => p.name === 'Photo Dish');
  assert.strictEqual(photo.originalPrice, 160);
  assert.strictEqual(photo.price, 120);
  assert.strictEqual(ad.products.find((p) => p.name === 'Back In Stock').originalPrice, null);
});

test('not served: inactive, expired, future, store inactive (cache dropped by the store change), FSSAI-hidden store', async () => {
  await direct({ style: 'tear', isActive: false });
  await direct({ style: 'scratch', endsAt: new Date(Date.now() - 1000), startsAt: new Date(Date.now() - 86400000) });
  await direct({ style: 'envelope', startsAt: new Date(Date.now() + 3600000) });
  H.r('utils/responseCache').invalidate('ads');
  assert.deepStrictEqual(await splash(), []);

  const s = await H.mkStore({ name: 'Soon Hidden' });
  const ok = await create(H.adBody(s, { style: 'glass', startsAt: new Date(Date.now() - 1000).toISOString(), endsAt: new Date(Date.now() + 86400000).toISOString() }));
  assert.deepStrictEqual((await splash()).map((a) => a.id), [ok.id]);
  await s.update({ isActive: false });
  H.r('controllers/adminController').clearRestaurantsCache(); // what every store write calls
  assert.deepStrictEqual(await splash(), [], 'store hidden -> ad gone at once');
  await s.update({ isActive: true });

  // Receipt setting "hide stores without FSSAI": the ad follows the public store list.
  const rs = H.r('utils/receiptSettings');
  await H.ctx.M('GlobalConfig').create({ key: rs.KEY, value: { hideStoresWithoutFssai: true } });
  rs.clearCache();
  H.r('controllers/adminController').clearRestaurantsCache();
  assert.deepStrictEqual(await splash(), []);
  await s.update({ fssaiLicenseNumber: '12345678901234' });
  H.r('controllers/adminController').clearRestaurantsCache();
  assert.deepStrictEqual((await splash()).map((a) => a.id), [ok.id]);
  await H.ctx.M('GlobalConfig').destroy({ where: { key: rs.KEY } });
  rs.clearCache();
});

test('list: every eligible ad, priority DESC then updatedAt DESC, capped at 8 (one per style)', async () => {
  const low = await create(H.adBody(store, { style: 'tear', priority: 1 }));
  const high = await create(H.adBody(store2, { style: 'scratch', priority: 9 }));
  const mid = await create(H.adBody(store, { style: 'envelope', priority: 5 }));
  const midNewer = await create(H.adBody(store2, { style: 'gift', priority: 5 }));
  assert.deepStrictEqual((await splash()).map((a) => a.id), [high.id, midNewer.id, mid.id, low.id]);

  for (const style of ['glass', 'coupon', 'portal', 'peel']) await create(H.adBody(store, { style }));
  const ads = await splash();
  assert.strictEqual(ads.length, 8);
  assert.deepStrictEqual(new Set(ads.map((a) => a.style)).size, 8);
  // A ninth active ad has no free style left.
  const ninth = await H.api('POST', '/api/admin/splash-ads', admin.token, H.adBody(store2, { style: 'tear' }));
  assert.strictEqual(ninth.status, 409);
});

test('one active ad per style: 409 naming the store; inactive duplicates allowed; activating a duplicate refused', async () => {
  const first = await create(H.adBody(store, { style: 'portal' }));
  const dup = await H.api('POST', '/api/admin/splash-ads', admin.token, H.adBody(store2, { style: 'portal' }));
  assert.strictEqual(dup.status, 409);
  assert.strictEqual(dup.body.code, 'STYLE_IN_USE');
  assert.strictEqual(dup.body.field, 'style');
  assert.strictEqual(dup.body.message, "Style 'portal' is already used by the active ad for Paradise Biryani; pick another style or turn that one off.");

  const off = await create(H.adBody(store2, { style: 'portal', isActive: false }));
  const off2 = await create(H.adBody(store2, { style: 'portal', isActive: false }));
  assert.strictEqual(off.isActive, false);
  assert.ok(off2.id);

  const on = await H.api('PUT', `/api/admin/splash-ads/${off.id}/active`, admin.token, { isActive: true });
  assert.strictEqual(on.status, 409);
  assert.match(on.body.message, /Paradise Biryani/);
  const viaPut = await H.api('PUT', `/api/admin/splash-ads/${off.id}`, admin.token, { isActive: true });
  assert.strictEqual(viaPut.status, 409);
  // Moving an active ad onto a taken style is refused too.
  const other = await create(H.adBody(store2, { style: 'peel' }));
  const move = await H.api('PUT', `/api/admin/splash-ads/${other.id}`, admin.token, { style: 'portal' });
  assert.strictEqual(move.status, 409);

  // Free the style: now the other one can switch on (and saving itself again is not a conflict).
  const pause = await H.api('PUT', `/api/admin/splash-ads/${first.id}/active`, admin.token, {});
  assert.strictEqual(pause.status, 200);
  assert.strictEqual(pause.body.isActive, false, 'no body = flip');
  const on2 = await H.api('PUT', `/api/admin/splash-ads/${off.id}/active`, admin.token, { isActive: true });
  assert.strictEqual(on2.status, 200);
  assert.strictEqual(on2.body.isActive, true);
  const same = await H.api('PUT', `/api/admin/splash-ads/${off.id}`, admin.token, { headline: 'Still portal' });
  assert.strictEqual(same.status, 200);

  // Race guard: the partial unique index refuses a second active row even without the route check.
  await assert.rejects(() => direct({ style: 'portal', restaurantId: store.id }), (e) => e.name === 'SequelizeUniqueConstraintError');
  await direct({ style: 'portal', isActive: false });
});

test('admin validation: style, colours, dates, lengths, image, unknown / hidden store', async () => {
  const bad = async (patch, field, status = 400) => {
    const res = await H.api('POST', '/api/admin/splash-ads', admin.token, H.adBody(store, patch));
    assert.strictEqual(res.status, status, `${JSON.stringify(patch)} -> ${res.status} ${JSON.stringify(res.body)}`);
    if (field) assert.strictEqual(res.body.field, field, JSON.stringify(res.body));
    return res;
  };
  await bad({ style: 'flip' }, 'style');
  await bad({ style: '' }, 'style');
  await bad({ colorA: 'red' }, 'colorA');
  await bad({ colorB: '#12345' }, 'colorB');
  await bad({ colorB: '#gggggg' }, 'colorB');
  await bad({ startsAt: '2030-01-02T00:00:00Z', endsAt: '2030-01-01T00:00:00Z' }, 'endsAt');
  await bad({ startsAt: '2030-01-01T00:00:00Z', endsAt: '2030-01-01T00:00:00Z' }, 'endsAt');
  await bad({ endsAt: new Date(Date.now() - 60000).toISOString() }, 'endsAt');
  await bad({ startsAt: 'not a date' }, 'startsAt');
  await bad({ offerText: 'x'.repeat(25) }, 'offerText');
  await bad({ offerText: '   ' }, 'offerText');
  await bad({ headline: 'a\nb\nc' }, 'headline');
  await bad({ headline: 'x'.repeat(61) }, 'headline');
  await bad({ subline: 'x'.repeat(91) }, 'subline');
  await bad({ bannerText: 'x'.repeat(41) }, 'bannerText');
  await bad({ imageUrl: '' }, 'imageUrl');
  await bad({ imageUrl: 'http://example.com/a.jpg' }, 'imageUrl');
  await bad({ imageUrl: 'javascript:alert(1)' }, 'imageUrl');
  await bad({ priority: 1.5 }, 'priority');
  await bad({ priority: 5000 }, 'priority');
  await bad({ isActive: 'yes' }, 'isActive');
  await bad({ restaurantId: 'nope' }, 'restaurantId');
  await bad({ restaurantId: '6f1c1d38-0000-4000-8000-000000000000' }, 'restaurantId');
  const hidden = await H.mkStore({ name: 'Hidden Store', isActive: false });
  const res = await bad({ restaurantId: hidden.id }, 'restaurantId');
  assert.match(res.body.message, /Hidden Store is hidden/);
  // An inactive draft for a hidden store is fine (it cannot show).
  await create(H.adBody(hidden, { isActive: false }));

  // Trimming, defaults, one-line fields; dates are optional.
  const ok = await create({ restaurantId: store.id, style: 'Coupon', offerText: '  FLAT   ₹50 ', headline: '  Line one \r\n  line two  ', imageUrl: 'https://images.unsplash.com/ok' });
  assert.strictEqual(ok.style, 'coupon');
  assert.strictEqual(ok.offerText, 'FLAT ₹50');
  assert.strictEqual(ok.headline, 'Line one\nline two');
  assert.strictEqual(ok.subline, null);
  assert.strictEqual(ok.bannerText, null);
  assert.strictEqual(ok.colorA, '#7d2c12');
  assert.strictEqual(ok.colorB, '#120805');
  assert.strictEqual(ok.isActive, false, 'off unless switched on');
  assert.strictEqual(ok.startsAt, null);
  assert.strictEqual(ok.endsAt, null);
  assert.strictEqual(ok.priority, 0);

  // An ad whose end passed cannot be switched back on.
  const ended = await direct({ style: 'glass', isActive: false, endsAt: new Date(Date.now() - 1000) });
  const reOn = await H.api('PUT', `/api/admin/splash-ads/${ended.id}/active`, admin.token, { isActive: true });
  assert.strictEqual(reOn.status, 400);
  assert.strictEqual(reOn.body.field, 'endsAt');
});

test('image: own media path stored as an absolute URL; a private upload is refused', async () => {
  const crypto = require('crypto');
  const mkMedia = async (isPrivate) => {
    const bytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(24)]);
    return H.ctx.M('CampusMedia').create({ ownerId: admin.id, purpose: isPrivate ? 'bill' : 'store', mime: 'image/png', size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), isPrivate, bytes });
  };
  const pub = await mkMedia(false);
  const ad = await create(H.adBody(store, { imageUrl: `/api/campus/media/${pub.id}` }));
  assert.match(ad.imageUrl, new RegExp(`^https?://[^/]+/api/campus/media/${pub.id}$`));
  const priv = await mkMedia(true);
  const res = await H.api('POST', '/api/admin/splash-ads', admin.token, H.adBody(store, { style: 'scratch', imageUrl: `/api/campus/media/${priv.id}` }));
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.field, 'imageUrl');
});

test('admin only: 401 without a token, 403 for a student; public read needs no token', async () => {
  for (const [method, url] of [['GET', '/api/admin/splash-ads'], ['POST', '/api/admin/splash-ads'], ['PUT', '/api/admin/splash-ads/6f1c1d38-0000-4000-8000-000000000000'], ['DELETE', '/api/admin/splash-ads/6f1c1d38-0000-4000-8000-000000000000']]) {
    assert.strictEqual((await H.api(method, url, null, method === 'GET' || method === 'DELETE' ? undefined : {})).status, 401, `${method} ${url}`);
    assert.strictEqual((await H.api(method, url, student.token, method === 'GET' || method === 'DELETE' ? undefined : H.adBody(store))).status, 403, `${method} ${url}`);
  }
  assert.strictEqual(await H.ctx.M('SplashAd').count(), 0);
  assert.strictEqual((await H.api('GET', '/api/ads/splash')).status, 200);
});

test('cache: served from cache, dropped on admin update / toggle / delete', async () => {
  const ad = await create(H.adBody(store, { style: 'peel', headline: 'Before' }));
  const a = await H.api('GET', '/api/ads/splash');
  const b = await H.api('GET', '/api/ads/splash');
  assert.strictEqual(a.headers.get('x-cache'), 'MISS');
  assert.strictEqual(b.headers.get('x-cache'), 'HIT');
  assert.strictEqual(b.body.ads[0].headline, 'Before');

  const upd = await H.api('PUT', `/api/admin/splash-ads/${ad.id}`, admin.token, { headline: 'After' });
  assert.strictEqual(upd.status, 200);
  assert.strictEqual((await splash())[0].headline, 'After');

  // A product change (any store write clears the listing caches) shows at once too.
  assert.deepStrictEqual((await splash())[0].products, []);
  await H.mkItem(store.id, { name: 'Fresh Dish', imageUrl: 'https://images.unsplash.com/fresh' });
  assert.deepStrictEqual((await splash())[0].products, [], 'still the cached copy');
  H.r('controllers/adminController').clearRestaurantsCache();
  assert.deepStrictEqual((await splash())[0].products.map((p) => p.name), ['Fresh Dish']);

  const off = await H.api('PUT', `/api/admin/splash-ads/${ad.id}/active`, admin.token, { isActive: false });
  assert.strictEqual(off.status, 200);
  assert.deepStrictEqual(await splash(), []);
  await H.api('PUT', `/api/admin/splash-ads/${ad.id}/active`, admin.token, { isActive: true });
  assert.strictEqual((await splash()).length, 1);
  const del = await H.api('DELETE', `/api/admin/splash-ads/${ad.id}`, admin.token);
  assert.strictEqual(del.status, 200);
  assert.deepStrictEqual(await splash(), []);
});

test('admin list: store name, state, style label; audit rows; unknown ids 404', async () => {
  const live = await create(H.adBody(store, { style: 'tear' }));
  const later = await create(H.adBody(store2, { style: 'scratch', startsAt: new Date(Date.now() + 86400000).toISOString() }));
  await create(H.adBody(store2, { style: 'tear', isActive: false }));
  const res = await H.api('GET', '/api/admin/splash-ads', admin.token);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers.get('cache-control'), 'private, no-store');
  assert.strictEqual(res.body.ads.length, 3);
  const byId = new Map(res.body.ads.map((x) => [x.id, x]));
  assert.deepStrictEqual(byId.get(live.id).store, { id: store.id, name: 'Paradise Biryani', isActive: true });
  assert.strictEqual(byId.get(live.id).state, 'live');
  assert.strictEqual(byId.get(live.id).styleLabel, 'Tear the paper');
  assert.strictEqual(byId.get(later.id).state, 'scheduled');
  assert.strictEqual(res.body.ads.filter((x) => x.state === 'off').length, 1);

  const logs = await H.ctx.M('VerificationLog').findAll({ where: { action: 'SPLASH_AD_CREATED', targetId: String(live.id) } });
  assert.strictEqual(logs.length, 1);
  assert.strictEqual(String(logs[0].adminId), String(admin.id));

  assert.strictEqual((await H.api('PUT', '/api/admin/splash-ads/6f1c1d38-0000-4000-8000-000000000000', admin.token, {})).status, 404);
  assert.strictEqual((await H.api('DELETE', '/api/admin/splash-ads/not-a-uuid', admin.token)).status, 404);
});

test('preview link: admin makes a 15 min link to an inactive ad; the app reads exactly that ad; bad links 410', async () => {
  const ad = await create(H.adBody(store, { style: 'peel', isActive: false }));
  assert.strictEqual((await splash()).length, 0, 'inactive ad is not live');
  const mk = await H.api('POST', `/api/admin/splash-ads/${ad.id}/preview`, admin.token, {});
  assert.strictEqual(mk.status, 200, JSON.stringify(mk.body));
  assert.ok(mk.body.code && mk.body.link.startsWith('zenvy://ad-preview?code='), 'deep link');
  assert.strictEqual(mk.body.expiresInSec, 900);
  const got = await H.api('GET', `/api/ads/preview?code=${encodeURIComponent(mk.body.code)}`);
  assert.strictEqual(got.status, 200, JSON.stringify(got.body));
  assert.strictEqual(got.body.ad.id, ad.id);
  assert.strictEqual(got.body.ad.style, 'peel');
  assert.strictEqual(got.body.ad.store.id, store.id);
  assert.strictEqual((await H.api('GET', '/api/ads/preview?code=nope')).status, 410);
  const tampered = mk.body.code.slice(0, -3) + (mk.body.code.endsWith('aaa') ? 'bbb' : 'aaa');
  assert.strictEqual((await H.api('GET', `/api/ads/preview?code=${encodeURIComponent(tampered)}`)).status, 410);
  assert.strictEqual((await H.api('POST', `/api/admin/splash-ads/${ad.id}/preview`, student.token, {})).status, 403);
  assert.strictEqual((await H.api('POST', `/api/admin/splash-ads/${ad.id}/preview`)).status, 401);
});

test('sample ads removal (owner, 3 Nov 2026: no mock data): the seeded "Sample ad." ads go; one switched on or rewritten stays; once', async () => {
  const { runSampleSplashAdsRemoval, MARKER, SEED_MARKER } = require('../../scripts/sample_splash_ads_remove_v1');
  const GlobalConfig = H.ctx.M('GlobalConfig');
  await GlobalConfig.destroy({ where: { key: [MARKER, SEED_MARKER] } });
  const sample = (style, extra) => direct({ style, isActive: false, subline: 'Sample ad. Tap to see the store.', ...extra });
  const a = await sample('peel');
  const b = await sample('tear');
  const switchedOn = await sample('gift', { isActive: true });
  const rewritten = await sample('glass', { subline: 'Real offer this week' });
  const real = await direct({ style: 'scratch', subline: 'Free delivery today' });
  await GlobalConfig.create({ key: SEED_MARKER, value: { doneAt: 'test', created: [a, b, switchedOn, rewritten].map((x) => ({ id: x.id })) } });
  assert.deepStrictEqual(await runSampleSplashAdsRemoval(), { removed: 2, kept: 2 });
  const left = (await H.ctx.M('SplashAd').findAll({ attributes: ['id'] })).map((x) => x.id).sort();
  assert.deepStrictEqual(left, [switchedOn.id, rewritten.id, real.id].sort());
  assert.deepStrictEqual(await runSampleSplashAdsRemoval(), { skipped: 'already done' });
});
