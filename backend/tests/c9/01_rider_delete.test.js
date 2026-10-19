// C9: Zenvy Rider in-app account deletion (/api/delivery/account/*): auth, blockers, re-auth (password with
// lockout, SMS code with its own purpose), anonymisation, kept vs deleted records, revoked sessions, audit.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers');

test.before(() => H.setup());
test.after(() => H.teardown());

const DEL = '/api/delivery/account/delete';
const CHECK = '/api/delivery/account/deletion-check';

test('only a signed-in rider: no token 401, customer / store / auto-driver tokens refused', async () => {
  assert.strictEqual((await H.api('GET', CHECK)).status, 401);
  const u = await H.mkUser();
  assert.strictEqual((await H.api('GET', CHECK, u.token)).status, 403);
  assert.strictEqual((await H.api('POST', DEL, u.token, { confirm: 'DELETE', password: 'x' })).status, 403);
  const s = await H.mkStore();
  assert.strictEqual((await H.api('GET', CHECK, s.token)).status, 403);
  const d = await H.mkDriver();
  assert.strictEqual((await H.api('GET', CHECK, d.token)).status, 401, 'auto-driver token is never a rider session');
});

test('deletion-check lists blockers: delivery in progress, cash to deposit, money owed, pending payout', async () => {
  const rider = await H.mkRider({ cashHeldPaise: 25000, walletBalance: 40 });
  const user = await H.mkUser();
  const store = await H.mkStore();
  const order = await H.mkOrder({ user, store, rider, status: 'PickedUp' });
  await H.ctx.M('Payout').create({ partnerType: 'rider', partnerId: String(rider.id), periodStart: new Date(), periodEnd: new Date(), grossPaise: 1, netPaise: 1, status: 'PENDING' });
  let r = await H.api('GET', CHECK, rider.token);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.canDelete, false);
  const codes = r.body.blockers.map((b) => b.code);
  for (const c of ['ACTIVE_DELIVERIES', 'CASH_TO_DEPOSIT', 'BALANCE_TO_PAY_OUT', 'PAYOUT_PENDING']) assert.ok(codes.includes(c), `${c} in ${codes}`);
  assert.match(r.body.phoneMasked, /^\*{6}\d{4}$/);
  // delete is refused with the first blocker, and the password is not even checked
  r = await H.api('POST', DEL, rider.token, { confirm: 'DELETE', password: 'wrong' });
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.body.code, 'ACTIVE_DELIVERIES');
  // clear them one by one
  await order.update({ status: 'Delivered' });
  await H.ctx.M('DeliveryPartner').update({ cashHeldPaise: 0, walletBalance: 0 }, { where: { id: rider.id } });
  await H.ctx.M('Payout').update({ status: 'PAID' }, { where: { partnerId: String(rider.id) } });
  r = await H.api('GET', CHECK, rider.token);
  assert.deepStrictEqual(r.body.blockers, []);
  assert.strictEqual(r.body.canDelete, true);
});

test('confirm DELETE and a re-auth are required; wrong passwords lock the endpoint after 5', async () => {
  const rider = await H.mkRider();
  let r = await H.api('POST', DEL, rider.token, { password: H.RIDER_PW });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.body.code, 'CONFIRM_REQUIRED');
  r = await H.api('POST', DEL, rider.token, { confirm: 'DELETE' });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.body.code, 'REAUTH_REQUIRED');
  for (let i = 0; i < 5; i++) {
    r = await H.api('POST', DEL, rider.token, { confirm: 'DELETE', password: `bad-${i}` });
    assert.strictEqual(r.status, 401);
    assert.strictEqual(r.body.code, 'WRONG_PASSWORD');
  }
  r = await H.api('POST', DEL, rider.token, { confirm: 'DELETE', password: H.RIDER_PW });
  assert.strictEqual(r.status, 429, 'locked even with the right password');
  assert.strictEqual(r.body.code, 'TOO_MANY_ATTEMPTS');
  assert.ok(await H.ctx.M('DeliveryPartner').findByPk(rider.id).then((p) => p.name.startsWith('C9 Rider')), 'nothing deleted');
});

test('password delete: row anonymised, sessions revoked, login impossible, personal rows deleted, records kept, audited', async () => {
  const M = H.ctx.M;
  const rider = await H.mkRider({ fcmTokens: ['tok-a'], liveLocation: { lat: 16.4, lng: 80.5 } });
  const oldPhone = rider.phone;
  const user = await H.mkUser();
  const store = await H.mkStore();
  const delivered = await H.mkOrder({ user, store, rider, status: 'Delivered' });
  await M('RiderCashEntry').create({ riderId: String(rider.id), type: 'COD_COLLECTED', amountPaise: 1000, balanceAfterPaise: 1000, orderId: delivered.id }).catch((e) => { throw new Error(`cash row: ${e.message}`); });
  await M('Notification').create({ userId: rider.id, title: 'hi', body: 'there', type: 'info' });
  const tOrder = await M('Ticket').create({ riderId: rider.id, orderId: delivered.id, subject: 's', description: 'd' });
  const tPlain = await M('Ticket').create({ riderId: rider.id, subject: 'my bike', description: 'personal' });
  await M('OrderMessage').create({ orderId: delivered.id, senderType: 'rider', senderId: rider.id, text: 'on my way' });
  const custMsg = await M('OrderMessage').create({ orderId: delivered.id, senderType: 'customer', senderId: user.id, text: 'thanks' });
  const media = await M('CampusMedia').create({ ownerId: rider.id, purpose: 'avatar', mime: 'image/png', size: 4, sha256: 'x'.repeat(64), isPrivate: false, bytes: Buffer.from([1, 2, 3, 4]) });

  const r = await H.api('POST', DEL, rider.token, { confirm: 'delete', password: H.RIDER_PW, reason: 'moving away' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.success, true);

  const p = await M('DeliveryPartner').findByPk(rider.id);
  assert.strictEqual(p.name, 'Deleted rider');
  assert.notStrictEqual(p.phone, oldPhone);
  assert.match(p.phone, /^deleted_/);
  for (const f of ['vehicleNumber', 'photoUrl', 'bio', 'emergencyContact', 'sosNote']) assert.strictEqual(p[f], null, f);
  assert.deepStrictEqual(p.fcmTokens, []);
  assert.deepStrictEqual(p.liveLocation, { lat: null, lng: null });
  assert.strictEqual(p.isApproved, false);
  assert.strictEqual(p.isOnline, false);
  assert.ok(p.accountDeletedAt && p.suspendedAt);
  assert.ok(Number(p.tokenVersion) > 0);
  assert.strictEqual(await p.comparePassword(H.RIDER_PW), false, 'old password no longer works');

  // old session dead; login with the old number fails
  assert.strictEqual((await H.api('GET', '/api/delivery/profile', rider.token)).status, 401);
  const login = await H.api('POST', '/api/delivery/login', null, { phone: oldPhone, password: H.RIDER_PW });
  assert.strictEqual(login.status, 401);

  // kept: order (still linked to the rider id), cash ledger, ticket about the order, customer's chat
  assert.strictEqual((await M('Order').findByPk(delivered.id)).deliveryPartnerId, rider.id);
  assert.strictEqual(await M('RiderCashEntry').count({ where: { riderId: String(rider.id) } }), 1);
  assert.ok(await M('Ticket').findByPk(tOrder.id));
  assert.ok(await M('OrderMessage').findByPk(custMsg.id));
  // deleted: notifications, personal ticket, the rider's chat lines, media, codes
  assert.strictEqual(await M('Notification').count({ where: { userId: rider.id } }), 0);
  assert.strictEqual(await M('Ticket').findByPk(tPlain.id), null);
  assert.strictEqual(await M('OrderMessage').count({ where: { senderType: 'rider', senderId: rider.id } }), 0);
  assert.strictEqual(await M('CampusMedia').findByPk(media.id), null);

  // audit row without personal data
  const log = await M('VerificationLog').findOne({ where: { targetId: rider.id, action: 'RIDER_ACCOUNT_DELETED' } });
  assert.ok(log, 'audit row');
  assert.strictEqual(log.adminId, 'self:rider');
  assert.ok(!String(log.details).includes(oldPhone), 'no phone in the audit details');
  assert.ok(!String(log.details).includes('moving away'), 'reason text not stored');

  // a second attempt with the old token cannot do anything
  assert.strictEqual((await H.api('POST', DEL, rider.token, { confirm: 'DELETE', password: H.RIDER_PW })).status, 401);
});

test('SMS code path: public /send-otp refuses the partner purpose; the code only works for this purpose', async () => {
  const rider = await H.mkRider();
  // the public sender never sends this purpose (no enumeration of partner numbers)
  let r = await H.api('POST', '/api/users/send-otp', null, { phone: rider.phone, purpose: 'delete_partner_account' });
  assert.strictEqual(r.status, 400);
  // the rider's own route reaches the real sender (no SMS key in tests -> 502 SMS_UNAVAILABLE, nothing stored)
  r = await H.api('POST', '/api/delivery/account/delete-otp', rider.token);
  assert.strictEqual(r.status, 502, JSON.stringify(r.body));
  assert.strictEqual(r.body.code, 'SMS_UNAVAILABLE');
  // a login ('auth') code for the same number is not accepted for deletion
  await H.seedOtp(rider.phone, 'auth', '111111');
  r = await H.api('POST', DEL, rider.token, { confirm: 'DELETE', otp: '111111' });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.body.code, 'OTP_EXPIRED');
  // wrong code -> attempts left
  await H.seedOtp(rider.phone, 'delete_partner_account', '654321');
  r = await H.api('POST', DEL, rider.token, { confirm: 'DELETE', otp: '000000' });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.body.code, 'OTP_INVALID');
  r = await H.api('POST', DEL, rider.token, { confirm: 'DELETE', otp: '654321' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual((await H.ctx.M('DeliveryPartner').findByPk(rider.id)).name, 'Deleted rider');
  assert.strictEqual(await H.ctx.M('OtpCode').count({ where: { phone: rider.phone } }), 0, 'codes for the old number removed');
});

test('blocker check happens before the SMS code is consumed', async () => {
  const rider = await H.mkRider({ cashHeldPaise: 500 });
  await H.seedOtp(rider.phone, 'delete_partner_account', '222333');
  const r = await H.api('POST', DEL, rider.token, { confirm: 'DELETE', otp: '222333' });
  assert.strictEqual(r.status, 409);
  const code = await H.ctx.M('OtpCode').findOne({ where: { phone: rider.phone, purpose: 'delete_partner_account' } });
  assert.strictEqual(code.consumedAt, null, 'code still usable');
  assert.ok(!code.attempts, 'no attempt used');
});

test('an unapproved (waiting) rider can delete too', async () => {
  const rider = await H.mkRider({ isApproved: false });
  const r = await H.api('POST', DEL, rider.token, { confirm: 'DELETE', password: H.RIDER_PW });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
});
