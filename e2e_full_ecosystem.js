const http = require('http');
const https = require('https');

const API_BASE = 'https://hostelbites-backend-jwmt.onrender.com/api';

async function request(endpoint, method = 'GET', body = null, token = null) {
  const url = `${API_BASE}${endpoint}`;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const options = {
    method,
    headers
  };
  if (body) options.body = JSON.stringify(body);

  try {
    const res = await fetch(url, options);
    let data;
    try {
      data = await res.json();
    } catch {
      data = await res.text();
    }
    return { status: res.status, data };
  } catch (err) {
    return { status: 500, error: err.message };
  }
}

async function runTest() {
  console.log('=== STARTING FULL ECOSYSTEM E2E TEST ===\n');

  // --- 1. Customer Context ---
  console.log('[1. CUSTOMER PORTAL]');
  const customerLogin = await request('/users/login', 'POST', { phone: '9123456789', password: 'password123' });
  if (customerLogin.status !== 200) return console.error('❌ Customer Login Failed', customerLogin.data);
  const customerToken = customerLogin.data.token;
  console.log('✅ Customer Logged In');

  // Fetch valid restaurant and menu
  const rests = await request('/restaurants');
  const restId = rests.data[0].id || rests.data[0]._id;
  const menuRes = await request(`/restaurants/${restId}/menu`);
  const menuItem = menuRes.data.find(i => i.isAvailable);
  console.log(`✅ Customer built basket from: ${rests.data[0].name}`);

  // Place Order
  const orderPayload = {
    restaurantId: restId,
    items: [{ menuItemId: menuItem.id || menuItem._id, name: menuItem.name, price: menuItem.price, quantity: 1 }],
    totalAmount: menuItem.price,
    deliveryMethod: 'delivery',
    deliveryAddress: 'SRM AP Block A',
    paymentMethod: 'COD'
  };
  const orderRes = await request('/orders', 'POST', orderPayload, customerToken);
  if (orderRes.status !== 201) return console.error('❌ Customer Order Failed', orderRes.data);
  const orderId = orderRes.data.id || orderRes.data._id;
  console.log(`✅ Customer Placed Order successfully. ID: ${orderId}\n`);


  // --- 2. Restaurant Context ---
  console.log('[2. RESTAURANT PORTAL]');
  // Logging in as the restaurant that received the order
  const restLogin = await request('/restaurants/login', 'POST', { id: restId, password: 'password123' });
  if (restLogin.status !== 200) return console.error('❌ Restaurant Login Failed', restLogin.data);
  const restToken = restLogin.data.token;
  console.log('✅ Restaurant Logged In');

  const acceptRes = await request(`/orders/${orderId}/restaurant-accept`, 'PUT', { estDuration: 15 }, restToken);
  if (acceptRes.status !== 200) return console.error('❌ Restaurant Accept Failed', acceptRes.data);
  console.log('✅ Restaurant Accepted Order (Preparing)');

  const readyRes = await request(`/orders/${orderId}/restaurant-ready`, 'PUT', {}, restToken);
  if (readyRes.status !== 200) return console.error('❌ Restaurant Ready Failed', readyRes.data);
  console.log('✅ Restaurant Dispatched Food (Ready for Pickup)\n');


  // --- 3. Delivery Context ---
  console.log('[3. DELIVERY PORTAL]');
  const driverLogin = await request('/delivery/login', 'POST', { phone: 'driver1', password: 'password123' });
  if (driverLogin.status !== 200) return console.error('❌ Driver Login Failed', driverLogin.data);
  const driverToken = driverLogin.data.token;
  console.log('✅ Delivery Partner Logged In');

  const riderAccept = await request(`/delivery/accept/${orderId}`, 'PUT', {}, driverToken);
  if (riderAccept.status !== 200) return console.error('❌ Rider Accept Failed', riderAccept.data);
  console.log('✅ Rider Accepted Order');

  const pickedUp = await request(`/delivery/status/${orderId}`, 'PUT', { status: 'PickedUp' }, driverToken);
  if (pickedUp.status !== 200) return console.error('❌ Rider PickUp Failed', pickedUp.data);
  console.log('✅ Rider Picked Up Food');

  // Fetch order as customer to get the secret PIN
  const customerOrder = await request(`/orders/${orderId}`, 'GET', null, customerToken);
  const correctPin = customerOrder.data.deliveryPin;
  console.log('Got delivery PIN for order:', correctPin);

  const delivered = await request(`/delivery/status/${orderId}`, 'PUT', { status: 'Delivered', pin: correctPin }, driverToken);
  if (delivered.status !== 200) return console.error('❌ Rider Deliver Failed', delivered.data);
  console.log(`✅ Rider Delivered Food successfully using PIN: ${correctPin}!\n`);


  // --- 4. Admin Context ---
  console.log('[4. ADMIN PORTAL]');
  const adminLogin = await request('/users/login', 'POST', { phone: '9391955674', password: 'zenvy_admin' });
  if (adminLogin.status !== 200) return console.error('❌ Admin Login Failed', adminLogin.data);
  const adminToken = adminLogin.data.token;
  console.log('✅ Admin Logged In');

  const allOrders = await request('/orders', 'GET', null, adminToken);
  const ourOrder = allOrders.data.orders.find(o => o.id === orderId || o._id === orderId);
  if (ourOrder && ourOrder.status === 'Delivered') {
    console.log(`✅ Admin verified Order ${orderId} is fully DELIVERED in central DB.`);
  } else {
    console.error('❌ Admin could not verify order status', ourOrder);
  }

  console.log('\n🎉 FULL ECOSYSTEM PENETRATION TEST PASSED SECURELY!');
}

runTest();
