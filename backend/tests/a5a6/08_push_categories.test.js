// Customer push categories (polish hunt C-M14): utils/pushCategories + the filter in utils/push.sendPushToTokens.
//  - the app switches (orders, offers, campus, reminders) are stored as User.pushMutes (",offers,");
//  - a push to known recipients skips the devices of recipients who muted its category;
//  - pushes with no category (account, support, chats, calls, safety outcomes) are never muted;
//  - without recipients nothing is filtered. In-memory SQLite, mocked FCM, no network.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const B = path.join(__dirname, '..', '..');
const fbPath = require.resolve(path.join(B, 'config/firebase.js'));
require.cache[fbPath] = { id: fbPath, filename: fbPath, loaded: true, exports: { apps: [], getApps: () => [] } };
const { Sequelize } = require(path.join(B, 'node_modules/sequelize'));
const push = require(path.join(B, 'utils/push.js'));
const { categoryOf, mutesFromPrefs } = require(path.join(B, 'utils/pushCategories.js'));

const tok = (tag) => `${tag}:APA91b${'y'.repeat(120)}`;
let sent = [];
const mockMessaging = () => ({
  sendEachForMulticast: async (message) => {
    sent.push(...message.tokens);
    return { successCount: message.tokens.length, failureCount: 0, responses: message.tokens.map(() => ({ success: true })) };
  },
  send: async () => 'ok',
});
const quiet = async (fn) => {
  const o = { warn: console.warn, error: console.error, log: console.log };
  console.warn = () => {}; console.error = () => {}; console.log = () => {};
  try { return await fn(); } finally { Object.assign(console, o); }
};

let sequelize = null;
let User = null;
test.before(async () => {
  sequelize = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false });
  require(path.join(B, 'models/User.js')).initUserModel(sequelize);
  require(path.join(B, 'models/DeliveryPartner.js')).initDeliveryPartnerModel(sequelize);
  await sequelize.sync();
  User = require(path.join(B, 'models/User.js')).getUserModel();
  push._setMessaging(mockMessaging);
});
test.after(async () => { push._setMessaging(null); await sequelize.close(); });

test('categoryOf / mutesFromPrefs', () => {
  assert.strictEqual(categoryOf({ type: 'ORDER_UPDATE' }), 'orders');
  assert.strictEqual(categoryOf({ type: 'campaign' }), 'offers');
  assert.strictEqual(categoryOf({ type: 'streak_nudge' }), 'reminders');
  assert.strictEqual(categoryOf({ type: 'abandoned_cart' }), 'reminders');
  assert.strictEqual(categoryOf({ type: 'BIRTHDAY_ALERT' }), 'campus');
  assert.strictEqual(categoryOf({ type: 'FRIENDS_REPLY' }, 'campus'), 'campus');
  assert.strictEqual(categoryOf({ type: 'global_broadcast', category: 'offer' }), 'offers');
  assert.strictEqual(categoryOf({ type: 'global_broadcast', category: 'announcement' }), null);
  assert.strictEqual(categoryOf({ type: 'chat_message' }, 'campus'), null);
  assert.strictEqual(categoryOf({ type: 'incoming_call' }, 'campus'), null);
  assert.strictEqual(categoryOf({ type: 'MOD_OUTCOME' }, 'campus'), null);
  assert.strictEqual(categoryOf({ type: 'TICKET_REPLY' }), null);
  assert.strictEqual(categoryOf({}), null);
  assert.strictEqual(categoryOf({ type: 'x' }, 'nonsense'), null);
  assert.strictEqual(mutesFromPrefs({ orders: true, offers: false, campus: false, reminders: true }), ',offers,campus,');
  assert.strictEqual(mutesFromPrefs({ orders: true, offers: true }), '');
  assert.strictEqual(mutesFromPrefs({ offers: 'no' }), '', 'only an explicit false mutes');
  assert.strictEqual(mutesFromPrefs(undefined), null);
  assert.strictEqual(mutesFromPrefs([false]), null);
});

test('recipients who muted a category do not get that push; everything else still goes out', async () => {
  const a = await User.create({ name: 'Muted', phone: '9000000101', password: 'Password#123', fcmTokens: [{ token: tok('a1') }, tok('a2')], pushMutes: ',offers,campus,' });
  const b = await User.create({ name: 'Default', phone: '9000000102', password: 'Password#123', fcmTokens: [{ token: tok('b1') }] });
  const both = [tok('a1'), tok('a2'), tok('b1')];
  const recipients = [a.id, b.id];

  sent = [];
  await quiet(() => push.sendPushToTokens(both, 't', 'b', { type: 'campaign' }, { recipients, persist: false }));
  assert.deepStrictEqual(sent.sort(), [tok('b1')]);

  sent = [];
  await quiet(() => push.sendPushToTokens(both, 't', 'b', { type: 'FRIENDS_REPLY' }, { recipients, persist: false, category: 'campus' }));
  assert.deepStrictEqual(sent.sort(), [tok('b1')]);

  sent = [];
  await quiet(() => push.sendPushToTokens(both, 't', 'b', { type: 'ORDER_UPDATE' }, { recipients, persist: false }));
  assert.deepStrictEqual(sent.sort(), both.slice().sort(), 'orders not muted by this user');

  sent = [];
  await quiet(() => push.sendPushToTokens(both, 't', 'b', { type: 'chat_message' }, { recipients, persist: false, category: 'campus' }));
  assert.deepStrictEqual(sent.sort(), both.slice().sort(), 'chats are never muted');

  sent = [];
  await quiet(() => push.sendPushToTokens(both, 't', 'b', { type: 'campaign' }, { persist: false }));
  assert.deepStrictEqual(sent.sort(), both.slice().sort(), 'no recipients: nothing filtered');

  // every recipient muted it: nothing is sent, no error
  sent = [];
  const r = await quiet(() => push.sendPushToTokens([tok('a1')], 't', 'b', { type: 'campaign' }, { recipients: [a.id], persist: false }));
  assert.deepStrictEqual(sent, []);
  assert.deepStrictEqual(r, { successCount: 0, failureCount: 0, staleTokens: [] });
});
