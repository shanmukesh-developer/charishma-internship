// S0 item 9 (unit): shared-cart limits in utils/cartRooms (the live socket path is covered by
// 11_server_sockets.test.js against the real server.js).
const test = require('node:test');
const assert = require('node:assert');
const C = require('../../utils/cartRooms');

test('room codes: new 10-character codes and older 4-8 character codes accepted, junk refused', () => {
  for (const ok of ['ZN-ABCD', 'ZN-8B2A4KQ7', 'ZN-8B2A4KQ7XM']) assert.ok(C.CODE_RE.test(ok), ok);
  for (const bad of ['ZN-ABC', 'ZN-ABCDEFGHIJKLM', 'zn-abcd', 'ZN-AB CD', 'admin-room', 'ZN-ABCD\n']) assert.ok(!C.CODE_RE.test(bad), bad);
});

test('sanitizeCart: whitelisted fields, bounded quantity / strings, 100 items, 32 KB', () => {
  const out = C.sanitizeCart([
    { id: 'm1', name: 'Dosa', quantity: 2, price: '45', restaurantId: 'r1', restaurantName: 'Cafe', cartKey: 'm1-x', image: 'https://cdn.example/d.png', customizations: { size: 'L', toppings: ['a', 'b'], evil: { nested: 1 } }, addedBy: 'Sam', __proto__x: 1, password: 'nope', html: '<script>' },
    { id: 'm2', name: 'x'.repeat(500), quantity: 9999 },
    { id: 'm3', name: 'Img', image: 'javascript:alert(1)' },
    { name: 'no id' },
    'junk',
    null,
  ]);
  assert.strictEqual(out.length, 3);
  assert.deepStrictEqual(Object.keys(out[0]).sort(), ['addedBy', 'cartKey', 'customizations', 'id', 'image', 'name', 'price', 'qty', 'quantity', 'restaurantId', 'restaurantName'].sort());
  assert.strictEqual(out[0].price, 45);
  assert.deepStrictEqual(out[0].customizations, { size: 'L', toppings: ['a', 'b'] });
  assert.strictEqual(out[1].name.length, 80);
  assert.strictEqual(out[1].quantity, 1, 'quantity outside 1-50 falls back to 1');
  assert.strictEqual(out[2].image, undefined, 'unsafe image link dropped');
  assert.strictEqual(C.sanitizeCart('not a cart'), null);
  const many = Array.from({ length: 500 }, (_, i) => ({ id: `i${i}`, name: `Item ${i}` }));
  assert.strictEqual(C.sanitizeCart(many).length, 100);
  const fat = Array.from({ length: 100 }, (_, i) => ({ id: `i${i}`.padEnd(60, 'x'), name: 'n'.repeat(80), restaurantName: 'r'.repeat(80), image: `https://cdn.example/${'p'.repeat(400)}` }));
  assert.strictEqual(C.sanitizeCart(fat), null, 'over 32 KB refused');
});

test('token bucket: burst then ~5 per second', () => {
  const s = {};
  const t0 = 1000000;
  let ok = 0;
  for (let i = 0; i < 50; i++) if (C.takeToken(s, t0)) ok++;
  assert.strictEqual(ok, C.BURST);
  assert.strictEqual(C.takeToken(s, t0 + 100), false);
  assert.strictEqual(C.takeToken(s, t0 + 1000), true, 'refilled after 1 s');
});

test('join budget: 20 joins / 10 min per socket and per IP (brute-forcing codes stops)', () => {
  C.resetJoins();
  const now = 5000000;
  const sock = (id, ip) => ({ id, handshake: { address: ip, headers: {} } });
  const s1 = sock('a', '10.0.0.1');
  let allowed = 0;
  for (let i = 0; i < 30; i++) if (C.joinAllowed(s1, now + i)) allowed++;
  assert.strictEqual(allowed, C.JOIN_MAX);
  // a fresh socket from the same IP is still limited
  assert.strictEqual(C.joinAllowed(sock('b', '10.0.0.1'), now + 50), false);
  // another IP is fine; after the window it works again
  assert.strictEqual(C.joinAllowed(sock('c', '10.0.0.2'), now + 50), true);
  assert.strictEqual(C.joinAllowed(sock('d', '10.0.0.1'), now + C.JOIN_WINDOW_MS + 100), true);
  // the proxy-added (rightmost) X-Forwarded-For hop counts, not a spoofed first one
  assert.strictEqual(C.socketIp({ handshake: { address: '1.1.1.1', headers: { 'x-forwarded-for': '6.6.6.6, 9.9.9.9' } } }), '9.9.9.9');
  C.resetJoins();
});

test('registry: LRU cap evicts idle rooms only, snapshot TTL, sweep forgets never-snapshotted rooms', () => {
  const live = new Set(['busy']);
  const reg = C.createRegistry({ liveSize: (r) => (live.has(r) ? 1 : 0), maxRooms: 3, ttlMs: 1000 });
  assert.ok(reg.open('busy'));
  assert.ok(reg.open('a'));
  assert.ok(reg.open('b'));
  assert.ok(reg.open('c'), 'evicts the oldest idle room');
  assert.ok(!reg.members.has('a'));
  assert.ok(reg.members.has('busy'), 'a room with live sockets is never evicted');
  live.add('b'); live.add('c');
  assert.strictEqual(reg.open('d'), false, 'full of live rooms -> refused');
  reg.save('c', [{ id: 'x', name: 'y', quantity: 1 }], 10000);
  assert.ok(reg.snapshot('c', 10500));
  assert.strictEqual(reg.snapshot('c', 11500), null, 'snapshot expires after the TTL');
  live.clear();
  reg.save('b', [], 20000);
  reg.sweep(20100);
  assert.ok(!reg.members.has('busy') && !reg.members.has('c'), 'never / no longer snapshotted idle rooms dropped');
  assert.ok(reg.members.has('b'), 'fresh snapshot kept for late joiners');
  reg.sweep(30000);
  assert.strictEqual(reg.members.size, 0);
});
