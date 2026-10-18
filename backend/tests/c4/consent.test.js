// C4: consent recorded at sign-up (customer, rider, auto driver), old clients without acceptTerms still
// register but get termsUpdateRequired, accept endpoint records only the current version, never locks out.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers');

test.before(async () => { await H.setup(); });
test.after(async () => { await H.teardown(); });
test.beforeEach(async () => { await H.setLegal(null); });

const register = (phone, extra = {}) => H.api('POST', '/api/users/register', { body: { name: 'Consent Test', phone, registrationToken: H.registrationToken(phone), ...extra } });

test('customer register with acceptTerms records version + time; no update prompt', async () => {
  const phone = H.newPhone();
  const res = await register(phone, { acceptTerms: true, termsVersion: '1.0' });
  assert.strictEqual(res.status, 201, JSON.stringify(res.body));
  assert.strictEqual(res.body.termsAcceptedVersion, '1.0');
  assert.ok(res.body.termsAcceptedAt);
  assert.strictEqual(res.body.termsCurrentVersion, '1.0');
  assert.strictEqual(res.body.termsUpdateRequired, false);
  const u = await H.r('models/User').getUserModel().findOne({ where: { phone } });
  assert.strictEqual(u.termsAcceptedVersion, '1.0');
  assert.ok(u.termsAcceptedAt instanceof Date);
});

test('acceptTerms without a version records the current version', async () => {
  await H.setLegal({ policyVersion: '3.1' });
  const phone = H.newPhone();
  const res = await register(phone, { acceptTerms: true });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.termsAcceptedVersion, '3.1');
  assert.strictEqual(res.body.termsUpdateRequired, false);
});

test('old client without acceptTerms still registers (backward compatible) and gets the update prompt flag', async () => {
  const phone = H.newPhone();
  const res = await register(phone);
  assert.strictEqual(res.status, 201, JSON.stringify(res.body));
  assert.ok(res.body.token);
  assert.strictEqual(res.body.termsAcceptedVersion, null);
  assert.strictEqual(res.body.termsUpdateRequired, true);
  const prof = await H.api('GET', '/api/users/profile', { token: res.body.token });
  assert.strictEqual(prof.status, 200);
  assert.strictEqual(prof.body.termsUpdateRequired, true);
  assert.strictEqual(prof.body.termsCurrentVersion, '1.0');
});

test('a client that accepted an older version is asked again', async () => {
  const phone = H.newPhone();
  const res = await register(phone, { acceptTerms: true, termsVersion: '0.9' });
  assert.strictEqual(res.body.termsAcceptedVersion, '0.9');
  assert.strictEqual(res.body.termsUpdateRequired, true);
});

test('existing users are asked once when the version changes; accept records it; login keeps working', async () => {
  const u = await H.mkUser('student', { termsAcceptedVersion: '1.0', termsAcceptedAt: new Date('2026-10-18T00:00:00Z') });
  let st = await H.api('GET', '/api/users/legal/status', { token: u.token });
  assert.strictEqual(st.body.termsUpdateRequired, false);
  await H.setLegal({ policyVersion: '1.1' });
  st = await H.api('GET', '/api/users/legal/status', { token: u.token });
  assert.strictEqual(st.body.termsUpdateRequired, true);
  assert.strictEqual(st.body.termsCurrentVersion, '1.1');
  // Never locked out: profile still loads.
  assert.strictEqual((await H.api('GET', '/api/users/profile', { token: u.token })).status, 200);
  // Accepting a stale version is refused (prompt showed an old version).
  const stale = await H.api('POST', '/api/users/legal/accept', { token: u.token, body: { version: '1.0' } });
  assert.strictEqual(stale.status, 409);
  assert.strictEqual(stale.body.code, 'TERMS_VERSION_CHANGED');
  const ok = await H.api('POST', '/api/users/legal/accept', { token: u.token, body: { version: '1.1' } });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.body.termsAcceptedVersion, '1.1');
  assert.strictEqual(ok.body.termsUpdateRequired, false);
  await u.reload();
  assert.strictEqual(u.termsAcceptedVersion, '1.1');
  assert.ok(new Date(u.termsAcceptedAt).getTime() > Date.parse('2026-10-18T00:00:00Z'));
  // Accept without a version = the current one; idempotent.
  const again = await H.api('POST', '/api/users/legal/accept', { token: u.token, body: {} });
  assert.strictEqual(again.status, 200);
  assert.strictEqual(again.body.termsAcceptedVersion, '1.1');
});

test('accept / status need a session', async () => {
  assert.strictEqual((await H.api('POST', '/api/users/legal/accept', { body: {} })).status, 401);
  assert.strictEqual((await H.api('GET', '/api/users/legal/status')).status, 401);
});

test('verify-otp login of an existing user carries the update flag (no lock-out)', async () => {
  const u = await H.mkUser('student');
  const code = await H.seedOtp(u.phone);
  const res = await H.api('POST', '/api/users/verify-otp', { body: { phone: u.phone, otp: code } });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.ok(res.body.token);
  assert.strictEqual(res.body.termsUpdateRequired, true);
});

test('rider self sign-up records consent; without it still registers', async () => {
  const phone = H.newPhone();
  await H.seedOtp(phone);
  const res = await H.api('POST', '/api/delivery/register', { body: { name: 'Rider C4', phone, password: 'secret123', otp: '123456', acceptTerms: true, termsVersion: '1.0' } });
  assert.strictEqual(res.status, 201, JSON.stringify(res.body));
  const p = await H.r('models/DeliveryPartner').getDeliveryPartnerModel().findOne({ where: { phone } });
  assert.strictEqual(p.termsAcceptedVersion, '1.0');
  assert.ok(p.termsAcceptedAt);
  const phone2 = H.newPhone();
  await H.seedOtp(phone2);
  const res2 = await H.api('POST', '/api/delivery/register', { body: { name: 'Rider Old', phone: phone2, password: 'secret123', otp: '123456' } });
  assert.strictEqual(res2.status, 201);
  const p2 = await H.r('models/DeliveryPartner').getDeliveryPartnerModel().findOne({ where: { phone: phone2 } });
  assert.strictEqual(p2.termsAcceptedVersion, null);
});

test('auto driver sign-up records consent and returns it on the driver profile; old builds still register', async () => {
  const phone = H.newPhone();
  await H.seedOtp(phone);
  const res = await H.api('POST', '/api/auto-ride/driver/auth/register', { body: { name: 'Driver Csfour', phone, password: 'secret1234', otp: '123456', acceptTerms: true, termsVersion: '1.0' } });
  assert.strictEqual(res.status, 201, JSON.stringify(res.body));
  assert.strictEqual(res.body.driver.termsAcceptedVersion, '1.0');
  assert.ok(res.body.driver.termsAcceptedAt);
  const phone2 = H.newPhone();
  await H.seedOtp(phone2);
  const res2 = await H.api('POST', '/api/auto-ride/driver/auth/register', { body: { name: 'Driver Oldbuild', phone: phone2, password: 'secret1234', otp: '123456' } });
  assert.strictEqual(res2.status, 201, JSON.stringify(res2.body));
  assert.strictEqual(res2.body.driver.termsAcceptedVersion, null);
});

test('additive columns exist on Users, DeliveryPartners and AutoDrivers (nullable)', async () => {
  const qi = H.r('models/User').getUserModel().sequelize.getQueryInterface();
  for (const t of ['Users', 'DeliveryPartners', 'AutoDrivers']) {
    const d = await qi.describeTable(t);
    assert.ok(d.termsAcceptedVersion && d.termsAcceptedVersion.allowNull, `${t}.termsAcceptedVersion`);
    assert.ok(d.termsAcceptedAt && d.termsAcceptedAt.allowNull, `${t}.termsAcceptedAt`);
  }
});
