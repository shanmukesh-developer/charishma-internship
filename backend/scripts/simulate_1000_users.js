const axios = require('axios');
const http = require('http');
const bcrypt = require('bcryptjs');
const { connectDB } = require('../config/db');
const { getUserModel } = require('../models/User');

const API_URL = 'http://localhost:5005';
const CONCURRENCY = 1000;

// Setup HTTP Keep-Alive Agent to prevent local client-side port exhaustion
const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 2000,
  maxFreeSockets: 256,
  timeout: 60000,
});

const api = axios.create({
  baseURL: API_URL,
  httpAgent,
  validateStatus: () => true,
  timeout: 15000 // 15 seconds timeout
});

async function runLoadTest() {
  console.log('📦 Connecting to database to seed load-test users...');
  await connectDB();
  const User = getUserModel();

  console.log('🧹 Cleaning up previous load test users...');
  const { Op } = require('sequelize');
  await User.destroy({
    where: {
      name: { [Op.like]: 'LoadTestUser_%' }
    }
  });

  console.log('🔑 Generating password hash...');
  const passwordHash = bcrypt.hashSync('password123', 10);

  console.log(`👤 Seeding ${CONCURRENCY} unique users...`);
  const usersToCreate = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    const paddedIndex = String(i).padStart(4, '0');
    usersToCreate.push({
      name: `LoadTestUser_${paddedIndex}`,
      phone: `9999${paddedIndex}`,
      password: passwordHash,
      hostelBlock: 'OM',
      roomNumber: '101'
    });
  }

  // Bulk create all users in a single operation
  const startSeed = Date.now();
  await User.bulkCreate(usersToCreate, { hooks: false });
  console.log(`✅ Seeded ${CONCURRENCY} users in ${((Date.now() - startSeed) / 1000).toFixed(2)}s`);

  console.log(`\n🚀 Rushing ${CONCURRENCY} users simultaneously to perform operations...`);
  console.log('Operations per user: Login -> Fetch Profile -> Search Catalog ("Biryani")\n');

  const stats = {
    login: { success: 0, fail: 0, latencies: [] },
    profile: { success: 0, fail: 0, latencies: [] },
    search: { success: 0, fail: 0, latencies: [] },
    errors: {}
  };

  const trackError = (phase, status, message) => {
    const key = `[${phase}] Status ${status}: ${message}`;
    stats.errors[key] = (stats.errors[key] || 0) + 1;
  };

  const runUserSession = async (index) => {
    const paddedIndex = String(index).padStart(4, '0');
    const phone = `9999${paddedIndex}`;
    const password = 'password123';
    let token = '';

    try {
      // Phase 1: Login
      const t0 = Date.now();
      const loginRes = await api.post('/api/users/login', { phone, password });
      const t1 = Date.now();
      stats.login.latencies.push(t1 - t0);

      if (loginRes.status === 200 && loginRes.data.token) {
        stats.login.success++;
        token = loginRes.data.token;
      } else {
        stats.login.fail++;
        trackError('Login', loginRes.status, loginRes.data?.message || loginRes.message || 'Unknown Error');
        return; // Stop if login fails
      }

      const headers = { Authorization: `Bearer ${token}` };

      // Phase 2: Fetch Profile
      const t2 = Date.now();
      const profileRes = await api.get('/api/users/profile', { headers });
      const t3 = Date.now();
      stats.profile.latencies.push(t3 - t2);

      if (profileRes.status === 200) {
        stats.profile.success++;
      } else {
        stats.profile.fail++;
        trackError('Profile', profileRes.status, profileRes.data?.message || profileRes.message || 'Unknown Error');
      }

      // Phase 3: Global Catalog Search
      const t4 = Date.now();
      const searchRes = await api.get('/api/users/search?q=Biryani', { headers });
      const t5 = Date.now();
      stats.search.latencies.push(t5 - t4);

      if (searchRes.status === 200) {
        stats.search.success++;
      } else {
        stats.search.fail++;
        trackError('Search', searchRes.status, searchRes.data?.message || searchRes.message || 'Unknown Error');
      }
    } catch (err) {
      const errMsg = err.response?.data?.message || err.message || 'Network/Socket Error';
      const status = err.response?.status || err.code || 'ERROR';
      trackError('Session_Fatal', status, errMsg);
      stats.login.fail++;
    }
  };

  const startTest = Date.now();
  
  // Launch concurrent sessions with active concurrency throttling (100 parallel workers)
  const limit = 100;
  const tasks = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    tasks.push(() => runUserSession(i));
  }

  const limitConcurrency = async (taskList, concurrencyLimit) => {
    const results = [];
    const executing = [];
    for (const task of taskList) {
      const p = Promise.resolve().then(() => task());
      results.push(p);
      if (concurrencyLimit <= taskList.length) {
        const e = p.then(() => executing.splice(executing.indexOf(e), 1));
        executing.push(e);
        if (executing.length >= concurrencyLimit) {
          await Promise.race(executing);
        }
      }
    }
    return Promise.all(results);
  };

  await limitConcurrency(tasks, limit);
  const endTest = Date.now();

  const totalTimeSec = (endTest - startTest) / 1000;

  // Calculate statistics helper
  const getLatencyStats = (latencies) => {
    if (latencies.length === 0) return { avg: 0, min: 0, max: 0, p95: 0, p99: 0 };
    const sorted = [...latencies].sort((a, b) => a - b);
    const sum = sorted.reduce((acc, v) => acc + v, 0);
    const avg = sum / sorted.length;
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const p99 = sorted[Math.floor(sorted.length * 0.99)];
    return { avg, min, max, p95, p99 };
  };

  console.log('══════════════════════════════════════════════════');
  console.log(`🏆 Stress Test Complete (Total Time: ${totalTimeSec.toFixed(2)}s)`);
  console.log(`📊 Throughput: ${(CONCURRENCY / totalTimeSec).toFixed(1)} users/sec (${((CONCURRENCY * 3) / totalTimeSec).toFixed(1)} operations/sec)`);
  console.log('══════════════════════════════════════════════════');

  const phases = ['login', 'profile', 'search'];
  for (const phase of phases) {
    const pStats = stats[phase];
    const l = getLatencyStats(pStats.latencies);
    console.log(`\n🔹 Phase: ${phase.toUpperCase()}`);
    console.log(`   Success: ${pStats.success} | Failed: ${pStats.fail}`);
    console.log(`   Latency: Avg: ${l.avg.toFixed(1)}ms | Min: ${l.min}ms | Max: ${l.max}ms | p95: ${l.p95}ms | p99: ${l.p99}ms`);
  }

  if (Object.keys(stats.errors).length > 0) {
    console.log('\n🔴 Errors Logged During Test:');
    for (const [err, count] of Object.entries(stats.errors)) {
      console.log(`   - ${err}: occurred ${count} times`);
    }
  } else {
    console.log('\n🟢 Zero errors logged! The server handled the load flawlessly.');
  }

  process.exit(0);
}

runLoadTest().catch(err => {
  console.error('Fatal load test error:', err);
  process.exit(1);
});
