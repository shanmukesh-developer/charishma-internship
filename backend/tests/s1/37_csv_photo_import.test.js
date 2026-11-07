// CSV / bulk menu import copies photo links into our own media store (7 Nov 2026: Google Drive share links in a
// CSV showed "photo does not load" on every row). Network is stubbed: a fake fetch serves pictures / pages.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers');
const imp = require('../../utils/imageImport');

// Smallest valid PNG header + padding (sniffImage only checks the signature).
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const calls = [];
const respond = (status, body, headers = {}) => new Response(body, { status, headers });

test.before(() => H.setup());
test.before(() => imp._setNetForTests({
  lookup: async (host) => (host === 'internal.example' ? [{ address: '10.0.0.5' }] : [{ address: '93.184.216.34' }]),
  fetch: async (url) => {
    calls.push(url);
    const u = new URL(url);
    if (u.hostname === 'drive.google.com' && u.searchParams.get('id') === 'PUBLICFILE1234') return respond(302, null, { location: 'https://drive.usercontent.google.com/download?id=PUBLICFILE1234' });
    if (u.hostname === 'drive.usercontent.google.com') return respond(200, PNG, { 'content-type': 'image/png' });
    if (u.hostname === 'drive.google.com') return respond(200, '<html>sign in</html>', { 'content-type': 'text/html' });
    if (u.pathname.endsWith('/dish.png')) return respond(200, PNG, { 'content-type': 'image/png' });
    if (u.pathname.endsWith('/to-internal')) return respond(302, null, { location: 'http://internal.example/secret' });
    if (u.pathname.endsWith('/gone.jpg')) return respond(404, 'no');
    return respond(200, '<html>page</html>', { 'content-type': 'text/html' });
  },
}));
test.after(() => imp._setNetForTests(null));
test.after(() => H.teardown());

test('directPhotoLink: Drive share / open links become a direct download; Dropbox gets raw=1', () => {
  assert.strictEqual(imp.directPhotoLink('https://drive.google.com/file/d/PUBLICFILE1234/view?usp=sharing'), 'https://drive.google.com/uc?export=download&id=PUBLICFILE1234');
  assert.strictEqual(imp.directPhotoLink('https://drive.google.com/open?id=PUBLICFILE1234'), 'https://drive.google.com/uc?export=download&id=PUBLICFILE1234');
  assert.match(imp.directPhotoLink('https://www.dropbox.com/s/abc/dish.jpg?dl=0'), /raw=1/);
  assert.strictEqual(imp.directPhotoLink('https://cdn.example.com/dish.png'), 'https://cdn.example.com/dish.png');
});

test('privateIp: loopback, private, link-local and metadata ranges are refused', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '0.0.0.0', '::1', 'fd00::1', '::ffff:127.0.0.1']) assert.ok(imp.privateIp(ip), ip);
  for (const ip of ['93.184.216.34', '8.8.8.8', '2606:4700::1111']) assert.ok(!imp.privateIp(ip), ip);
});

test('bulk import: Drive share link and direct link are saved as our own media; a page / 404 / private redirect names the row', async () => {
  const admin = await H.mkUser({ role: 'admin' });
  const store = await H.mkStore();
  const ok = await H.api('POST', '/api/admin/menu-items/bulk', admin.token, { restaurantId: store.id, items: [
    { name: 'Chicken Tandoori (Half)', price: 270, category: 'Tandoori', imageUrl: 'https://drive.google.com/file/d/PUBLICFILE1234/view?usp=sharing' },
    { name: 'Chicken Tikka', price: 300, category: 'Tandoori', imageUrl: 'https://cdn.example.com/dish.png' },
    { name: 'Plain Rice', price: 80, category: 'Rice' },
  ] });
  assert.strictEqual(ok.status, 201, JSON.stringify(ok.body));
  const items = ok.body.items;
  assert.match(items[0].imageUrl, /\/api\/campus\/media\/[0-9a-f-]{36}$/);
  assert.match(items[1].imageUrl, /\/api\/campus\/media\/[0-9a-f-]{36}$/);
  assert.ok(!items[2].imageUrl);

  const bad = await H.api('POST', '/api/admin/menu-items/bulk', admin.token, { restaurantId: store.id, items: [
    { name: 'A', price: 10, imageUrl: 'https://drive.google.com/file/d/PRIVATEFILE999/view' },
    { name: 'B', price: 10, imageUrl: 'https://cdn.example.com/gone.jpg' },
    { name: 'C', price: 10, imageUrl: 'https://cdn.example.com/to-internal' },
    { name: 'D', price: 10, imageUrl: 'http://127.0.0.1/x.png' },
  ] });
  assert.strictEqual(bad.status, 400);
  const msg = (bad.body.errors || []).map((e) => `${e.index}:${e.message}`);
  assert.strictEqual(msg.length, 4, JSON.stringify(bad.body));
  assert.match(msg[0], /^0:Photo: That link opens a web page/);
  assert.match(msg[1], /^1:Photo: Nothing is at that photo link/);
  assert.match(msg[2], /^2:Photo: That photo link does not point to a public website/);
  assert.match(msg[3], /^3:Photo: That photo link does not point to a public website/);
  assert.ok(!calls.some((u) => u.includes('internal.example') || u.includes('127.0.0.1')), 'never fetched a private address');
});

test('single save: importPhoto=true copies the link (photo for an item already on the menu); without it the link is kept as typed', async () => {
  const admin = await H.mkUser({ role: 'admin' });
  const store = await H.mkStore();
  const item = await H.ctx.M.MenuItem.create({ restaurantId: store.id, name: 'Chicken Green Tikka', price: 300, category: 'Tandoori', isAvailable: true });
  const r = await H.api('POST', `/api/admin/menu-items/${item.id}`, admin.token, { imageUrl: 'https://cdn.example.com/dish.png', importPhoto: true });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  await item.reload();
  assert.match(item.imageUrl, /\/api\/campus\/media\/[0-9a-f-]{36}$/);
  const plain = await H.api('POST', `/api/admin/menu-items/${item.id}`, admin.token, { imageUrl: 'https://cdn.example.com/other.png' });
  assert.strictEqual(plain.status, 200);
  await item.reload();
  assert.strictEqual(item.imageUrl, 'https://cdn.example.com/other.png');
});
