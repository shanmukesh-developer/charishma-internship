const io = require('socket.io-client');

async function run() {
  console.log("Starting Real-Time Ecosystem Verification (V4)...");

  const serverUrl = 'http://localhost:5005';

  try {
    const res = await fetch(`${serverUrl}/api/users/restaurants`);
    const resData = await res.json();
    const restaurant = resData[0];
    if (!restaurant) throw new Error("No restaurants");

    console.log("Logging in...");
    const authRes = await fetch(`${serverUrl}/api/users/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firebaseToken: 'E2E_MOCK_TOKEN', phone: '9391955674', name: 'Nexus Admin' })
    });
    const { token } = await authRes.json();

    const menuRes = await fetch(`${serverUrl}/api/restaurants/${restaurant.id}/menu`);
    const menuItems = await menuRes.json();
    const menuItem = menuItems.find(item => item.isAvailable) || menuItems[0];
    if (!menuItem) throw new Error("No menu items found for restaurant " + restaurant.name);
    const menuItemId = menuItem.id || menuItem._id;
    console.log(`Using menu item: ${menuItem.name} (${menuItemId}) at price ${menuItem.price}`);

    const customerSocket = io(serverUrl, { transports: ['websocket'], auth: { token } });
    const adminSocket = io(serverUrl, { transports: ['websocket'], auth: { token } });

    customerSocket.on('connect', () => console.log("Customer Connected"));
    customerSocket.on('connect_error', (err) => console.error("Customer Connect Error:", err.message));
    customerSocket.on('disconnect', (reason) => console.log("Customer Disconnected:", reason));

    adminSocket.on('connect', () => {
        adminSocket.emit('joinAdmin');
        console.log("Admin Connected");
    });
    adminSocket.on('connect_error', (err) => console.error("Admin Connect Error:", err.message));
    adminSocket.on('disconnect', (reason) => console.log("Admin Disconnected:", reason));

    customerSocket.on('statusUpdated', (data) => {
        console.log(`✅ MATCH: Received standardized status update:`, data);
        setTimeout(() => process.exit(0), 1000);
    });

    adminSocket.on('admin_newOrder', (data) => {
        console.log(`✅ MATCH: Admin received new order alert:`, data.id);
    });

    await new Promise(r => setTimeout(r, 2000));

    console.log("Placing order...");
    const orderRes = await fetch(`${serverUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        restaurantId: restaurant.id,
        items: [{ id: menuItemId, quantity: 1, price: menuItem.price, name: menuItem.name }],
        totalPrice: menuItem.price,
        paymentMethod: 'COD',
        deliveryAddress: 'SRM AP Central Hub'
      })
    });
    const orderData = await orderRes.json();
    console.log("Order response status:", orderRes.status, "body:", orderData);
    const orderId = orderData.id || orderData._id;

    customerSocket.emit('joinOrder', orderId);
    await new Promise(r => setTimeout(r, 2000));

    console.log("Updating status to Accepted...");
    await fetch(`${serverUrl}/api/orders/${orderId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ status: 'Accepted' })
    });

    setTimeout(() => {
        console.log("Timeout waiting for events.");
        process.exit(1);
    }, 10000);

  } catch (err) {
    console.error("Verification failed:", err.message);
    process.exit(1);
  }
}

run();
