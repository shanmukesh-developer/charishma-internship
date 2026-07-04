const axios = require('axios');

const API_URL = 'http://localhost:5005';

// Credentials based on your unified_seed
const CUSTOMER_CRED = { phone: '9123456789', password: 'password123' };
const RESTAURANT_CRED = { id: '8467dbf0-1b1b-4ae5-88b6-0fccbfcb1cbb', password: 'password123' };
const DRIVER_CRED = { phone: '0000000000', password: 'password123' };

let customerToken = '';
let restaurantToken = '';
let driverToken = '';
let restaurantId = '';

const api = axios.create({
  baseURL: API_URL,
  validateStatus: () => true
});

async function simulate() {
  console.log('--- STARTING SIMULATION ---');
  
// 1. Auth Customer
  let customerRes = await api.post('/api/users/login', CUSTOMER_CRED);
  if (customerRes.status !== 200) {
    console.log('Customer login failed, attempting registration...');
    customerRes = await api.post('/api/users/register', { name: 'Test Cust', phone: CUSTOMER_CRED.phone, password: CUSTOMER_CRED.password });
  }
  if (customerRes.status !== 201 && customerRes.status !== 200) {
    console.log('Failed to auth customer:', customerRes.data);
    return;
  }
  customerToken = customerRes.data.token;
  console.log('✅ Customer Logged In');

  // Fetch all restaurants
  const rests = await api.get('/api/restaurants');
  if (!rests.data || rests.data.length === 0) {
    console.log('❌ No restaurants found in DB');
    return;
  }
  
  // Find a restaurant that has a menu
  let validMenuItem = null;
  for (const r of rests.data) {
    restaurantId = r.id || r._id;
    const menuRes = await api.get(`/api/restaurants/${restaurantId}/menu`);
    if (menuRes.data && menuRes.data.length > 0) {
      validMenuItem = menuRes.data[0];
      break;
    }
  }

  if (!validMenuItem) {
    console.log('❌ No menu items found for ANY restaurant');
    return;
  }

  // 2. Auth Restaurant
  const RESTAURANT_CRED = { id: restaurantId, password: 'password123' };
  const restRes = await api.post('/api/restaurants/login', RESTAURANT_CRED);
  if (restRes.status !== 200) {
    console.log('Failed to login restaurant:', restRes.data);
    return;
  }
  restaurantToken = restRes.data.token;
  console.log('✅ Restaurant Logged In');

  // 3. Auth Driver
  let drvRes = await api.post('/api/delivery/login', DRIVER_CRED);
  if (drvRes.status !== 200) {
    console.log('Driver login failed, attempting registration...');
    drvRes = await api.post('/api/delivery/register', { name: 'Test Rider', phone: DRIVER_CRED.phone, password: DRIVER_CRED.password, vehicleType: 'Bike' });
  }
  if (drvRes.status !== 201 && drvRes.status !== 200) {
    console.log('Failed to auth driver:', drvRes.data);
    return;
  }
  driverToken = drvRes.data.token;
  console.log('✅ Rider Logged In');

  // Put Rider Online
  await api.put('/api/delivery/online', { isOnline: true }, { headers: { Authorization: `Bearer ${driverToken}` }});
  
  // 4. Create Order
  console.log('🛒 Placing Order...');
  const orderRes = await api.post('/api/orders', {
    restaurantId,
    items: [
      { name: validMenuItem.name, quantity: 1, price: validMenuItem.price, basePrice: validMenuItem.price, menuItemId: validMenuItem.id || validMenuItem._id }
    ],
    totalPrice: validMenuItem.price,
    paymentMethod: 'COD',
    deliveryAddress: 'SRM AP',
    coordinates: { lat: 16.4632, lng: 80.5064 }
  }, {
    headers: { Authorization: `Bearer ${customerToken}` }
  });

  if (orderRes.status !== 201) {
    console.log('❌ Order creation failed:', orderRes.data);
    return;
  }
  const orderId = orderRes.data.id || orderRes.data._id;
  console.log(`✅ Order Placed! ID: ${orderId}`);

  // 5. Restaurant Accepts Order
  console.log('🍽️ Restaurant Accepting Order...');
  const accRes = await api.put(`/api/orders/${orderId}/restaurant-accept`, {
    estDuration: 15
  }, {
    headers: { Authorization: `Bearer ${restaurantToken}` }
  });
  if (accRes.status !== 200) console.log('❌ Restaurant Accept failed:', accRes.data);
  else console.log('✅ Restaurant Accepted');

  // 6. Restaurant Marks ReadyForPickup
  console.log('🍽️ Restaurant Preparing...');
  await api.put(`/api/orders/${orderId}/status`, { status: 'Preparing' }, { headers: { Authorization: `Bearer ${restaurantToken}` }});
  await api.put(`/api/orders/${orderId}/restaurant-ready`, {}, { headers: { Authorization: `Bearer ${restaurantToken}` }});
  console.log('✅ Order Ready For Pickup');

  // 7. Rider Fetches Pending Orders
  console.log('🛵 Rider checking pending orders...');
  const pendingRes = await api.get('/api/delivery/orders/pending', {
    headers: { Authorization: `Bearer ${driverToken}` }
  });
  
  if (pendingRes.status === 200) {
    console.log(`Rider sees ${pendingRes.data.length} pending orders.`);
    const found = pendingRes.data.find(o => o.id === orderId);
    if (!found) {
      console.log('❌ Rider could NOT see the ReadyForPickup order! Bug found!');
      return;
    } else {
      console.log('✅ Rider sees the order successfully.');
    }
  }

  // 8. Rider Accepts Order
  console.log('🛵 Rider Accepting Order...');
  const riderAcc = await api.put(`/api/delivery/accept/${orderId}`, {}, {
    headers: { Authorization: `Bearer ${driverToken}` }
  });
  
  if (riderAcc.status !== 200) {
    console.log('❌ Rider failed to accept:', riderAcc.data);
    return;
  }
  console.log('✅ Rider Accepted Order');

  // 9. Rider Picks Up Order
  console.log('🛵 Rider Picking Up Order...');
  const riderPick = await api.put(`/api/delivery/status/${orderId}`, { status: 'PickedUp' }, {
    headers: { Authorization: `Bearer ${driverToken}` }
  });
  if (riderPick.status !== 200) {
    console.log('❌ Rider failed to pickup:', riderPick.data);
    return;
  }
  console.log('✅ Rider Picked Up');

  // 10. Rider Delivers Order
  console.log('🛵 Rider Delivering Order...');
  
  // Need to get the actual Delivery PIN! Let's fetch the order as admin or restaurant to get PIN.
  // Actually, we can just fetch the order as the assigned rider, wait, does rider get the PIN?
  // PIN is usually part of the active orders fetch.
  const activeRes = await api.get('/api/delivery/orders/active', {
    headers: { Authorization: `Bearer ${driverToken}` }
  });
  const activeOrder = activeRes.data.orders.find(o => o.id === orderId);
  const pin = activeOrder.deliveryPin || '1234';

  const riderDel = await api.put(`/api/delivery/status/${orderId}`, { status: 'Delivered', pin: pin }, {
    headers: { Authorization: `Bearer ${driverToken}` }
  });
  if (riderDel.status !== 200) {
    console.log('❌ Rider failed to deliver:', riderDel.data);
  } else {
    console.log('✅ Rider Delivered Order Successfully!');
  }
  
  console.log('--- SIMULATION COMPLETE ---');
}
async function runLoadTest(concurrency = 20) {
  console.log(`🚀 Starting Load Test with ${concurrency} concurrent orders...`);
  const promises = [];
  for(let i = 0; i < concurrency; i++) {
    // stagger start times slightly to simulate organic load
    promises.push(new Promise(resolve => setTimeout(() => resolve(simulate()), i * 50)));
  }
  
  const start = Date.now();
  await Promise.all(promises);
  const end = Date.now();
  
  console.log(`✅ Load Test completed in ${(end - start)/1000}s`);
}

runLoadTest(20).catch(console.error);
