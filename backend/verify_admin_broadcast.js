const io = require('socket.io-client');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const API_URL = 'http://localhost:5005';
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_zenvy_token_2026';

async function verify() {
  console.log('--- Phase 2: Admin -> Customer Portal Real-Time Verification ---');

  // 1. Create tokens
  const userId = 'test-customer-id-' + Date.now();
  const adminId = 'test-admin-id-' + Date.now();
  
  const userToken = jwt.sign({ id: userId, role: 'student' }, JWT_SECRET);
  const adminToken = jwt.sign({ id: adminId, role: 'admin' }, JWT_SECRET);

  console.log('-> Tokens generated.');

  // 2. Connect Customer Socket
  const userSocket = io(API_URL, {
    auth: { token: userToken, role: 'student' },
    transports: ['websocket']
  });

  // 3. Connect Admin Socket
  const adminSocket = io(API_URL, {
    auth: { token: adminToken, role: 'admin' },
    transports: ['websocket']
  });

  const announcementReceivedPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      userSocket.disconnect();
      adminSocket.disconnect();
      reject(new Error('Timeout: Customer did not receive global_announcement in 10 seconds'));
    }, 10000);

    userSocket.on('global_announcement', (data) => {
      console.log('✅ SUCCESS: Customer received real-time broadcast:', data.message);
      clearTimeout(timeout);
      resolve(data);
    });
  });

  await new Promise(r => setTimeout(r, 1000));
  console.log('-> Sockets connected.');

  // 4. Admin Broadcasts Message
  const testMsg = '🚨 Nexus Update: Real-time connections are LIVE! ' + new Date().toLocaleTimeString();
  console.log('-> Admin broadcasting message:', testMsg);
  
  adminSocket.emit('admin_broadcast', {
    message: testMsg,
    type: 'emergency'
  });

  try {
    await announcementReceivedPromise;
    console.log('--- Phase 2 PASSED ---');
    process.exit(0);
  } catch (err) {
    console.error('❌ Phase 2 FAILED:', err.message);
    process.exit(1);
  } finally {
    userSocket.disconnect();
    adminSocket.disconnect();
  }
}

verify();
