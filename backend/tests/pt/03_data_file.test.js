// The committed data file: bcrypt hashes only (never a plaintext password), valid unique phones, "ZCS Test" names;
// the seed refuses a data file that breaks those rules and writes nothing.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const H = require('./helpers');

const S = H.r('scripts/partner_test_accounts_seed');
const real = JSON.parse(fs.readFileSync(S.DATA_PATH, 'utf8'));

before(async () => { await H.setup(); });
after(H.teardown);

test('committed data file passes validation and holds hashes only', () => {
  S.validateData(real);
  assert.equal(real.marker, 'PARTNER_TEST_ACCOUNTS_V1_DONE');
  const raw = fs.readFileSync(S.DATA_PATH, 'utf8');
  assert.ok(!/"password"\s*:/i.test(raw), 'no password field');
  const phones = H.ACCOUNT_KEYS.map((k) => real[k].phone);
  assert.equal(new Set(phones).size, phones.length, 'phones are unique');
  for (const k of H.ACCOUNT_KEYS) {
    assert.match(real[k].passwordHash, /^\$2[aby]\$10\$/, `${k}: bcrypt, cost 10 like the models`);
    assert.match(real[k].phone, /^60000001\d\d$/, `${k}: test phone block`);
    assert.match(real[k].name, /^ZCS Test /);
  }
});

test('a data file with a plaintext password or a bad phone is refused and nothing is written', async () => {
  const bad = JSON.parse(JSON.stringify(real));
  bad.rider.password = 'plaintext123';
  assert.throws(() => S.validateData(bad), /password/);
  const badPhone = JSON.parse(JSON.stringify(real));
  badPhone.autoDriver.phone = '12345';
  assert.throws(() => S.validateData(badPhone), /phone/);
  const file = path.join(os.tmpdir(), `pt-bad-${process.pid}.json`);
  fs.writeFileSync(file, JSON.stringify(bad));
  try {
    await assert.rejects(S.runPartnerTestAccountsSeed({ dataPath: file }), /password/);
  } finally {
    fs.unlinkSync(file);
  }
  assert.equal(await H.ctx.M.DeliveryPartner.count(), 0);
  assert.equal(await H.ctx.M.GlobalConfig.count(), 0, 'no marker: a fixed file runs on the next boot');
});

test('DISABLE_PARTNER_TEST_ACCOUNTS=true switches it off', async () => {
  process.env.DISABLE_PARTNER_TEST_ACCOUNTS = 'true';
  try {
    assert.deepEqual(await S.runPartnerTestAccountsSeed(), { skipped: 'disabled' });
  } finally {
    delete process.env.DISABLE_PARTNER_TEST_ACCOUNTS;
  }
});
