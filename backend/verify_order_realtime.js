const io = require('socket.io-client');
const axios = require('axios');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const API_URL = 'http://localhost:5005';
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_zenvy_token_2026';

async function verify() {
  console.log('--- Phase 1: Customer -> Delivery Portal Real-Time Verification ---');

  // 1. Create tokens
  const testPhone = '9000000000';
  const testPassword = 'password123';
  
  console.log('-> Preparing test user...');
  let userToken;
  try {
     // Try to register (it might fail if already exists, that's fine)
     await axios.post(`${API_URL}/api/users/register`, {
       name: 'Test Customer',
       phone: testPhone,
       password: testPassword,
       hostelBlock: 'A',
       roomNumber: '101'
     }).catch(() => {});

     const loginRes = await axios.post(`${API_URL}/api/users/login`, {
       phone: testPhone,
       password: testPassword
     });
     userToken = loginRes.data.token;
  } catch (err) {
    console.error('Failed to setup test user:', err.message);
    process.exit(1);
  }

  const riderId = 'test-rider-id-' + Date.now();
  const riderToken = jwt.sign({ id: riderId, role: 'delivery' }, JWT_SECRET);

  console.log('-> Tokens and User prepared.');

  // 2. Connect Rider Socket
  const riderSocket = io(API_URL, {
    auth: { token: riderToken, role: 'rider', driverId: riderId, name: 'Test Rider' },
    transports: ['websocket']
  });

  const orderReceivedPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      riderSocket.disconnect();
      reject(new Error('Timeout: Did not receive newOrder event in 10 seconds'));
    }, 10000);

    riderSocket.on('newOrder', (data) => {
      console.log('✅ SUCCESS: Rider received real-time order alert:', data.id);
      clearTimeout(timeout);
      resolve(data);
    });

    riderSocket.on('connect_error', (err) => {
      reject(new Error('Socket Connection Error: ' + err.message));
    });
  });

  riderSocket.on('connect', () => {
    console.log('-> Rider socket connected.');
    // Trigger online status
    riderSocket.emit('rider_connected', { driverId: riderId, name: 'Test Rider' });
    riderSocket.emit('rider_status_change', { riderId, name: 'Test Rider', isOnline: true });
  });

  // 3. Get Valid Restaurant & Item
  try {
    console.log('-> Fetching valid restaurant data...');
    const restRes = await axios.get(`${API_URL}/api/restaurants`);
    const restaurants = restRes.data;
    if (!restaurants || restaurants.length === 0) throw new Error('No restaurants in DB');
    
    const targetRest = restaurants[0];
    const targetItem = targetRest.menu && targetRest.menu.length > 0 ? targetRest.menu[0] : null;
    if (!targetItem) throw new Error('Selected restaurant has no menu items');

    // Wait for socket to connect before placing order
    await new Promise(r => setTimeout(r, 1000));

    console.log(`-> Placing order as Customer to ${targetRest.name}...`);
    const orderPayload = {
      restaurantId: targetRest.id, 
      items: [{ menuItemId: targetItem.id, name: targetItem.name, quantity: 1, price: targetItem.price }],
      totalPrice: targetItem.price,
      deliveryAddress: 'SRM AP Campus',
      paymentMethod: 'COD'
    };
    
    const res = await axios.post(`${API_URL}/api/orders`, orderPayload, {
      headers: { Authorization: `Bearer ${userToken}` }
    });

    console.log('-> Order placed successfully. ID:', res.data._id);

    // Login as Restaurant and accept the order to trigger newOrder dispatch
    console.log(`-> Logging in as Restaurant ID ${targetRest.id}...`);
    const restLoginRes = await axios.post(`${API_URL}/api/restaurants/login`, {
      id: targetRest.id,
      password: 'password123'
    });
    const restToken = restLoginRes.data.token;

    console.log(`-> Restaurant accepting Order ${res.data._id}...`);
    await axios.put(`${API_URL}/api/orders/${res.data._id}/restaurant-accept`, {}, {
      headers: { Authorization: `Bearer ${restToken}` }
    });
    
    await orderReceivedPromise;
    console.log('--- Phase 1 PASSED ---');
  } catch (err) {
    console.error('❌ Phase 1 FAILED:', err.response?.data || err.message);
    process.exit(1);
  } finally {
    riderSocket.disconnect();
  }
}

verify();
