// C4: every /legal page renders 200 with version + effective date, footer links, settings changes show
// up, no invented grievance officer, privacy lists each data category the code collects, numbers come
// from the real settings.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers');

const PAGES = ['/legal', '/legal/terms', '/legal/privacy', '/legal/refunds', '/legal/grievance', '/legal/community-guidelines', '/legal/delete-account'];

test.before(async () => { await H.setup(); });
test.after(async () => { await H.teardown(); });
test.beforeEach(async () => { await H.setLegal(null); });

test('every page renders 200 as HTML with version, effective date and footer links', async () => {
  for (const p of PAGES) {
    const res = await H.api('GET', p);
    assert.strictEqual(res.status, 200, p);
    assert.match(res.headers.get('content-type'), /text\/html/, p);
    assert.match(res.text, /<meta name="viewport"/, p);
    for (const link of ['/legal/terms', '/legal/privacy', '/legal/refunds', '/legal/grievance', '/legal/community-guidelines', '/legal/delete-account']) {
      assert.ok(res.text.includes(`href="${link}"`), `${p} footer links ${link}`);
    }
    if (p !== '/legal/delete-account') {
      assert.ok(H.text(res.text).includes('Version 1.0'), `${p} shows version`);
      assert.ok(H.text(res.text).includes('Effective 18 October 2026'), `${p} shows effective date`);
    }
    assert.ok(!/<script/i.test(res.text), `${p} has no scripts`);
  }
});

test('old URLs redirect and the Play privacy URL is unchanged', async () => {
  assert.strictEqual((await H.api('GET', '/legal/privacy-policy')).headers.get('location'), '/legal/privacy');
  assert.strictEqual((await H.api('GET', '/legal/refund-policy')).headers.get('location'), '/legal/refunds');
  assert.strictEqual((await H.api('GET', '/legal/terms-of-service')).headers.get('location'), '/legal/terms');
});

test('canonical link only with PUBLIC_API_URL', async () => {
  let res = await H.api('GET', '/legal/privacy');
  assert.ok(!res.text.includes('rel="canonical"'));
  process.env.PUBLIC_API_URL = 'https://api.example.test';
  try {
    res = await H.api('GET', '/legal/terms');
    assert.ok(res.text.includes('<link rel="canonical" href="https://api.example.test/legal/terms">'));
  } finally { delete process.env.PUBLIC_API_URL; }
});

test('no fake grievance officer by default: placeholder + contact email', async () => {
  for (const p of ['/legal/grievance', '/legal/terms', '/legal/privacy']) {
    const t = H.text((await H.api('GET', p)).text);
    assert.ok(t.includes('Grievance Officer: details will be published here'), p);
    assert.ok(t.includes('projectshanmukh@gmail.com'), p);
  }
  const t = H.text((await H.api('GET', '/legal/terms')).text);
  assert.ok(t.includes('the city will be published here'), 'jurisdiction placeholder');
  assert.ok(!/\+91\s?\d/.test(t), 'no phone number invented');
});

test('settings changes are reflected (business, officer, address, jurisdiction, version, date) and escaped', async () => {
  await H.setLegal({
    businessName: 'Zenvy Test <b>Co</b>', operatorName: 'Op Name', contactEmail: 'help@example.test',
    registeredAddress: 'Line 1\nLine 2', jurisdictionCity: 'Testpur',
    grievanceOfficer: { name: 'Officer Jane', designation: 'Grievance Officer', email: 'grievance@example.test', phone: '+91 90000 00000', address: '' },
    effectiveDate: '2026-11-01', policyVersion: '2.0',
  });
  const g = await H.api('GET', '/legal/grievance');
  const t = H.text(g.text);
  assert.ok(t.includes('Officer Jane, Grievance Officer'));
  assert.ok(t.includes('grievance@example.test'));
  assert.ok(t.includes('+91 90000 00000'));
  assert.ok(t.includes('Line 1'), 'officer falls back to registered address');
  assert.ok(!t.includes('details will be published here'));
  assert.ok(t.includes('Version 2.0'));
  assert.ok(t.includes('Effective 1 November 2026'));
  assert.ok(!g.text.includes('<b>Co</b>'), 'business name is HTML-escaped');
  assert.ok(g.text.includes('Zenvy Test &lt;b&gt;Co&lt;/b&gt;'));
  const terms = H.text((await H.api('GET', '/legal/terms')).text);
  assert.ok(terms.includes('the courts at Testpur, India'));
  assert.ok(terms.includes('operated by Op Name'));
  assert.ok(terms.includes('help@example.test'));
});

test('privacy mentions every data category the code collects, retention actually enforced, DPDP rights', async () => {
  const t = H.text((await H.api('GET', '/legal/privacy')).text);
  const phrases = [
    'student ID card', 'driving licence', 'RC', 'insurance', 'permit', 'Background location', 'only your latest position is stored',
    'Campus Events', 'answers to the organizer', 'tickets', 'Auto-Ride', 'Connect', 'liveness selfie', 'Chat messages',
    '7 days after they are sent', '30 days after posting', 'Community posts', '48 hours', 'Terms acceptance',
    'UPI reference', 'Device and app data', 'Digital Personal Data Protection Act, 2023', 'Access', 'Correction', 'Erasure',
    'Nominate', 'Grievance redressal', 'Children', 'Cookies', 'strictly necessary', 'how to delete your account',
    'Google Firebase', 'OpenStreetMap', 'never collect Aadhaar',
  ];
  for (const p of phrases) assert.ok(t.toLowerCase().includes(p.toLowerCase()), `privacy mentions "${p}"`);
  assert.ok(!/receipts/i.test(t), 'no mention of receipts (none exist)');
  assert.ok(!t.includes('(Render)'), 'hosting text is not hard-coded');
});

test('privacy third parties follow env: Supabase / Render / Redis / Cloudflare / Brevo / Fast2SMS', async () => {
  let t = H.text((await H.api('GET', '/legal/privacy')).text);
  assert.ok(t.includes('Our cloud hosting provider') && t.includes('Our managed database provider'));
  assert.ok(!t.includes('Brevo') && !t.includes('Fast2SMS') && !t.includes('Redis') && !t.includes('Cloudflare'));
  const saved = { ...process.env };
  try {
    Object.assign(process.env, {
      DATABASE_URL: 'postgres://u:p@db.abcd.supabase.co:6543/postgres', RENDER: 'true', BREVO_API_KEY: 'x', FAST2SMS_API_KEY: 'y',
      REDIS_URL: 'rediss://default:pw@redis-123.c1.ap-south-1-1.ec2.redns.redis-cloud.com:12345', REDIS_ENABLED: 'true', TRUST_CLOUDFLARE: '1',
    });
    t = H.text((await H.api('GET', '/legal/privacy')).text);
    for (const p of ['Render: application hosting', 'Supabase: database hosting', 'Brevo', 'Fast2SMS', 'Redis Cloud', 'Cloudflare']) assert.ok(t.includes(p), p);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test('refund page uses the real Auto-Ride and Campus Events settings and order timeouts', async () => {
  let t = H.text((await H.api('GET', '/legal/refunds')).text);
  assert.ok(t.includes('7 minutes') && t.includes('30 minutes') && t.includes('2 minutes'), 'order windows');
  assert.ok(t.includes('before the trip is confirmed: 100%'), 'auto-ride before-confirm default');
  assert.ok(t.includes('after it is confirmed: 0%'), 'auto-ride after-confirm default');
  assert.ok(t.includes('up to 1 day before the event starts') && t.includes('refund is 100%'), 'events defaults');
  assert.ok(t.includes('never holds this money'), 'rentals cash');
  await H.setConfigRow('AUTO_RIDE_SETTINGS', { customerRefundBeforeConfirmPct: 80, customerRefundAfterConfirmPct: 25 });
  await H.setConfigRow('AUTO_RIDE_WALLET_ENABLED', true);
  await H.setConfigRow('CAMPUS_EVENTS_SETTINGS', { defaultUserCancelUntilHours: 6, defaultRefundPct: 50 });
  t = H.text((await H.api('GET', '/legal/refunds')).text);
  assert.ok(t.includes('before the trip is confirmed: 80%'), t.slice(t.indexOf('Auto-Ride'), t.indexOf('Auto-Ride') + 600));
  assert.ok(t.includes('after the trip is confirmed: 25%'));
  assert.ok(t.includes('up to 6 hours before the event starts') && t.includes('refund is 50%'));
});

test('retention numbers follow the admin retention settings', async () => {
  await H.setConfigRow('CHAT_RETENTION_DAYS', 14);
  await H.setConfigRow('PULSE_RETENTION_DAYS', 45);
  const t = H.text((await H.api('GET', '/legal/privacy')).text);
  assert.ok(t.includes('14 days after they are sent'));
  assert.ok(t.includes('45 days after posting'));
  await H.setConfigRow('CHAT_RETENTION_DAYS', 7);
  await H.setConfigRow('PULSE_RETENTION_DAYS', 30);
});

test('terms cover every required section; wallet is non-transferable and non-withdrawable', async () => {
  const t = H.text((await H.api('GET', '/legal/terms')).text);
  for (const p of ['18 years', 'parent or guardian', 'cash on delivery', 'cannot be withdrawn, cashed out or transferred', 'Cancellations and refunds',
    'Your content', 'Report', 'block', 'must not do', 'commercial rental number plate', 'private number plate', 'borrowed', 'does not provide any insurance',
    'between the two students', 'Auto-Ride', 'in cash to the driver', 'Campus Events', 'paid at the venue', 'Partner obligations', 'FSSAI',
    'Limitation of liability', 'Consumer Protection Act, 2019', 'Suspension and termination', 'laws of India', 'Changes to these Terms']) {
    assert.ok(t.includes(p), `terms mention "${p}"`);
  }
});

test('grievance page: 24 h acknowledgement, 15 day resolution, in-app support path', async () => {
  const t = H.text((await H.api('GET', '/legal/grievance')).text);
  assert.ok(t.includes('within 24 hours') && t.includes('within 15 days'));
  assert.ok(t.includes('Help & Support'));
});

test('community guidelines: reporting, blocking and the moderation timeline from config', async () => {
  const t = H.text((await H.api('GET', '/legal/community-guidelines')).text);
  for (const p of ['Report', 'Block', 'Threats of violence', '4 hours', '1 day', '2 days', '3 days', 'appeal']) assert.ok(t.includes(p), p);
});
