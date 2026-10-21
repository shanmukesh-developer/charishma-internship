// Push categories sent with the device token (polish hunt C-M14): POST /api/users/fcm-token { pushPrefs }
// stores the switched-off categories as User.pushMutes; a request without pushPrefs (older builds) keeps them.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers');

test.before(() => H.setup());
test.after(() => H.teardown());

const fcm = `cat-test:APA91b${'z'.repeat(120)}`;

test('pushPrefs are stored with the token; omitted pushPrefs keep the stored ones; all on clears them', async () => {
  const u = await H.mkUser();
  let r = await H.api('POST', '/api/users/fcm-token', u.token, { fcmToken: fcm, pushPrefs: { orders: true, offers: false, campus: true, reminders: false } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  await u.reload();
  assert.strictEqual(u.pushMutes, ',offers,reminders,');

  r = await H.api('POST', '/api/users/fcm-token', u.token, { fcmToken: fcm });
  assert.strictEqual(r.status, 200);
  await u.reload();
  assert.strictEqual(u.pushMutes, ',offers,reminders,', 'older build without pushPrefs');

  r = await H.api('POST', '/api/users/fcm-token', u.token, { fcmToken: fcm, pushPrefs: { orders: true, offers: true, campus: true, reminders: true } });
  assert.strictEqual(r.status, 200);
  await u.reload();
  assert.strictEqual(u.pushMutes, null);

  // junk is ignored, never a 500
  r = await H.api('POST', '/api/users/fcm-token', u.token, { fcmToken: fcm, pushPrefs: 'off' });
  assert.strictEqual(r.status, 200);
  await u.reload();
  assert.strictEqual(u.pushMutes, null);
});
