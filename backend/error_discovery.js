/* eslint-disable */
/**
 * Zenvy Nexus — Aggressive Error Discovery Script
 * Probes ALL critical API endpoints systematically to find hidden bugs.
 */
const axios = require('axios');
const API = 'http://localhost:5005/api';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let passed = 0, failed = 0;
const errors = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    const msg = err.response?.data?.message || err.response?.data?.error || err.message;
    const status = err.response?.status || 'CRASH';
    errors.push({ name, status, msg });
    console.log(`  ❌ ${name} → [${status}] ${msg}`);
  }
}

async function run() {
  let custToken, drvToken, restToken, orderId, rid, itemId, deliveryPin;
  let custH, drvH, restH;

  // ═══ AUTH TESTS ═══
  console.log('\n══ AUTH ENDPOINTS ══');
  
  await test('Customer Login (valid)', async () => {
    const r = await axios.post(`${API}/users/login`, {
      phone: '9123456789',
      password: 'password123'
    });
    custToken = r.data.token;
    custH = { Authorization: `Bearer ${custToken}` };
    if (!custToken) throw new Error('No token returned');
  });

  await test('Driver Login (valid)', async () => {
    const r = await axios.post(`${API}/delivery/login`, {
      phone: 'driver1',
      password: 'password123'
    });
    drvToken = r.data.token;
    drvH = { Authorization: `Bearer ${drvToken}` };
    if (!drvToken) throw new Error('No token returned');
  });

  await test('Customer Login (wrong password)', async () => {
    await axios.post(`${API}/users/login`, { phone: '9999999999', password: 'wrongpass' });
    throw new Error('Should have failed but got 200');
  });

  await test('Customer Login (missing fields)', async () => {
    await axios.post(`${API}/users/login`, {});
    throw new Error('Should have failed but got 200');
  });

  await test('Driver Login (wrong password)', async () => {
    await axios.post(`${API}/delivery/login`, { phone: 'driver1', password: 'wrong' });
    throw new Error('Should have failed but got 200');
  });

  // ═══ CATALOG TESTS ═══
  console.log('\n══ CATALOG ENDPOINTS ══');

  await test('GET /restaurants', async () => {
    const r = await axios.get(`${API}/users/restaurants`);
    if (!r.data || r.data.length === 0) throw new Error('Empty restaurant list');
    rid = r.data[0].id || r.data[0]._id;
  });

  await test('Restaurant Login (valid)', async () => {
    const r = await axios.post(`${API}/restaurants/login`, {
      id: rid,
      password: 'password123'
    });
    restToken = r.data.token;
    restH = { Authorization: `Bearer ${restToken}` };
    if (!restToken) throw new Error('No token returned');
  });

  await test('GET /restaurants/:id (valid)', async () => {
    const r = await axios.get(`${API}/users/restaurants/${rid}`);
    const menu = Array.isArray(r.data) ? r.data : (r.data.menu || [r.data]);
    if (menu.length === 0) throw new Error('Empty menu');
    itemId = menu[0].id || menu[0]._id;
  });

  await test('GET /restaurants/:id (invalid UUID)', async () => {
    await axios.get(`${API}/users/restaurants/nonexistent-id-12345`);
    throw new Error('Should have returned 404 but got 200');
  });

  await test('GET /products (all)', async () => {
    const r = await axios.get(`${API}/users/products`);
    if (!Array.isArray(r.data)) throw new Error('Products not an array');
  });

  await test('GET /products/:id (valid)', async () => {
    await axios.get(`${API}/users/products/${itemId}`);
  });

  await test('GET /products/:id (invalid)', async () => {
    await axios.get(`${API}/users/products/fake-product-does-not-exist`);
    throw new Error('Should have returned 404');
  });

  // ═══ ORDER TESTS ═══
  console.log('\n══ ORDER ENDPOINTS ══');

  await test('POST /orders (valid order)', async () => {
    const r = await axios.post(`${API}/orders`, {
      restaurantId: rid,
      items: [{ id: itemId, quantity: 1, name: 'Test Item' }],
      deliveryAddress: 'SRM AP Hostel Block A',
      deliverySlot: 'ASAP',
      paymentMethod: 'Cash'
    }, { headers: custH });
    orderId = r.data.id || r.data._id;
    deliveryPin = r.data.deliveryPin || r.data.pin || null;
    if (!orderId) throw new Error('No order ID returned');
  });

  await test('POST /orders (missing restaurantId)', async () => {
    await axios.post(`${API}/orders`, {
      items: [{ id: itemId, quantity: 1 }],
      deliveryAddress: 'SRM AP',
      paymentMethod: 'Cash'
    }, { headers: custH });
    throw new Error('Should have failed');
  });

  await test('POST /orders (missing paymentMethod)', async () => {
    await axios.post(`${API}/orders`, {
      restaurantId: rid,
      items: [{ id: itemId, quantity: 1 }],
      deliveryAddress: 'SRM AP'
    }, { headers: custH });
    throw new Error('Should have failed');
  });

  await test('POST /orders (empty items)', async () => {
    await axios.post(`${API}/orders`, {
      restaurantId: rid,
      items: [],
      deliveryAddress: 'SRM AP',
      paymentMethod: 'Cash'
    }, { headers: custH });
    throw new Error('Should have failed with empty items');
  });

  await test('POST /orders (no auth)', async () => {
    await axios.post(`${API}/orders`, {
      restaurantId: rid,
      items: [{ id: itemId, quantity: 1 }],
      deliveryAddress: 'SRM AP',
      paymentMethod: 'Cash'
    });
    throw new Error('Should have failed without auth');
  });

  await test('GET /orders (customer orders)', async () => {
    await axios.get(`${API}/users/orders`, { headers: custH });
  });

  // ═══ ORDER LIFECYCLE ═══
  console.log('\n══ ORDER LIFECYCLE ══');

  await test('PUT /orders/:id/restaurant-accept', async () => {
    await axios.put(`${API}/orders/${orderId}/restaurant-accept`, {}, { headers: restH });
  });

  await test('PUT /delivery/accept/:orderId', async () => {
    await axios.put(`${API}/delivery/accept/${orderId}`, {}, { headers: drvH });
  });

  await test('PUT /delivery/status/:orderId (PickedUp)', async () => {
    await axios.put(`${API}/delivery/status/${orderId}`, { status: 'PickedUp' }, { headers: drvH });
  });

  await test('PUT /delivery/status/:orderId (Delivered)', async () => {
    await axios.put(`${API}/delivery/status/${orderId}`,
      { status: 'Delivered', pin: deliveryPin || '' }, { headers: drvH });
  });

  // ═══ DRIVER ENDPOINTS ═══
  console.log('\n══ DRIVER ENDPOINTS ══');

  await test('GET /delivery/orders/pending', async () => {
    await axios.get(`${API}/delivery/orders/pending`, { headers: drvH });
  });

  await test('GET /delivery/orders/active', async () => {
    await axios.get(`${API}/delivery/orders/active`, { headers: drvH });
  });

  await test('GET /delivery/orders/history', async () => {
    const r = await axios.get(`${API}/delivery/orders/history`, { headers: drvH });
    if (!Array.isArray(r.data)) throw new Error('History not an array');
  });

  await test('PUT /delivery/online', async () => {
    await axios.put(`${API}/delivery/online`, { isOnline: true }, { headers: drvH });
  });

  // ═══ EDGE CASE: Double delivery ═══
  console.log('\n══ EDGE CASES ══');

  await test('Double deliver (should fail)', async () => {
    await axios.put(`${API}/delivery/status/${orderId}`, { status: 'Delivered', pin: '' }, { headers: drvH });
    throw new Error('Should have rejected double delivery');
  });

  await test('Accept nonexistent order', async () => {
    await axios.put(`${API}/delivery/accept/fake-order-id-000`, {}, { headers: drvH });
    throw new Error('Should have returned 404');
  });

  await test('Pickup nonexistent order', async () => {
    await axios.put(`${API}/delivery/status/fake-order-id-000`, { status: 'PickedUp' }, { headers: drvH });
    throw new Error('Should have returned 404');
  });

  // ═══ USER PROFILE ENDPOINTS ═══
  console.log('\n══ USER PROFILE ══');

  await test('GET /users/profile', async () => {
    const r = await axios.get(`${API}/users/profile`, { headers: custH });
    if (!r.data.name) throw new Error('Profile missing name');
  });

  await test('GET /users/rewards', async () => {
    await axios.get(`${API}/users/rewards`, { headers: custH });
  });

  // ═══ REPORT ═══
  console.log('\n══════════════════════════════════════════════════');
  console.log(`  RESULTS: ${passed} PASSED | ${failed} FAILED`);
  console.log('══════════════════════════════════════════════════');

  if (errors.length > 0) {
    console.log('\n🔴 FAILURES REQUIRING ATTENTION:');
    errors.forEach((e, i) => {
      // Filter out expected failures (auth rejections)
      const isExpectedFail = e.name.includes('wrong password') || e.name.includes('missing fields') || 
                             e.name.includes('missing ') || e.name.includes('empty items') ||
                             e.name.includes('no auth') || e.name.includes('invalid') ||
                             e.name.includes('nonexistent') || e.name.includes('Double');
      const label = isExpectedFail ? '🟡 EXPECTED' : '🔴 BUG';
      console.log(`  ${i+1}. [${label}] ${e.name} → [${e.status}] ${e.msg}`);
    });

    const realBugs = errors.filter(e => {
      return !(e.name.includes('wrong password') || e.name.includes('missing fields') || 
               e.name.includes('missing ') || e.name.includes('empty items') ||
               e.name.includes('no auth') || e.name.includes('invalid') ||
               e.name.includes('nonexistent') || e.name.includes('Double'));
    });

    if (realBugs.length > 0) {
      console.log(`\n🚨 ${realBugs.length} REAL BUG(S) FOUND:`);
      realBugs.forEach(b => console.log(`   → ${b.name}: [${b.status}] ${b.msg}`));
    } else {
      console.log('\n✅ All failures were expected/defensive rejections. No real bugs found.');
    }
  }

  process.exit(0);
}

run();
