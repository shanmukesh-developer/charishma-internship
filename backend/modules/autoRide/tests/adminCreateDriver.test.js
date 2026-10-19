// Plan B sign-up (like the Zenvy Rider app): the admin creates the driver account with a temporary password
// (POST /api/admin/auto-ride/drivers); the driver signs in with phone + password, uploads documents, submits for
// review and changes the password. No SMS provider is involved anywhere (FAST2SMS_API_KEY unset, Firebase stubbed).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const H = require('./helpers');

const { api } = H;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const png = (n) => `data:image/png;base64,${Buffer.concat([PNG, Buffer.from(`-${n}-${crypto.randomBytes(4).toString('hex')}`)]).toString('base64')}`;
const URL_ = '/api/admin/auto-ride/drivers';

let admin;
before(async () => {
  delete process.env.FAST2SMS_API_KEY;
  await H.setup({ label: 'ar-admin-create' });
  await H.setFlag(true);
  admin = await H.mkAdmin();
});
after(H.teardown);

test('only admins can create driver accounts; input is validated like self sign-up', async () => {
  const phone = H.nextPhone();
  assert.equal((await api('POST', URL_, null, { name: 'Suresh Babu', phone, password: 'Temp1234' })).status, 401);
  const student = await H.mkUser();
  assert.equal((await api('POST', URL_, student.token, { name: 'Suresh Babu', phone, password: 'Temp1234' })).status, 403);
  const { token: driverTok } = await H.mkDriver();
  assert.ok([401, 403].includes((await api('POST', URL_, driverTok, { name: 'Suresh Babu', phone, password: 'Temp1234' })).status));

  const empty = await api('POST', URL_, admin.token, {});
  assert.equal(empty.status, 400);
  assert.equal(empty.body.code, 'INVALID_PHONE');
  const badPhone = await api('POST', URL_, admin.token, { name: 'Suresh Babu', phone: '12345', password: 'Temp1234' });
  assert.equal(badPhone.body.code, 'INVALID_PHONE');
  const noName = await api('POST', URL_, admin.token, { name: 'S', phone, password: 'Temp1234' });
  assert.equal(noName.status, 400);
  const weak = await api('POST', URL_, admin.token, { name: 'Suresh Babu', phone, password: 'short' });
  assert.equal(weak.status, 400);
  assert.equal(weak.body.code, 'WEAK_PASSWORD');
  assert.equal(await H.ctx.M('AutoDriver').count({ where: { phone } }), 0);
});

test('admin create -> driver login -> documents + vehicle -> submit -> change password (no SMS anywhere)', async () => {
  const phone = H.nextPhone();
  const c = await api('POST', URL_, admin.token, { name: '  Suresh   Babu ', phone: `+91 ${phone}`, password: 'Temp1234' });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  assert.equal(c.body.driver.status, 'PENDING_DOCS', 'same start as a self sign-up');
  assert.equal(c.body.driver.phone, phone);
  assert.ok(!('password' in c.body.driver));
  assert.ok(!('token' in c.body), 'the admin never receives a driver session');
  const row = await H.ctx.M('AutoDriver').findByPk(c.body.driver.id);
  assert.ok(row.password.startsWith('$2'), 'stored as a bcrypt hash');
  const log = await H.ctx.M('VerificationLog').findOne({ where: { targetId: row.id, action: 'AUTO_DRIVER_CREATED_BY_ADMIN' } });
  assert.ok(log, 'audited');
  assert.ok(!String(log.details).includes('Temp1234') && !String(log.details).includes(phone), 'no password / full phone in the audit');

  const dup = await api('POST', URL_, admin.token, { name: 'Other', phone, password: 'Temp1234' });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.code, 'PHONE_TAKEN');
  const selfDup = await api('POST', '/api/auto-ride/driver/auth/register', null, { name: 'Other', phone, password: 'Temp1234', otp: '123456' });
  assert.equal(selfDup.status, 409, 'self sign-up sees the admin-created account');

  const bad = await api('POST', '/api/auto-ride/driver/auth/login', null, { phone, password: 'Wrong1234' });
  assert.equal(bad.status, 401);
  const login = await api('POST', '/api/auto-ride/driver/auth/login', null, { phone, password: 'Temp1234' });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  let tok = login.body.token;

  const ups = {};
  for (const k of ['photo', 'licenceFront', 'licenceBack', 'rc', 'permit', 'insurance', 'v1']) {
    const u = await api('POST', '/api/auto-ride/driver/media', tok, { image: png(k) });
    assert.equal(u.status, 201, JSON.stringify(u.body));
    ups[k] = u.body.url;
  }
  assert.equal((await api('PUT', '/api/auto-ride/driver/me/documents', tok, { documents: { photo: ups.photo, licenceFront: ups.licenceFront, licenceBack: ups.licenceBack } })).status, 200);
  assert.equal((await api('PATCH', '/api/auto-ride/driver/me/profile', tok, { licenceNumber: 'AP02 2019 0012345', licenceExpiresOn: '2031-05-01', emergencyContactName: 'Lakshmi', emergencyContactPhone: '9988776655' })).status, 200);
  const v = await api('POST', '/api/auto-ride/driver/vehicles', tok, {
    registrationNumber: 'AP 07 TC 1122', make: 'Piaggio', model: 'Ape City', fuel: 'cng', rcSeatingCapacity: 3, requestedCapacity: 3,
    permitNumber: 'AP/CC/2024/78', permitExpiresOn: '2030-03-31', insuranceExpiresOn: '2027-06-30',
    documents: { rc: ups.rc, permit: ups.permit, insurance: ups.insurance }, photos: [ups.v1],
  });
  assert.equal(v.status, 201, JSON.stringify(v.body));
  const sub = await api('POST', '/api/auto-ride/driver/me/submit', tok);
  assert.equal(sub.status, 200, JSON.stringify(sub.body));
  assert.equal(sub.body.driver.status, 'PENDING_REVIEW');

  const wrongCur = await api('POST', '/api/auto-ride/driver/auth/password', tok, { currentPassword: 'Nope1234', newPassword: 'MyOwn5678' });
  assert.equal(wrongCur.status, 401);
  const cp = await api('POST', '/api/auto-ride/driver/auth/password', tok, { currentPassword: 'Temp1234', newPassword: 'MyOwn5678' });
  assert.equal(cp.status, 200, JSON.stringify(cp.body));
  assert.equal((await api('GET', '/api/auto-ride/driver/me', tok)).status, 401, 'old session revoked');
  tok = cp.body.token;
  assert.equal((await api('GET', '/api/auto-ride/driver/me', tok)).status, 200);
  assert.equal((await api('POST', '/api/auto-ride/driver/auth/login', null, { phone, password: 'Temp1234' })).status, 401, 'temporary password no longer works');
  assert.equal((await api('POST', '/api/auto-ride/driver/auth/login', null, { phone, password: 'MyOwn5678' })).status, 200);

  const ver = await api('POST', `/api/admin/auto-ride/drivers/${row.id}/verify`, admin.token);
  assert.equal(ver.status, 200, JSON.stringify(ver.body));
  assert.equal(ver.body.driver.status, 'VERIFIED');
});
