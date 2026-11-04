require('dotenv').config();
const { connectDB } = require('../config/db');
const { getUserModel } = require('../models/User');
const { getVaultItemModel } = require('../models/VaultItem');
const https = require('https');
const http = require('http');

const SERVICES = [
  { name: 'Backend API', url: process.env.API_URL || 'http://localhost:5005' },
  { name: 'Customer Portal', url: process.env.CUSTOMER_URL || 'http://localhost:3000' },
  { name: 'Delivery Portal', url: process.env.DELIVERY_URL || 'http://localhost:3001' },
  { name: 'Restaurant Portal', url: process.env.RESTAURANT_URL || 'http://localhost:3002' },
  { name: 'Admin Dashboard', url: process.env.ADMIN_URL || 'http://localhost:3003' }
];

async function checkUrl(name, url) {
  return new Promise((resolve) => {
    const protocol = url.startsWith('https') ? https : http;
    const timeout = setTimeout(() => {
      resolve({ name, url, status: 'TIMEOUT ❌', ok: false });
    }, 3000);

    const req = protocol.get(url, (res) => {
      clearTimeout(timeout);
      resolve({ 
        name, 
        url, 
        status: `${res.statusCode} ${res.statusCode < 400 ? '✅' : '⚠️'}`,
        ok: res.statusCode < 400 
      });
    });

    req.on('error', (err) => {
      clearTimeout(timeout);
      resolve({ name, url, status: `ERROR: ${err.message} ❌`, ok: false });
    });
  });
}

async function verify() {
  console.log('\n--- 🛰️  ZENV System Health Scan ---');
  
  // 1. Check Services
  console.log('\n[1/3] Checking Portals & API...');
  const serviceResults = await Promise.all(SERVICES.map(s => checkUrl(s.name, s.url)));
  serviceResults.forEach(r => console.log(`- ${r.name.padEnd(20)}: ${r.status.padEnd(12)} (${r.url})`));

  // 2. Check Database
  console.log('\n[2/3] Checking Database Integrity...');
  try {
    await connectDB();
    const User = getUserModel();
    const VaultItem = getVaultItemModel();
    
    const userCount = await User.count();
    const vaultCount = await VaultItem.count();
    
    console.log(`- DB Connection       : SUCCESS ✅`);
    console.log(`- User Entries        : ${userCount} detected`);
    console.log(`- Vault Items         : ${vaultCount} synchronized`);
  } catch (err) {
    console.error(`- DB Health Check     : FAILED ❌ (${err.message})`);
  }

  // 3. Verify Admin Credentials
  console.log('\n[3/3] Checking Critical Access...');
  try {
    const User = getUserModel();
    const admin = await User.findOne({ where: { role: 'admin' } });
    if (admin) {
      console.log(`- Primary Admin       : DETECTED (${admin.phone}) ✅`);
    } else {
      console.log(`- Primary Admin       : MISSING ❌`);
    }
  } catch {
    console.error(`- Admin Verification  : FAILED ❌`);
  }

  console.log('\n--- Scan Complete ---\n');
  process.exit(0);
}

verify().catch(err => {
  console.error('Fatal verification error:', err);
  process.exit(1);
});
