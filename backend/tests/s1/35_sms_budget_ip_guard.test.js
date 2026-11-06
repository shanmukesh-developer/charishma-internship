// Bug hunt 6 Nov 2026 (M3): send-otp per-IP allowance tightens as today's SMS budget runs low, and admins get one
// alert per level (50 % / 80 %) per IST day. Below 50 % nothing changes (hostels share NAT IPs); per-phone limits
// and the loadtest bypass are untouched.
process.env.RATE_LIMIT_ENFORCE = '1';
process.env.SMS_DAILY_CAP = '10';
process.env.LOADTEST_KEY = 's1-loadtest-key-for-tests';
delete process.env.FAST2SMS_API_KEY;
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers');

let smsBudget;
const alerts = [];
test.before(async () => {
  await H.setup();
  smsBudget = H.r('utils/smsBudget');
  const adminAlert = H.r('utils/adminAlert');
  adminAlert.pushAdmins = async (title, body, data) => { alerts.push({ title, body, data }); return 0; };
  H.r('models/IdempotencyKey').initIdempotencyKeyModel(H.ctx.sequelize);
  await H.ctx.sequelize.models.IdempotencyKey.sync();
});
test.after(() => H.teardown());

const setUsed = async (count) => {
  const day = smsBudget.istDay();
  await H.ctx.M.SmsDailyCount.upsert({ day, count });
  smsBudget._resetWarnings(); // drop the 15 s usage cache (and in-process alert claims)
};
// An invalid number: answered 400 by the controller, still counted by the IP limiters, never sends an SMS.
const sendOtp = (headers = {}) => H.api('POST', '/api/users/send-otp', null, { phone: '12345' }, headers);

test('allowance by budget use: unchanged below 50 %, 100 above, 20 above 80 %', () => {
  assert.strictEqual(smsBudget.sendOtpIpLimit(1000, 0), 1000);
  assert.strictEqual(smsBudget.sendOtpIpLimit(1000, 0.49), 1000);
  assert.strictEqual(smsBudget.sendOtpIpLimit(1000, 0.5), 100);
  assert.strictEqual(smsBudget.sendOtpIpLimit(1000, 0.79), 100);
  assert.strictEqual(smsBudget.sendOtpIpLimit(1000, 0.8), 20);
  assert.strictEqual(smsBudget.sendOtpIpLimit(1000, 1), 20);
  assert.strictEqual(smsBudget.sendOtpIpLimit(50, 0.6), 50, 'never looser than the configured base');
});

test('send-otp per IP: generous while the budget is healthy, tight once most of it is used; loadtest bypass kept', async () => {
  await setUsed(0);
  for (let i = 0; i < 25; i++) {
    const r = await sendOtp();
    assert.notStrictEqual(r.status, 429, `request ${i + 1} limited below 50 %: ${JSON.stringify(r.body)}`);
  }
  await setUsed(6); // 60 %: 100 per IP, 25 used so far
  assert.notStrictEqual((await sendOtp()).status, 429);
  await setUsed(9); // 90 %: 20 per IP, already past it
  const limited = await sendOtp();
  assert.strictEqual(limited.status, 429, JSON.stringify(limited.body));
  assert.strictEqual(limited.body.code, 'RATE_LIMITED');
  assert.match(limited.body.message, /Too many codes requested from this network/);
  // load-test requests skip the IP guards exactly as before
  const lt = await sendOtp({ 'x-loadtest-key': process.env.LOADTEST_KEY });
  assert.notStrictEqual(lt.status, 429, JSON.stringify(lt.body));
  // email backup codes do not spend SMS budget: not tightened
  const email = await H.api('POST', '/api/users/send-email-otp', null, { phone: '12345', purpose: 'reset_password' });
  assert.notStrictEqual(email.status, 429, JSON.stringify(email.body));
});

test('admin alert once per level per day (50 %, then 80 %), also across processes', async () => {
  alerts.length = 0;
  await setUsed(4);
  assert.strictEqual(await smsBudget.warnIfNeeded(), null, 'no alert below 50 %');
  await setUsed(5);
  assert.strictEqual(await smsBudget.warnIfNeeded(), 50);
  assert.strictEqual(await smsBudget.warnIfNeeded(), null, 'same level only once');
  assert.match(alerts[0].title, /SMS budget 50% used/);
  assert.strictEqual(alerts[0].data.type, 'SMS_BUDGET_WARN');
  // another process (no in-memory claim): the shared claim row stops a repeat
  smsBudget._resetWarnings();
  assert.strictEqual(await smsBudget.warnIfNeeded(), null);
  await setUsed(8);
  assert.strictEqual(await smsBudget.warnIfNeeded(), 80);
  assert.strictEqual(await smsBudget.warnIfNeeded(), null);
  assert.strictEqual(alerts.length, 2);
  assert.match(alerts[1].body, /20 codes per 15 minutes/);
});

test('a successful SMS reserve triggers the check in the background', async () => {
  alerts.length = 0;
  await H.ctx.M.SmsDailyCount.destroy({ where: {} });
  await H.ctx.sequelize.models.IdempotencyKey.destroy({ where: { scope: 'sms_budget_alert' } });
  await setUsed(4);
  const r = await smsBudget.reserve(); // 5 of 10
  assert.strictEqual(r.ok, true);
  for (let i = 0; i < 50 && !alerts.length; i++) await new Promise((res) => setTimeout(res, 20));
  assert.strictEqual(alerts.length, 1);
  assert.strictEqual(alerts[0].data.level, 50);
});
