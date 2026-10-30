// Owner, 30 Oct 2026: "in-campus means there is no delivery; students pre-book and collect at the stall". A stall with
// In-Campus Booking on is pickup-only: it is not listed with the delivery stalls or the Home stores, a delivery quote /
// order to it is refused with BOOKING_ONLY_STALL, and booking it still works. A stall with bookings off is unchanged.
const test = require('node:test');
const assert = require('node:assert');
const T = require('./helpers');

test.before(async () => { await T.setup(); });
test.after(async () => { await T.teardown(); });

const localVendors = async () => {
  let body = null;
  let status = 200;
  const res = { status(s) { status = s; return this; }, json(b) { body = b; return this; }, set() { return this; } };
  await T.r('controllers/restaurantController').getLocalVendors({ query: {} }, res);
  assert.strictEqual(status, 200);
  return Array.isArray(body) ? body : (body && (body.vendors || body.data)) || [];
};

test('a booking stall is pickup-only: not listed for delivery, delivery refused, booking works', async () => {
  const booking = await T.mkStall({ enabled: true });
  const delivery = await T.mkStall({ enabled: false, upi: null });
  const u = await T.mkUser();

  // Delivery stalls list (Home "stalls") and the Home store list.
  const ids = (list) => list.map((s) => String(s.id || s._id));
  const vendors = ids(await localVendors());
  assert.ok(!vendors.includes(String(booking.store.id)), 'booking stall not in the delivery stalls');
  assert.ok(vendors.includes(String(delivery.store.id)), 'a stall with bookings off is still listed');
  T.r('controllers/adminController').clearRestaurantsCache();
  const home = await T.api('GET', '/api/users/restaurants');
  assert.strictEqual(home.status, 200);
  assert.ok(!ids(home.body).includes(String(booking.store.id)), 'booking stall not on the Home store list');
  assert.ok(ids(home.body).includes(String(delivery.store.id)), 'delivery stall still on the Home list');

  // A delivery quote / order to the booking stall is refused with a clear message.
  const quote = await T.api('POST', '/api/orders/quote', u.token, { items: [{ menuItemId: booking.items[0].id, quantity: 1 }] });
  assert.strictEqual(quote.status, 400);
  assert.strictEqual(quote.body.code, 'BOOKING_ONLY_STALL');
  assert.match(quote.body.message, /takes In-Campus pre-bookings only/);
  const order = await T.api('POST', '/api/orders', u.token, T.orderBody(booking.items[0].id, 'COD'));
  assert.strictEqual(order.status, 400);
  assert.strictEqual(order.body.code, 'BOOKING_ONLY_STALL');
  assert.strictEqual(await T.ctx.M('Order').count({ where: { restaurantId: booking.store.id } }), 0);

  // The stall with bookings off still quotes for delivery (not refused as booking-only).
  const other = await T.api('POST', '/api/orders/quote', u.token, { items: [{ menuItemId: delivery.items[0].id, quantity: 1 }] });
  assert.notStrictEqual(other.body && other.body.code, 'BOOKING_ONLY_STALL');

  // Pre-booking the booking stall still works.
  const b = await T.book(u, booking);
  assert.strictEqual(b.status, 201, JSON.stringify(b.body));
});
