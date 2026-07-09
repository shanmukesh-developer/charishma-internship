const axios = require('axios');
const io = require('socket.io-client');
require('dotenv').config();

const API_URL = 'http://localhost:5005';

async function verify() {
  console.log('--- STARTING MEGA BASKET E2E VERIFICATION ---');

  try {
    // 1. Authenticate Customer
    console.log('1. Authenticating Customer...');
    let customerToken;
    try {
      await axios.post(`${API_URL}/api/users/register`, {
        name: 'Grocery Customer',
        phone: '9000000009',
        password: 'password123',
        hostelBlock: 'B',
        roomNumber: '202'
      }).catch(() => {});

      const loginRes = await axios.post(`${API_URL}/api/users/login`, {
        phone: '9000000009',
        password: 'password123'
      });
      customerToken = loginRes.data.token;
      console.log('✅ Customer logged in successfully');
    } catch (err) {
      console.error('❌ Failed to authenticate customer:', err.message);
      process.exit(1);
    }

    // 2. Authenticate Rider
    console.log('2. Authenticating Rider...');
    let riderToken;
    try {
      const riderLoginRes = await axios.post(`${API_URL}/api/delivery/login`, {
        phone: 'driver1',
        password: 'password123'
      });
      riderToken = riderLoginRes.data.token;
      console.log('✅ Rider logged in successfully');
    } catch (err) {
      console.error('❌ Failed to authenticate rider:', err.message);
      process.exit(1);
    }

    // 3. Connect Sockets for Real-Time Status Updates
    console.log('3. Connecting Sockets...');
    const customerSocket = io(API_URL, {
      auth: { token: customerToken },
      transports: ['websocket']
    });

    const socketPromise = new Promise((resolve) => {
      customerSocket.on('connect', () => {
        console.log('✅ Customer Socket Connected');
        resolve();
      });
    });
    await socketPromise;

    // 4. Customer Creates a Mega Basket (COD)
    console.log('4. Customer Placing Mega Basket Order...');
    const basketPayload = {
      items: [
        { name: 'Organic Tomatoes', quantity: 2, unit: 'kg', priceEstimated: 40 },
        { name: 'Fresh Milk', quantity: 1, unit: 'packet', priceEstimated: 30 },
        { name: 'Bread Pack', quantity: 1, unit: 'pcs', priceEstimated: 45 }
      ],
      deliveryAddress: 'SRM AP Campus, Block B, Room 202',
      paymentMethod: 'COD'
    };

    const createRes = await axios.post(`${API_URL}/api/mega-basket`, basketPayload, {
      headers: { Authorization: `Bearer ${customerToken}` }
    });
    const basketId = createRes.data.id;
    const deliveryPin = createRes.data.deliveryPin;
    console.log(`✅ Mega Basket Created! ID: ${basketId}, PIN: ${deliveryPin}, Status: ${createRes.data.status}`);

    // Join basket room
    customerSocket.emit('joinRoom', basketId);
    console.log(`-> Customer socket joined room: ${basketId}`);

    // Set up status listener
    let latestStatus = createRes.data.status;
    customerSocket.on('statusUpdated', (data) => {
      console.log(`🔔 Socket Event [statusUpdated]: Status changed to: ${data.status}`);
      latestStatus = data.status;
    });

    // 5. Rider Fetches Pending Baskets
    console.log('5. Rider fetching pending baskets...');
    const pendingRes = await axios.get(`${API_URL}/api/mega-basket/rider/pending`, {
      headers: { Authorization: `Bearer ${riderToken}` }
    });
    const pendingBaskets = pendingRes.data;
    const found = pendingBaskets.find(b => b.id === basketId);
    if (found) {
      console.log('✅ Basket found in pending job pool!');
    } else {
      console.error('❌ Basket not found in pending job pool!');
      process.exit(1);
    }

    // 6. Rider Claims Basket
    console.log('6. Rider Claiming Basket...');
    await axios.post(`${API_URL}/api/mega-basket/${basketId}/claim`, {}, {
      headers: { Authorization: `Bearer ${riderToken}` }
    });
    await new Promise(resolve => setTimeout(resolve, 500));
    console.log(`✅ Claimed! Current state: ${latestStatus}`);

    // 7. Rider Starts Shopping
    console.log('7. Rider Starting Shopping...');
    await axios.post(`${API_URL}/api/mega-basket/${basketId}/start-shopping`, {}, {
      headers: { Authorization: `Bearer ${riderToken}` }
    });
    await new Promise(resolve => setTimeout(resolve, 500));
    console.log(`✅ Shopping started! Current state: ${latestStatus}`);

    // 8. Rider Updates Item Prices & Availability
    console.log('8. Rider updating basket items...');
    const items = createRes.data.items;
    const tomato = items.find(i => i.name === 'Organic Tomatoes');
    const milk = items.find(i => i.name === 'Fresh Milk');
    const bread = items.find(i => i.name === 'Bread Pack');

    // Tomatoes: price increased slightly
    await axios.put(`${API_URL}/api/mega-basket/${basketId}/item-status`, {
      itemId: tomato.id,
      status: 'Approved',
      priceActual: 45
    }, {
      headers: { Authorization: `Bearer ${riderToken}` }
    });
    console.log('-> Tomatoes updated: Approved at 45/kg');

    // Milk: unavailable
    await axios.put(`${API_URL}/api/mega-basket/${basketId}/item-status`, {
      itemId: milk.id,
      status: 'Unavailable'
    }, {
      headers: { Authorization: `Bearer ${riderToken}` }
    });
    console.log('-> Milk updated: Unavailable');

    // Bread: price normal
    await axios.put(`${API_URL}/api/mega-basket/${basketId}/item-status`, {
      itemId: bread.id,
      status: 'Approved',
      priceActual: 45
    }, {
      headers: { Authorization: `Bearer ${riderToken}` }
    });
    console.log('-> Bread updated: Approved at 45/pcs');

    // 9. Rider Submits Bill
    console.log('9. Rider Submitting Bill...');
    const submitBillRes = await axios.post(`${API_URL}/api/mega-basket/${basketId}/submit-bill`, {}, {
      headers: { Authorization: `Bearer ${riderToken}` }
    });
    await new Promise(resolve => setTimeout(resolve, 500));
    console.log(`✅ Bill submitted! Actual total: ${submitBillRes.data.actualTotal}. Current state: ${latestStatus}`);

    // 10. Customer Approves Prices
    console.log('10. Customer Approving Prices...');
    await axios.post(`${API_URL}/api/mega-basket/${basketId}/approve`, {}, {
      headers: { Authorization: `Bearer ${customerToken}` }
    });
    await new Promise(resolve => setTimeout(resolve, 500));
    console.log(`✅ Prices approved! Current state: ${latestStatus}`);

    // 11. Rider Purchase Completed
    console.log('11. Rider marking purchase completed...');
    await axios.post(`${API_URL}/api/mega-basket/${basketId}/purchase-completed`, {}, {
      headers: { Authorization: `Bearer ${riderToken}` }
    });
    await new Promise(resolve => setTimeout(resolve, 500));
    console.log(`✅ Purchase completed! Current state: ${latestStatus}`);

    // 12. Rider Starts Delivery Run
    console.log('12. Rider starting delivery run...');
    await axios.post(`${API_URL}/api/mega-basket/${basketId}/start-delivery`, {}, {
      headers: { Authorization: `Bearer ${riderToken}` }
    });
    await new Promise(resolve => setTimeout(resolve, 500));
    console.log(`✅ Delivering! Current state: ${latestStatus}`);

    // 13. Rider Completes Delivery with PIN
    console.log('13. Rider completing delivery with PIN...');
    const deliveryRes = await axios.post(`${API_URL}/api/mega-basket/${basketId}/complete-delivery`, {
      deliveryPin
    }, {
      headers: { Authorization: `Bearer ${riderToken}` }
    });
    await new Promise(resolve => setTimeout(resolve, 500));
    console.log(`✅ Delivered! Current state: ${latestStatus}`);

    // 14. Verify Persistence
    console.log('14. Verifying persistence and details...');
    const checkRes = await axios.get(`${API_URL}/api/mega-basket/${basketId}`, {
      headers: { Authorization: `Bearer ${customerToken}` }
    });
    if (checkRes.data.status === 'Delivered' && checkRes.data.paymentStatus === 'Completed') {
      console.log('✅ PERSISTENCE VERIFIED: Database records reflect delivered and completed status.');
    } else {
      console.error('❌ PERSISTENCE FAILURE: Invalid final database state:', checkRes.data);
      process.exit(1);
    }

    customerSocket.disconnect();
    console.log('\n--- MEGA BASKET E2E VERIFICATION SUCCESSFUL ---');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ E2E VERIFICATION FAILED:', error.response?.data || error.message);
    process.exit(1);
  }
}

verify();
