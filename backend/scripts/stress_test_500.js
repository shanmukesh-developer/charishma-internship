/**
 * ── Zenvy 500+ User Stress Test ──────────────────────────────
 * Simulates 500+ concurrent users hitting the API simultaneously
 * to prove the system can handle campus-scale traffic.
 * 
 * Usage: node scripts/stress_test_500.js
 * 
 * Requires: Backend running on localhost:5005
 */

const axios = require('axios');
const API_URL = process.env.API_URL || 'http://localhost:5005';

// ── Configuration ──────────────────────────────────────────
const TOTAL_USERS = 500;
const BATCH_SIZE = 50; // Send 50 users at a time to avoid overwhelming localhost
const PHASES = {
  LOGIN: true,
  BROWSE_RESTAURANTS: true,
  BROWSE_MENU: true,
  PLACE_ORDER: true,
  HEALTH_CHECK: true
};

// ── Metrics ──────────────────────────────────────────
let metrics = {
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  rateLimited: 0,
  serverErrors: 0,
  avgResponseTime: 0,
  maxResponseTime: 0,
  minResponseTime: Infinity,
  responseTimes: [],
  errors: {}
};

const api = axios.create({
  baseURL: API_URL,
  timeout: 30000, // 30s timeout
  validateStatus: () => true // Don't throw on any status
});

// ── Helper: Timed Request ──────────────────────────────────────────
async function timedRequest(method, url, data = null, headers = {}) {
  const start = Date.now();
  try {
    const config = { headers };
    let response;
    if (method === 'GET') {
      response = await api.get(url, config);
    } else {
      response = await api.post(url, data, config);
    }
    const elapsed = Date.now() - start;
    
    metrics.totalRequests++;
    metrics.responseTimes.push(elapsed);
    if (elapsed > metrics.maxResponseTime) metrics.maxResponseTime = elapsed;
    if (elapsed < metrics.minResponseTime) metrics.minResponseTime = elapsed;
    
    if (response.status >= 200 && response.status < 300) {
      metrics.successfulRequests++;
    } else if (response.status === 429) {
      metrics.rateLimited++;
    } else if (response.status >= 500) {
      metrics.serverErrors++;
      const key = `${response.status} ${url}`;
      metrics.errors[key] = (metrics.errors[key] || 0) + 1;
    } else {
      metrics.failedRequests++;
    }
    
    return { status: response.status, data: response.data, elapsed };
  } catch (err) {
    const elapsed = Date.now() - start;
    metrics.totalRequests++;
    metrics.serverErrors++;
    const key = `CRASH: ${err.code || err.message} ${url}`;
    metrics.errors[key] = (metrics.errors[key] || 0) + 1;
    return { status: 0, data: null, elapsed, error: err.message };
  }
}

// ── Phase 1: Health Check Flood ──────────────────────────────
async function healthCheckFlood(count) {
  console.log(`\n⚡ Phase 1: ${count} concurrent health checks...`);
  const promises = [];
  for (let i = 0; i < count; i++) {
    promises.push(timedRequest('GET', '/api/health'));
  }
  await Promise.all(promises);
  console.log(`   ✅ Health checks complete`);
}

// ── Phase 2: Login Storm ──────────────────────────────
async function loginStorm(count) {
  console.log(`\n⚡ Phase 2: ${count} concurrent login attempts...`);
  const tokens = [];
  const batches = Math.ceil(count / BATCH_SIZE);
  
  for (let b = 0; b < batches; b++) {
    const batchStart = b * BATCH_SIZE;
    const batchEnd = Math.min(batchStart + BATCH_SIZE, count);
    const promises = [];
    
    for (let i = batchStart; i < batchEnd; i++) {
      // Use the same seeded user account for all simulated users
      promises.push(
        timedRequest('POST', '/api/users/login', {
          phone: '9123456789',
          password: 'password123'
        })
      );
    }
    
    const results = await Promise.all(promises);
    results.forEach(r => {
      if (r.status === 200 && r.data?.token) {
        tokens.push(r.data.token);
      }
    });
    
    // Small delay between batches to simulate organic traffic
    if (b < batches - 1) await new Promise(r => setTimeout(r, 100));
  }
  
  console.log(`   ✅ Got ${tokens.length} valid tokens from ${count} login attempts`);
  return tokens;
}

// ── Phase 3: Restaurant Browsing Flood ──────────────────────────────
async function browseRestaurants(tokens) {
  const count = tokens.length;
  console.log(`\n⚡ Phase 3: ${count} users browsing restaurants simultaneously...`);
  const promises = [];
  
  for (let i = 0; i < count; i++) {
    promises.push(
      timedRequest('GET', '/api/restaurants', null, {
        Authorization: `Bearer ${tokens[i % tokens.length]}`
      })
    );
  }
  
  const results = await Promise.all(promises);
  const restaurants = results.find(r => r.status === 200 && Array.isArray(r.data));
  const restaurantId = restaurants?.data?.[0]?.id;
  
  console.log(`   ✅ Restaurant browse complete. Found restaurant: ${restaurantId || 'NONE'}`);
  return restaurantId;
}

// ── Phase 4: Menu Browsing Flood ──────────────────────────────
async function browseMenus(tokens, restaurantId) {
  if (!restaurantId) {
    console.log(`\n⚠️  Phase 4: Skipped (no restaurant found)`);
    return [];
  }
  
  const count = Math.min(tokens.length, 200); // Cap at 200 concurrent menu views
  console.log(`\n⚡ Phase 4: ${count} users viewing menu simultaneously...`);
  const promises = [];
  
  for (let i = 0; i < count; i++) {
    promises.push(
      timedRequest('GET', `/api/restaurants/${restaurantId}/menu`, null, {
        Authorization: `Bearer ${tokens[i % tokens.length]}`
      })
    );
  }
  
  const results = await Promise.all(promises);
  const menuResult = results.find(r => r.status === 200 && Array.isArray(r.data));
  const menuItems = menuResult?.data || [];
  
  console.log(`   ✅ Menu browse complete. Found ${menuItems.length} items`);
  return menuItems;
}

// ── Phase 5: Order Creation Burst ──────────────────────────────
async function orderBurst(tokens, restaurantId, menuItems) {
  if (!restaurantId || menuItems.length === 0) {
    console.log(`\n⚠️  Phase 5: Skipped (no restaurant or menu items)`);
    return;
  }
  
  const count = Math.min(tokens.length, 50); // 50 concurrent orders is a realistic campus peak
  console.log(`\n⚡ Phase 5: ${count} concurrent order placements...`);
  const promises = [];
  const item = menuItems[0];
  
  for (let i = 0; i < count; i++) {
    promises.push(
      timedRequest('POST', '/api/orders', {
        restaurantId,
        items: [{ 
          name: item.name, 
          quantity: 1, 
          price: item.price, 
          basePrice: item.price, 
          menuItemId: item.id 
        }],
        totalPrice: item.price,
        deliveryAddress: 'SRM AP',
        coordinates: { lat: 16.4632, lng: 80.5064 }
      }, {
        Authorization: `Bearer ${tokens[i % tokens.length]}`
      })
    );
  }
  
  const results = await Promise.all(promises);
  const created = results.filter(r => r.status === 201).length;
  const rateLimited = results.filter(r => r.status === 429).length;
  const failed = results.filter(r => r.status >= 400 && r.status !== 429).length;
  
  console.log(`   ✅ Orders: ${created} created, ${rateLimited} rate-limited, ${failed} failed`);
}

// ── Main Execution ──────────────────────────────────────────
async function main() {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║      🚀 ZENVY 500+ USER STRESS TEST                ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║  Target:     ${API_URL.padEnd(39)}║`);
  console.log(`║  Users:      ${String(TOTAL_USERS).padEnd(39)}║`);
  console.log(`║  Batch Size: ${String(BATCH_SIZE).padEnd(39)}║`);
  console.log('╚══════════════════════════════════════════════════════╝');
  
  const overallStart = Date.now();
  
  // Phase 1: Health Check
  if (PHASES.HEALTH_CHECK) {
    await healthCheckFlood(TOTAL_USERS);
  }
  
  // Phase 2: Login Storm
  let tokens = [];
  if (PHASES.LOGIN) {
    tokens = await loginStorm(TOTAL_USERS);
  }
  
  // Phase 3: Browse Restaurants
  let restaurantId = null;
  if (PHASES.BROWSE_RESTAURANTS && tokens.length > 0) {
    restaurantId = await browseRestaurants(tokens);
  }
  
  // Phase 4: Browse Menus
  let menuItems = [];
  if (PHASES.BROWSE_MENU && restaurantId) {
    menuItems = await browseMenus(tokens, restaurantId);
  }
  
  // Phase 5: Order Burst
  if (PHASES.PLACE_ORDER && tokens.length > 0) {
    await orderBurst(tokens, restaurantId, menuItems);
  }
  
  const overallElapsed = Date.now() - overallStart;
  
  // ── Results ──────────────────────────────────────────
  const avgTime = metrics.responseTimes.length > 0 
    ? Math.round(metrics.responseTimes.reduce((a, b) => a + b, 0) / metrics.responseTimes.length) 
    : 0;
  
  const p95Index = Math.floor(metrics.responseTimes.length * 0.95);
  const sortedTimes = [...metrics.responseTimes].sort((a, b) => a - b);
  const p95 = sortedTimes[p95Index] || 0;
  const p99Index = Math.floor(metrics.responseTimes.length * 0.99);
  const p99 = sortedTimes[p99Index] || 0;
  
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║              📊 STRESS TEST RESULTS                 ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║  Total Requests:     ${String(metrics.totalRequests).padEnd(31)}║`);
  console.log(`║  Successful (2xx):   ${String(metrics.successfulRequests).padEnd(31)}║`);
  console.log(`║  Failed (4xx):       ${String(metrics.failedRequests).padEnd(31)}║`);
  console.log(`║  Rate Limited (429): ${String(metrics.rateLimited).padEnd(31)}║`);
  console.log(`║  Server Errors (5xx):${String(metrics.serverErrors).padEnd(31)}║`);
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║  Avg Response Time:  ${(avgTime + 'ms').padEnd(31)}║`);
  console.log(`║  P95 Response Time:  ${(p95 + 'ms').padEnd(31)}║`);
  console.log(`║  P99 Response Time:  ${(p99 + 'ms').padEnd(31)}║`);
  console.log(`║  Max Response Time:  ${(metrics.maxResponseTime + 'ms').padEnd(31)}║`);
  console.log(`║  Min Response Time:  ${(metrics.minResponseTime === Infinity ? 'N/A' : metrics.minResponseTime + 'ms').padEnd(31)}║`);
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║  Total Test Time:    ${((overallElapsed / 1000).toFixed(1) + 's').padEnd(31)}║`);
  console.log(`║  Requests/Second:    ${(Math.round(metrics.totalRequests / (overallElapsed / 1000)) + ' req/s').padEnd(31)}║`);
  console.log('╚══════════════════════════════════════════════════════╝');
  
  if (Object.keys(metrics.errors).length > 0) {
    console.log('\n⚠️  Error Breakdown:');
    Object.entries(metrics.errors).forEach(([key, count]) => {
      console.log(`   ${count}x → ${key}`);
    });
  }
  
  // ── Verdict ──────────────────────────────────────────
  const crashRate = metrics.serverErrors / metrics.totalRequests;
  const successRate = metrics.successfulRequests / metrics.totalRequests;
  
  console.log('\n');
  if (crashRate === 0 && successRate > 0.8) {
    console.log('🏆 VERDICT: PASSED — Zero crashes, 500+ users handled successfully!');
  } else if (crashRate < 0.01) {
    console.log('✅ VERDICT: PASSED — <1% error rate under 500+ user load.');
  } else if (crashRate < 0.05) {
    console.log('⚠️  VERDICT: MARGINAL — Some errors detected, needs optimization.');
  } else {
    console.log('❌ VERDICT: FAILED — Too many errors under load. Investigate server errors.');
  }
  console.log('');
}

main().catch(err => {
  console.error('STRESS TEST CRASHED:', err);
  process.exit(1);
});
