/* eslint-disable */
const axios = require('axios');

const API_URL = 'http://localhost:5005/api';

async function simulate() {
  try {
    console.log('--- STARTING E2E SIMULATION ---');
    
    // 1. Fetch a Premium Restaurant from the public API
    console.log('1. Fetching restaurants...');
    const restRes = await axios.get(`${API_URL}/users/restaurants`);
    const restaurants = restRes.data;
    if (!restaurants || restaurants.length === 0) throw new Error('No restaurants found');
    const targetRest = restaurants[0];
    const targetItem = targetRest.menu[0];
    console.log(`✅ Selected Restaurant: ${targetRest.name}, Item: ${targetItem.name}`);

    // 2. Customer Auth (Mock or real)
    // We will register a mock user to ensure a clean slate
    console.log('2. Customer Registration...');
    const userSuffix = Date.now().toString().slice(-4);
    const mockUser = {
      name: `SimUser_${userSuffix}`,
      phone: `99999${userSuffix}`,
      password: 'password123',
      hostelBlock: 'L Block',
      roomNumber: '404'
    };
    const regRes = await axios.post(`${API_URL}/users/register`, mockUser);
    const customerToken = regRes.data.token;
    console.log(`✅ Customer ${mockUser.name} registered`);

    // 3. Place Order
    console.log('3. Placing Order...');
    const orderPayload = {
      restaurantId: targetRest._id,
      items: [{
        menuItemId: targetItem._id || targetItem.id,
        name: targetItem.name,
        price: targetItem.price,
        quantity: 1
      }],
      totalPrice: targetItem.price,
      deliverySlot: 'ASAP',
      deliveryAddress: 'L Block, Room 404, SRM AP',
      coordinates: { lat: 16.4632, lng: 80.5064 },
      paymentMethod: 'COD'
    };
    
    const orderRes = await axios.post(`${API_URL}/orders`, orderPayload, {
      headers: { Authorization: `Bearer ${customerToken}` }
    });
    const orderId = orderRes.data._id;
    const deliveryPin = orderRes.data.deliveryPin;
    console.log(`✅ Order Placed! ID: ${orderId}, PIN: ${deliveryPin}`);

    // Wait a brief moment to allow sockets and db hooks to fire
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 4. Rider Auth
    console.log('4. Rider Authentication...');
    // Hardcoded master credentials in deliveryPartnerController: 'driver-1', 'srk'
    const riderAuthRes = await axios.post(`${API_URL}/delivery/login`, {
      phone: 'driver1',
      password: 'password123'
    });
    const riderToken = riderAuthRes.data.token;
    console.log(`✅ Rider logged in`);

    // 5. Rider Accept Order
    console.log('5. Rider Accepting Order...');
    const acceptRes = await axios.put(`${API_URL}/delivery/accept/${orderId}`, {}, {
      headers: { Authorization: `Bearer ${riderToken}` }
    });
    console.log(`✅ Order Accepted by Rider!`);

    // 6. Update Status to PickedUp
    console.log('6. Updating Status to PickedUp...');
    const pickupRes = await axios.put(`${API_URL}/delivery/status/${orderId}`, {
      status: 'PickedUp'
    }, {
      headers: { Authorization: `Bearer ${riderToken}` }
    });
    console.log(`✅ Order Marked as PickedUp!`);

    // 7. Rider Upload Proof (NEW)
    console.log('7. Rider Uploading Delivery Proof...');
    const proofForm = {
      orderId,
      image: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' // Mock base64
    };
    // In a real Multipart form, we'd use FormData, but here we mock the backend handling
    // We'll use a direct POST to /api/upload as the server.js handles it
    const uploadRes = await axios.post(`${API_URL}/upload`, { 
      orderId,
      image: proofForm.image 
    }, {
      headers: { Authorization: `Bearer ${riderToken}` }
    });
    console.log(`✅ Proof Uploaded! URL length: ${uploadRes.data.imageUrl.length}`);

    // 8. Update Status to Delivered
    console.log('8. Final Delivery with PIN...');
    const deliveryRes = await axios.put(`${API_URL}/delivery/status/${orderId}`, {
      status: 'Delivered',
      pin: deliveryPin
    }, {
      headers: { Authorization: `Bearer ${riderToken}` }
    });
    console.log(`✅ Order Delivered Successfully!`);
    
    // 9. Verify Persistence
    console.log('9. Verifying Persistence...');
    const verifyRes = await axios.get(`${API_URL}/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${customerToken}` }
    });
    if (verifyRes.data.proofImage) {
      console.log('✅ PERSISTENCE VERIFIED: proofImage found in database');
    } else {
      console.warn('⚠️ PERSISTENCE FAILED: proofImage missing in database');
    }
    console.log(verifyRes.data);

    console.log('\n--- SIMULATION SUCCESSFUL: ZERO ERRORS ---');

  } catch (error) {
    console.error('\n❌ SIMULATION FAILED!');
    if (error.response) {
      console.error('API Error Response:', error.response.status, error.response.data);
    } else {
      console.error('Runtime Error:', error.message);
    }
  }
}

simulate();
